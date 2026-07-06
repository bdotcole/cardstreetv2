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
import {
    estimateRateWithCityFallback,
    isRegionError,
    fallbackShippingSatang,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
} from '@/lib/flashExpress';
import { applyProSellerRate, effectivePartnerLevel, feeFractionForLevel, NON_PARTNER_FEE_FRACTION } from '@/lib/partnerTiers';
import { isPremium } from '@/lib/entitlements';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
    BUYER_PROFILE_INCOMPLETE_TOAST,
    BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
    SELLER_UNVERIFIED_TOAST,
    SELLER_UNVERIFIED_ERROR_CODE,
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

        // ─── Geo gate: purchases are Thailand-only for now ───
        // Shipping (Flash Express) is only configured for TH, so we block
        // checkout for buyers we can see are outside Thailand. This fires
        // before any DB work, so a rejected request leaves no side effects.
        // Unknown geo (local dev / unresolvable IP) is allowed through — see
        // lib/geo.ts. Browsing and collection features are never gated here.
        const buyerCountry = getRequestCountry(req);
        if (!isPurchaseAllowedFromCountry(buyerCountry)) {
            return NextResponse.json(
                {
                    error:
                        'Purchases are currently only available in Thailand. ' +
                        'Buying is coming soon to your country.',
                    code: 'GEO_RESTRICTED',
                    country: buyerCountry,
                },
                { status: 403 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const items: CheckoutItem[] = Array.isArray(body?.items) ? body.items : [];
        // OBO Best-Offer: when the buyer is paying an accepted offer, this is the
        // offer id. The PRICE is never trusted from the client — it's read from
        // the offers table below (server-authoritative). Feature-gated: the
        // override only applies while NEXT_PUBLIC_ENABLE_OFFERS === '1'.
        const acceptedOfferId: string | null =
            process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1' &&
            typeof body?.acceptedOfferId === 'string' && body.acceptedOfferId.length > 0
                ? body.acceptedOfferId
                : null;
        const paymentMethod: string = typeof body?.paymentMethod === 'string' ? body.paymentMethod : 'credit_card';
        // The total the buyer was shown in the modal (THB). We use it to GUARANTEE
        // we never charge more than what was displayed: if the server's freshly
        // computed total exceeds it (e.g. Flash returned a higher live rate than
        // the estimate shown), we reject so the buyer can review — rather than
        // silently overcharging. We never charge below the server total, so this
        // can't be abused to underpay.
        const expectedTotal: number | null =
            typeof body?.expectedTotal === 'number' && body.expectedTotal > 0
                ? body.expectedTotal
                : null;

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
            .select('id, role, partner_level, total_downloads, partner_joined_at, premium_until, province, state, district, postcode, stripe_region, stripe_account_id, stripe_charges_enabled')
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

        // ─── Single-seller carts on the TH platform ───
        // Destination charges (region='th') have exactly one destination
        // account per PaymentIntent, so a TH cart can only target one seller.
        // The legacy US flow (separate charges + transfers) can still pool
        // multiple sellers under one PaymentIntent because the transfer step
        // happens later, per-seller.
        if (orderRegion === 'th') {
            const sellerIdsInCart = [...new Set(listings.map(l => l.seller_id))];
            if (sellerIdsInCart.length > 1) {
                return NextResponse.json(
                    {
                        error:
                            'Multi-seller carts are not yet supported. Please check out ' +
                            'one seller at a time.',
                    },
                    { status: 400 }
                );
            }
        }

        // ─── Gate: every seller must be able to RECEIVE the charge ───
        // Sellers can now LIST before finishing Stripe identity verification
        // (list-first — see lib/profileValidation.ts), so we enforce the
        // "charges_enabled" requirement here at purchase time. On the TH
        // direct-charge model the PaymentIntent is created on the seller's
        // connected account; an unverified seller (no account or charges not
        // yet enabled) can't be paid, and /api/checkout would reject. We catch
        // it here FIRST — before reserving listings or inserting orders — so a
        // blocked cart leaves no dangling reservation or pending order.
        const unverifiedSeller = (sellerProfiles ?? []).find(
            (p) =>
                sellerIds.includes(p.id) &&
                !(p.stripe_account_id && p.stripe_charges_enabled),
        );
        if (unverifiedSeller) {
            return NextResponse.json(
                {
                    error: SELLER_UNVERIFIED_TOAST,
                    code: SELLER_UNVERIFIED_ERROR_CODE,
                },
                { status: 409 },
            );
        }

        // ─── Platform fee tier ───
        // The fee ladder (level -> percent, downloads -> level) lives in
        // lib/partnerTiers.ts so this and components/PartnerPortal can't drift.
        // The effective level is the higher of the admin-set partner_level and
        // the level the seller's total_downloads have earned, so the loyalty
        // loop (downloads -> level -> fee) holds even before the DB trigger in
        // 20260701_partner_level_from_downloads.sql runs. Partner status is
        // keyed off partner_joined_at, not `role`: an admin can also be a
        // partner, and `role` (single-valued) can't hold both.
        const feeMap = new Map<string, number>();
        for (const profile of sellerProfiles || []) {
            let fee = NON_PARTNER_FEE_FRACTION;
            if (profile.partner_joined_at) {
                const level = effectivePartnerLevel(profile.partner_level, profile.total_downloads ?? 0);
                fee = feeFractionForLevel(level);
            }
            // Admins (house accounts) sell fee-free -- /api/checkout omits a
            // zero application_fee_amount, so Stripe sees no fee at all.
            // CardStreet Pro subscribers get the 5% floor; a partner ladder
            // already better than 5% still wins.
            if (profile.role === 'admin') {
                feeMap.set(profile.id, 0);
            } else {
                feeMap.set(profile.id, applyProSellerRate(fee, isPremium(profile.premium_until)));
            }
        }

        // ─── Shipping estimate per seller (in integer satang to avoid float drift) ───
        // Live Flash quote first (estimatePrice already includes the fuel
        // surcharge; upCountryAmount is the additive upcountry premium — together
        // they match Flash's real billed rate). Province-aware fallback (฿40
        // intra-Bangkok, ฿90 otherwise) only when Flash can't price the route.
        // This is applied identically in /api/orders/estimate so the displayed
        // total matches this charge and the no-overcharge guard doesn't false-trip.
        const sellerShippingSatang = new Map<string, number>();

        for (const sellerId of sellerIds) {
            const sp = sellerProfiles?.find(p => p.id === sellerId);
            // Sealed products (booster boxes, ETBs) weigh far more than cards —
            // quote off the card_data snapshots so heavy items aren't under-quoted.
            const sellerItems = listings
                .filter(l => l.seller_id === sellerId)
                .map(l => ({
                    isSealed: (l.card_data as any)?.isSealed === true,
                    productType: (l.card_data as any)?.productType ?? null,
                }));
            let baseSatang: number;
            try {
                const quote = await estimateRateWithCityFallback({
                    srcProvinceName: sp?.province || 'กรุงเทพมหานคร',
                    srcCityName: sp?.state || sp?.district || 'เขตบางรัก',
                    srcPostalCode: sp?.postcode || '10500',
                    dstProvinceName: buyerProfile?.province || 'กรุงเทพมหานคร',
                    dstCityName: buyerProfile?.state || buyerProfile?.district || 'เขตบางรัก',
                    dstPostalCode: buyerProfile?.postcode || '10110',
                    weight: estimateParcelWeightGramsForItems(sellerItems),
                    ...estimateParcelDimsCmForItems(sellerItems),
                });
                // Flash returns satang (cents) directly.
                baseSatang = quote.estimatePrice + quote.upCountryAmount;
                if (quote.usedCanonicalCity) {
                    console.warn(`[Orders/Checkout] Canonical-city retry used for seller ${sellerId} — ฿${baseSatang / 100}`);
                }
            } catch (err) {
                baseSatang = fallbackShippingSatang(sp?.province, buyerProfile?.province);
                if (isRegionError(err)) {
                    console.warn(`[Orders/Checkout] Flash region mismatch for seller ${sellerId} — fallback ฿${baseSatang / 100}`);
                } else {
                    console.error(`[Orders/Checkout] Flash estimate error for seller ${sellerId} — using fallback ฿${baseSatang / 100}:`, err);
                }
            }
            sellerShippingSatang.set(sellerId, baseSatang);
        }

        // ─── Build orders. Prices come from the DB; shipping is charged once per seller. ───
        const ordersToInsert: Record<string, unknown>[] = [];
        const shippingApplied = new Set<string>();

        for (const listing of listings) {
            const feePct = feeMap.get(listing.seller_id) || NON_PARTNER_FEE_FRACTION;

            // ─── Offer price override (server-authoritative) ───
            // When paying an accepted offer, the price is the accepted offer
            // amount from the DB — never the list price and never the client's
            // number. The offer must be `accepted`, belong to this buyer, match
            // this listing, and not already be linked to an order. platform_fee
            // recomputes off the override automatically; shipping is
            // price-independent. No reserve was taken on accept, so the
            // reservation CAS below still arbitrates the Buy-Now race.
            let priceSatang: number;
            if (acceptedOfferId) {
                const { data: offer } = await supabase
                    .from('offers')
                    .select('amount, status, buyer_id, listing_id, accepted_order_id')
                    .eq('id', acceptedOfferId)
                    .eq('listing_id', listing.id)
                    .single();
                if (!offer || offer.status !== 'accepted' || offer.buyer_id !== buyerId || offer.accepted_order_id) {
                    return NextResponse.json(
                        { error: 'Offer not payable', code: 'OFFER_NOT_PAYABLE' },
                        { status: 400 },
                    );
                }
                priceSatang = Math.round(Number(offer.amount) * 100);
            } else {
                priceSatang = Math.round(Number(listing.price) * 100);
            }

            const platformFeeSatang = Math.round(priceSatang * feePct);

            let shippingSatang = 0;
            if (!shippingApplied.has(listing.seller_id)) {
                shippingSatang = sellerShippingSatang.get(listing.seller_id)
                    ?? fallbackShippingSatang(
                        sellerProfiles?.find(p => p.id === listing.seller_id)?.province,
                        buyerProfile?.province,
                    );
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

        // ─── No-overcharge guard (before any side effects) ───
        // Compute the authoritative total now and compare against what the buyer
        // was shown. If we'd charge MORE than displayed, reject cleanly — no
        // listings reserved, no orders created — so the buyer reviews the new
        // total instead of getting a surprise charge. A 1-satang tolerance
        // absorbs rounding.
        const computedTotalSatang = ordersToInsert.reduce(
            (sum, o) => sum + Math.round(Number(o.total_amount) * 100) + Math.round(Number(o.shipping_fee) * 100),
            0,
        );
        if (expectedTotal !== null && computedTotalSatang > Math.round(expectedTotal * 100) + 1) {
            return NextResponse.json(
                {
                    error: 'Shipping was updated for this address. Please review your new total and try again.',
                    code: 'TOTAL_CHANGED',
                    total: computedTotalSatang / 100,
                },
                { status: 409 },
            );
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

        // ─── Link the accepted offer to its order (OBO) ───
        // Stamp accepted_order_id so the offer can't be re-paid and list-my-offers
        // shows it resolved. Best-effort (non-fatal): the authoritative void of
        // the OTHER offers on this listing happens post-payment in the fulfillment
        // sweep (lib/voidOffersForListing) once the sale is confirmed. The CAS on
        // status='accepted' + accepted_order_id IS NULL keeps this idempotent.
        if (acceptedOfferId && insertedOrders?.[0]?.id) {
            await supabase
                .from('offers')
                .update({ accepted_order_id: insertedOrders[0].id })
                .eq('id', acceptedOfferId)
                .eq('status', 'accepted')
                .is('accepted_order_id', null);
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
