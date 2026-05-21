/**
 * Orders Checkout Route — Phase 1 (Synchronous)
 *
 * Creates orders with status 'pending_payment' and reserves inventory.
 * This runs BEFORE the Stripe PaymentIntent is created.
 *
 * Flow:
 *   1. Client calls POST /api/orders/checkout → orders created, listings reserved
 *   2. Client calls POST /api/checkout with transfer_group → Stripe charges card
 *   3. Stripe webhook fires payment_intent.succeeded → fulfillOrder() runs
 *
 * Security:
 *   - The buyer is the authenticated user (cookie session), never trusted from the body.
 *   - Prices come from the listings table, never trusted from the body.
 *   - Listing reservation is a compare-and-swap on status='active' so a second
 *     checkout for the same listing fails closed.
 *   - The inventory move (collection_items rows) was previously done here BEFORE
 *     payment; it is now deferred to fulfillOrdersByTransferGroup so a failed
 *     or abandoned payment can't transfer cards.
 *
 * Dual-platform: every order is stamped with the seller's `stripe_region` so
 * downstream — /api/checkout, the webhook, release-funds — can route the
 * PaymentIntent and seller transfer through the correct Stripe platform. A
 * cart that mixes sellers across regions is rejected; check out per region.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { estimateRate, isRegionError } from '@/lib/flashExpress';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
    BUYER_PROFILE_INCOMPLETE_TOAST,
    BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
} from '@/lib/profileValidation';

interface CheckoutItem {
    id: string; // listing id
}

export async function POST(req: Request) {
    try {
        // ─── Auth: caller is the buyer, period. ───
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const buyerId = user.id;

        const body = await req.json().catch(() => ({}));
        const items: CheckoutItem[] = Array.isArray(body?.items) ? body.items : [];
        const paymentMethod: string = typeof body?.paymentMethod === 'string' ? body.paymentMethod : 'credit_card';

        if (items.length === 0) {
            return NextResponse.json({ error: 'No items provided' }, { status: 400 });
        }
        if (items.length > 50) {
            return NextResponse.json({ error: 'Too many items in a single checkout' }, { status: 400 });
        }

        const listingIds = items.map(i => i?.id).filter((x): x is string => typeof x === 'string');
        if (listingIds.length !== items.length) {
            return NextResponse.json({ error: 'Each item must have an id (listing id)' }, { status: 400 });
        }

        const supabase = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // ─── Gate: buyer must have a complete shipping profile ───
        // Mirrors the seller-side gate in lib/profileValidation.ts. Without
        // this, fulfillOrder would substitute Bangkok placeholders into Flash
        // Express and the order would either fail validation or ship to the
        // wrong address. Returns a structured error the client uses to bounce
        // the user to Profile.
        const { data: buyerProfileGate, error: buyerProfileErr } = await supabase
            .from('profiles')
            .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
            .eq('id', buyerId)
            .single<Record<string, string | null>>();

        if (buyerProfileErr || !buyerProfileGate) {
            return NextResponse.json(
                { error: 'Buyer profile not found' },
                { status: 404 },
            );
        }

        const buyerCompleteness = checkBuyerProfileComplete(buyerProfileGate);
        if (!buyerCompleteness.complete) {
            return NextResponse.json(
                {
                    error: BUYER_PROFILE_INCOMPLETE_TOAST,
                    code: BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
                    missing: buyerCompleteness.missing,
                },
                { status: 400 },
            );
        }

        // ─── Look up real listings + prices from the DB. Never trust the body. ───
        const { data: listings, error: listingsErr } = await supabase
            .from('listings')
            .select('id, seller_id, card_id, card_data, price, condition, status')
            .in('id', listingIds);

        if (listingsErr || !listings) {
            console.error('[Orders/Checkout] Failed to fetch listings:', listingsErr);
            return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 });
        }
        if (listings.length !== listingIds.length) {
            return NextResponse.json({ error: 'One or more listings no longer exist' }, { status: 400 });
        }
        if (listings.some(l => l.status !== 'active')) {
            return NextResponse.json({ error: 'One or more listings are no longer available' }, { status: 409 });
        }
        if (listings.some(l => l.seller_id === buyerId)) {
            return NextResponse.json({ error: "You can't buy your own listing" }, { status: 400 });
        }

        const transferGroup = `order_${randomUUID()}`;

        // ─── Fetch profiles (sellers for fees + addresses, buyer for shipping) ───
        const sellerIds = [...new Set(listings.map(l => l.seller_id))];
        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('id, role, partner_level, province, state, district, postcode, stripe_region')
            .in('id', sellerIds);

        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('province, state, district, postcode')
            .eq('id', buyerId)
            .single();

        // ─── Determine the order's processing region ───
        // Every seller in the cart must be on the same Stripe platform — a
        // single PaymentIntent on platform A can't transfer to a connected
        // account on platform B. Mixed-region carts have to be split by
        // currency. Legacy sellers without a region default to 'us'.
        const sellerRegions = (sellerProfiles ?? []).map(p => {
            const r = p.stripe_region;
            return (r === 'us' || r === 'th') ? r : 'us';
        });
        const uniqueRegions = [...new Set(sellerRegions)];
        if (uniqueRegions.length > 1) {
            // Roll the listings nothing yet — return before any side effects.
            return NextResponse.json(
                {
                    error:
                        'Cart contains sellers in different currencies. Check out one ' +
                        'currency at a time.',
                },
                { status: 400 }
            );
        }
        const orderRegion = (uniqueRegions[0] ?? 'us') as 'us' | 'th';

        // ─── Platform fee tier ───
        const feeMap = new Map<string, number>();
        for (const profile of sellerProfiles || []) {
            let fee = 0.09;
            if (profile.role === 'partner') {
                const level = String(profile.partner_level || 'standard').toLowerCase().replace(' ', '_');
                switch (level) {
                    case 'bronze': fee = 0.05; break;
                    case 'silver': fee = 0.045; break;
                    case 'gold': fee = 0.04; break;
                    case 'platinum': fee = 0.035; break;
                    case 'sapphire': fee = 0.03; break;
                    case 'ruby': fee = 0.0275; break;
                    case 'emerald': fee = 0.025; break;
                    case 'diamond': fee = 0.0225; break;
                    case 'pink_diamond':
                    case 'heart': fee = 0.02; break;
                    default: fee = 0.05; break;
                }
            }
            feeMap.set(profile.id, fee);
        }

        // ─── Shipping estimate per seller (in integer satang to avoid float drift) ───
        const FALLBACK_SATANG = 40 * 100; // ฿40
        const sellerShippingSatang = new Map<string, number>();

        for (const sellerId of sellerIds) {
            const sp = sellerProfiles?.find(p => p.id === sellerId);
            try {
                const quote = await estimateRate({
                    srcProvinceName: sp?.province || 'กรุงเทพมหานคร',
                    srcCityName: sp?.state || sp?.district || 'เขตบางรัก',
                    srcPostalCode: sp?.postcode || '10500',
                    dstProvinceName: buyerProfile?.province || 'กรุงเทพมหานคร',
                    dstCityName: buyerProfile?.state || buyerProfile?.district || 'เขตบางรัก',
                    dstPostalCode: buyerProfile?.postcode || '10110',
                    weight: 500,
                    width: 10,
                    length: 15,
                    height: 2,
                });
                // Flash returns satang (cents) directly.
                sellerShippingSatang.set(sellerId, quote.estimatePrice + quote.upCountryAmount);
            } catch (err) {
                if (isRegionError(err)) {
                    console.warn(`[Orders/Checkout] Flash region mismatch for seller ${sellerId} — fallback ฿40`);
                } else {
                    console.error(`[Orders/Checkout] Flash estimate error for seller ${sellerId}:`, err);
                }
                sellerShippingSatang.set(sellerId, FALLBACK_SATANG);
            }
        }

        // ─── Build orders. Prices come from the DB; shipping is charged once per seller. ───
        const ordersToInsert: Record<string, unknown>[] = [];
        const shippingApplied = new Set<string>();

        for (const listing of listings) {
            const feePct = feeMap.get(listing.seller_id) || 0.09;
            const priceSatang = Math.round(Number(listing.price) * 100);
            const platformFeeSatang = Math.round(priceSatang * feePct);

            let shippingSatang = 0;
            if (!shippingApplied.has(listing.seller_id)) {
                shippingSatang = sellerShippingSatang.get(listing.seller_id) ?? FALLBACK_SATANG;
                shippingApplied.add(listing.seller_id);
            }

            ordersToInsert.push({
                listing_id: listing.id,
                buyer_id: buyerId,
                seller_id: listing.seller_id,
                status: 'pending_payment',
                total_amount: priceSatang / 100,
                platform_fee: platformFeeSatang / 100,
                shipping_fee: shippingSatang / 100,
                escrow_status: 'held',
                payment_method: paymentMethod,
                transfer_group: transferGroup,
                stripe_region: orderRegion,
            });
        }

        // ─── Reserve listings via CAS on status='active' BEFORE creating orders. ───
        // If any listing was already sold by a concurrent checkout, .update returns
        // fewer rows and we abort without inserting orders.
        const { data: reserved, error: reserveErr } = await supabase
            .from('listings')
            .update({ status: 'sold' })
            .in('id', listingIds)
            .eq('status', 'active')
            .select('id');

        if (reserveErr) {
            console.error('[Orders/Checkout] Reservation update failed:', reserveErr);
            return NextResponse.json({ error: 'Failed to reserve listings' }, { status: 500 });
        }

        if (!reserved || reserved.length !== listingIds.length) {
            // Roll back any partial reservation by flipping winners back to active.
            const reservedIds = (reserved || []).map(r => r.id);
            if (reservedIds.length > 0) {
                await supabase.from('listings').update({ status: 'active' }).in('id', reservedIds);
            }
            return NextResponse.json(
                { error: 'One or more listings were just sold by another buyer' },
                { status: 409 }
            );
        }

        // ─── Insert orders. If this fails, roll back the reservation. ───
        const { data: insertedOrders, error: insertErr } = await supabase
            .from('orders')
            .insert(ordersToInsert)
            .select();

        if (insertErr || !insertedOrders) {
            console.error('[Orders/Checkout] Order insert failed:', insertErr);
            await supabase.from('listings').update({ status: 'active' }).in('id', listingIds);
            return NextResponse.json({ error: 'Failed to create orders' }, { status: 500 });
        }

        // Inventory move happens post-payment in fulfillOrdersByTransferGroup.
        // It re-reads the listings table by listing_id — listings.status is now
        // 'sold' but the row is still readable.

        const totalSatang = ordersToInsert.reduce(
            (sum, o) => sum + Math.round(Number(o.total_amount) * 100) + Math.round(Number(o.shipping_fee) * 100),
            0,
        );

        return NextResponse.json({
            success: true,
            transferGroup,
            orderIds: insertedOrders.map(o => o.id),
            // Single source of truth for the amount Stripe will charge.
            totalAmount: totalSatang / 100,
            totalSatang,
            region: orderRegion,
            message: 'Orders created with pending_payment status. Proceed to payment.',
        });
    } catch (err: any) {
        console.error('[Orders/Checkout] Error:', err);
        return NextResponse.json({ error: err.message || 'Checkout failed' }, { status: 500 });
    }
}
