/**
 * POST /api/live/spots/checkout — turn the caller's held spots into
 * pending_payment orders, mirroring app/api/orders/checkout for the
 * spot-shaped case:
 *
 *   - one order per spot; listing_id NULL, break_spot_id set
 *   - total_amount = the spot's DB price (satang -> THB exactly once, here)
 *   - shipping_fee 0 — shipping is consolidated per buyer at stream settle
 *   - platform_fee = the seller's tier fee (lib/partnerTiers.ts ladder)
 *   - one shared transfer_group `live_...` the client hands to the EXISTING
 *     /api/checkout + PaymentModal rail
 *
 * Single seller is by construction: all spots must belong to one stream, and
 * a stream has one seller — which is exactly what the TH direct-charge model
 * requires of a PaymentIntent.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import {
    applyProSellerRate,
    effectivePartnerLevel,
    feeFractionForLevel,
    NON_PARTNER_FEE_FRACTION,
} from '@/lib/partnerTiers';
import { isPremium } from '@/lib/entitlements';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
    BUYER_PROFILE_INCOMPLETE_TOAST,
    BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
    SELLER_UNVERIFIED_TOAST,
    SELLER_UNVERIFIED_ERROR_CODE,
} from '@/lib/profileValidation';
import { isValidThaiPhone } from '@/lib/utils/phone';

const MAX_SPOTS_PER_CHECKOUT = 10;
// PromptPay payments routinely take minutes; the 180s claim hold would lapse
// mid-payment and let another buyer steal the spot out from under a paying
// one. The order creation moment is the signal of real payment intent, so the
// hold is extended here. finalize_break_spot's CAS still arbitrates if the
// extended hold also lapses.
const CHECKOUT_HOLD_SECONDS = 600;

interface SpotRow {
    id: string;
    stream_item_id: string;
    stream_id: string;
    seller_id: string;
    spot_number: number;
    price: number; // satang
    status: string;
    held_by: string | null;
    hold_expires_at: string | null;
}

export async function POST(req: Request) {
    try {
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const buyerId = gate.user.id;

        // Same TH-only gate as orders/checkout, before any DB writes.
        const country = getRequestCountry(req);
        if (!isPurchaseAllowedFromCountry(country)) {
            return NextResponse.json(
                {
                    error:
                        'Purchases are currently only available in Thailand. ' +
                        'Buying is coming soon to your country.',
                    code: 'GEO_RESTRICTED',
                    country,
                },
                { status: 403 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const spotIds: string[] = Array.isArray(body?.spotIds)
            ? body.spotIds.filter((x: unknown): x is string => typeof x === 'string')
            : [];
        const paymentMethod: string =
            typeof body?.paymentMethod === 'string' ? body.paymentMethod : 'credit_card';

        if (spotIds.length === 0) {
            return NextResponse.json({ error: 'No spots provided' }, { status: 400 });
        }
        if (spotIds.length > MAX_SPOTS_PER_CHECKOUT) {
            return NextResponse.json(
                { error: `At most ${MAX_SPOTS_PER_CHECKOUT} spots per checkout` },
                { status: 400 },
            );
        }
        if (new Set(spotIds).size !== spotIds.length) {
            return NextResponse.json({ error: 'Duplicate spot ids' }, { status: 400 });
        }

        const admin = createAdminClient();

        // ─── Buyer must be shippable (mirrors orders/checkout) ───
        // Spot orders carry no shipping fee, but settle builds ONE Flash parcel
        // from the buyer's profile address — an unshippable buyer would strand
        // the seller with paid, undeliverable spots.
        const { data: buyerProfileGate, error: buyerProfileErr } = await admin
            .from('profiles')
            .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
            .eq('id', buyerId)
            .single<Record<string, string | null>>();

        if (buyerProfileErr || !buyerProfileGate) {
            return NextResponse.json({ error: 'Buyer profile not found' }, { status: 404 });
        }
        const completeness = checkBuyerProfileComplete(buyerProfileGate);
        if (!completeness.complete) {
            return NextResponse.json(
                {
                    error: BUYER_PROFILE_INCOMPLETE_TOAST,
                    code: BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
                    missing: completeness.missing,
                },
                { status: 400 },
            );
        }
        if (!isValidThaiPhone(buyerProfileGate.phone_number)) {
            return NextResponse.json(
                {
                    error: BUYER_PROFILE_INCOMPLETE_TOAST,
                    code: BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
                    missing: ['phone_number'],
                },
                { status: 400 },
            );
        }

        // ─── Spots: prices come from these rows, never the body ───
        const { data: spots, error: spotsErr } = await admin
            .from('break_spots')
            .select('id, stream_item_id, stream_id, seller_id, spot_number, price, status, held_by, hold_expires_at')
            .in('id', spotIds)
            .returns<SpotRow[]>();

        if (spotsErr || !spots) {
            console.error('[Live/SpotsCheckout] spot fetch failed:', spotsErr?.message);
            return NextResponse.json({ error: 'Failed to fetch spots' }, { status: 500 });
        }
        if (spots.length !== spotIds.length) {
            return NextResponse.json({ error: 'One or more spots no longer exist' }, { status: 400 });
        }

        const streamIds = new Set(spots.map(s => s.stream_id));
        if (streamIds.size > 1) {
            return NextResponse.json(
                { error: 'All spots must belong to the same stream' },
                { status: 400 },
            );
        }

        const now = Date.now();
        const notHeldByBuyer = spots.find(
            s =>
                s.status !== 'held' ||
                s.held_by !== buyerId ||
                !s.hold_expires_at ||
                Date.parse(s.hold_expires_at) <= now,
        );
        if (notHeldByBuyer) {
            return NextResponse.json(
                {
                    error: 'Your hold on one or more spots has expired — claim them again',
                    code: 'HOLD_EXPIRED',
                    spotId: notHeldByBuyer.id,
                },
                { status: 409 },
            );
        }

        const sellerId = spots[0].seller_id;
        // Denormalized seller_id should be uniform within one stream; a
        // mismatch means corrupted data, not a user error.
        if (spots.some(s => s.seller_id !== sellerId)) {
            console.error('[Live/SpotsCheckout] seller mismatch within stream', [...streamIds][0]);
            return NextResponse.json({ error: 'Spot data inconsistent' }, { status: 500 });
        }
        if (sellerId === buyerId) {
            return NextResponse.json({ error: "You can't buy your own spots" }, { status: 400 });
        }

        // ─── Seller: fee tier + charge capability + platform region ───
        const { data: seller } = await admin
            .from('profiles')
            .select('id, role, partner_level, total_downloads, partner_joined_at, premium_until, stripe_region, stripe_account_id, stripe_charges_enabled')
            .eq('id', sellerId)
            .maybeSingle<{
                id: string;
                role: string | null;
                partner_level: unknown;
                total_downloads: number | null;
                partner_joined_at: string | null;
                premium_until: string | null;
                stripe_region: string | null;
                stripe_account_id: string | null;
                stripe_charges_enabled: boolean | null;
            }>();

        if (!seller) {
            return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
        }
        if (!(seller.stripe_account_id && seller.stripe_charges_enabled)) {
            return NextResponse.json(
                { error: SELLER_UNVERIFIED_TOAST, code: SELLER_UNVERIFIED_ERROR_CODE },
                { status: 409 },
            );
        }

        // Same ladder as orders/checkout: partners by earned/granted level,
        // Pro floor, admins fee-free.
        let feePct = NON_PARTNER_FEE_FRACTION;
        if (seller.partner_joined_at) {
            const level = effectivePartnerLevel(seller.partner_level, seller.total_downloads ?? 0);
            feePct = feeFractionForLevel(level);
        }
        feePct = seller.role === 'admin'
            ? 0
            : applyProSellerRate(feePct, isPremium(seller.premium_until));

        const orderRegion = seller.stripe_region === 'th' || seller.stripe_region === 'us'
            ? seller.stripe_region
            : 'us';

        // ─── One payable group per spot ───
        // A buyer who abandons the payment sheet and re-enters checkout would
        // otherwise leave TWO pending_payment groups pointing at the same
        // spots — and both PaymentIntents stay chargeable (a stale PromptPay
        // QR especially), so paying both double-charges for one spot.
        // CAS-cancel any prior pending orders by this buyer for these spots
        // so exactly one payable group exists; paid orders are untouched.
        const { error: staleCancelErr } = await admin
            .from('orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('buyer_id', buyerId)
            .in('break_spot_id', spotIds)
            .eq('status', 'pending_payment');
        if (staleCancelErr) {
            // Proceeding would risk the double charge this guard exists for.
            console.error('[Live/SpotsCheckout] stale-order cancel failed:', staleCancelErr.message);
            return NextResponse.json({ error: 'Failed to create orders' }, { status: 500 });
        }

        const transferGroup = `live_${randomUUID()}`;

        // ─── One order per spot. Satang -> THB happens exactly here. ───
        const ordersToInsert = spots.map(spot => {
            const priceSatang = Math.round(Number(spot.price));
            return {
                listing_id: null,
                break_spot_id: spot.id,
                buyer_id: buyerId,
                seller_id: sellerId,
                status: 'pending_payment',
                total_amount: priceSatang / 100,
                platform_fee: Math.round(priceSatang * feePct) / 100,
                shipping_fee: 0,
                escrow_status: 'held',
                payment_method: paymentMethod,
                transfer_group: transferGroup,
                stripe_region: orderRegion,
            };
        });

        const { data: insertedOrders, error: insertErr } = await admin
            .from('orders')
            .insert(ordersToInsert)
            .select('id, break_spot_id');

        if (insertErr || !insertedOrders) {
            console.error('[Live/SpotsCheckout] order insert failed:', insertErr?.message);
            return NextResponse.json({ error: 'Failed to create orders' }, { status: 500 });
        }

        // ─── Extend the holds for the payment window (see constant above) ───
        const { data: extendedRows, error: extendErr } = await admin
            .from('break_spots')
            .update({
                hold_expires_at: new Date(now + CHECKOUT_HOLD_SECONDS * 1000).toISOString(),
            })
            .in('id', spotIds)
            .eq('status', 'held')
            .eq('held_by', buyerId)
            .select('id');

        if (extendErr || (extendedRows?.length ?? 0) !== spotIds.length) {
            // A hold lapsed (or was stolen) between the held-by verification
            // read above and this extend — the orders just minted would charge
            // for spots the buyer no longer holds. Roll them back so no
            // payable group survives, and make the client re-claim.
            console.error(
                '[Live/SpotsCheckout] hold extend covered',
                extendedRows?.length ?? 0, 'of', spotIds.length, 'spots',
                extendErr ? `(${extendErr.message})` : '',
            );
            await admin
                .from('orders')
                .delete()
                .in('id', insertedOrders.map(o => o.id));
            return NextResponse.json(
                {
                    error: 'Your hold on one or more spots has expired — claim them again',
                    code: 'HOLD_EXPIRED',
                },
                { status: 409 },
            );
        }

        const totalSatang = spots.reduce((sum, s) => sum + Math.round(Number(s.price)), 0);

        return NextResponse.json({
            success: true,
            transferGroup,
            orderIds: insertedOrders.map(o => o.id),
            // Single source of truth for the amount /api/checkout will charge.
            totalAmount: totalSatang / 100,
            totalSatang,
            region: orderRegion,
            // TH direct charge: the client must load Stripe.js bound to the
            // seller's connected account BEFORE mounting Elements, or the card
            // would tokenize on the platform and the confirm would fail with
            // "No such payment_method" (same contract as /api/orders/estimate).
            sellerStripeAccount: seller.stripe_account_id,
        });
    } catch (err: any) {
        console.error('[Live/SpotsCheckout] error:', err);
        return NextResponse.json({ error: 'Checkout failed' }, { status: 500 });
    }
}
