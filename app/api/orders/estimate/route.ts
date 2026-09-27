/**
 * POST /api/orders/estimate
 *
 * Returns a shipping + total breakdown for the items in the buyer's cart
 * WITHOUT creating any orders or reserving listings. Mirrors the per-seller
 * shipping calculation in /api/orders/checkout so the displayed total matches
 * what the buyer will actually be charged.
 *
 * Used by PaymentModal on open to show the buyer the real total (subtotal +
 * shipping) before they enter card details. The actual order rows are only
 * inserted when /api/orders/checkout runs at pay time.
 *
 * Auth: caller must be the buyer.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    fetchSellerMinOrders,
    minOrderShortfall,
    minOrderMessage,
    MIN_ORDER_NOT_MET_ERROR_CODE,
} from '@/lib/minOrder';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
    BUYER_PROFILE_INCOMPLETE_TOAST,
    BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
    SELLER_PAUSED_TOAST,
    SELLER_PAUSED_ERROR_CODE,
} from '@/lib/profileValidation';
import { checkRateLimit } from '@/lib/rateLimit';
import { getStripeForRegion, isRegionConfigured } from '@/lib/stripe';
import { ensurePaymentMethodDomainsWithin } from '@/lib/stripePaymentDomains';

const EstimateBodySchema = z.object({
    items: z
        .array(
            z.object({
                id: z.string().min(1),
            }),
        )
        .min(1)
        .max(50),
    // OBO: when paying an accepted offer, the modal must show the AGREED price, not
    // the list price. Server-authoritative — the price is read from the offer row.
    acceptedOfferId: z.string().optional(),
});

export async function POST(req: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Each call fans out a synchronous Flash rate quote per seller on the
        // checkout hot path. Cap per buyer so a loop can't exhaust the Flash
        // quota or wedge checkout latency. 30/min never limits a real buyer.
        const rl = await checkRateLimit(`estimate:${user.id}:1m`, { windowSeconds: 60, max: 30 });
        if (!rl.allowed) {
            return NextResponse.json(
                { error: 'Too many requests. Please wait a moment and try again.' },
                { status: 429, headers: { 'Retry-After': '30' } },
            );
        }

        const parsed = EstimateBodySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid estimate request', details: parsed.error.flatten() },
                { status: 400 },
            );
        }
        const { items } = parsed.data;
        // Gated identically to the /api/orders/checkout override so the estimate and
        // the charge agree. Ignored unless offers are enabled.
        const acceptedOfferId =
            process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1' &&
            typeof parsed.data.acceptedOfferId === 'string' && parsed.data.acceptedOfferId.length > 0
                ? parsed.data.acceptedOfferId
                : null;

        const supabase = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        // ─── Gate: buyer must have a complete shipping profile ───
        // Matches the gate in /api/orders/checkout so the estimate UI can't
        // imply a buyer is allowed to proceed when they're not.
        const { data: buyerProfileGate, error: buyerProfileErr } = await supabase
            .from('profiles')
            .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
            .eq('id', user.id)
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

        // Re-derive seller + price from the DB. Estimate must match what we
        // will actually charge at /api/orders/checkout.
        const { data: listings } = await supabase
            .from('listings')
            .select('id, seller_id, price, status, card_data')
            .in('id', items.map(i => i.id));

        if (!listings || listings.length !== items.length) {
            return NextResponse.json({ error: 'One or more listings no longer exist' }, { status: 400 });
        }
        // Seller paused their shop (vacation mode): tell the buyer the card is
        // coming back rather than gone. Mirrors /api/orders/checkout.
        if (listings.some(l => l.status === 'paused')) {
            return NextResponse.json(
                { error: SELLER_PAUSED_TOAST, code: SELLER_PAUSED_ERROR_CODE },
                { status: 409 },
            );
        }
        if (listings.some(l => l.status !== 'active')) {
            return NextResponse.json({ error: 'One or more listings are no longer available' }, { status: 409 });
        }

        // OBO: resolve the agreed offer price (server-authoritative). Same validation
        // as /api/orders/checkout so the shown subtotal equals the charged amount.
        let offerPriceByListing: Map<string, number> | null = null;
        if (acceptedOfferId) {
            const { data: offer } = await supabase
                .from('offers')
                .select('amount, status, buyer_id, listing_id, accepted_order_id')
                .eq('id', acceptedOfferId)
                .single();
            if (!offer || offer.status !== 'accepted' || offer.buyer_id !== user.id
                || offer.accepted_order_id || !listings.some(l => l.id === offer.listing_id)) {
                return NextResponse.json(
                    { error: 'Offer not payable', code: 'OFFER_NOT_PAYABLE' },
                    { status: 400 },
                );
            }
            offerPriceByListing = new Map([[offer.listing_id, Number(offer.amount)]]);
        }

        const sellerIds = [...new Set(listings.map(l => l.seller_id))];

        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('id, province, state, district, postcode, stripe_account_id, stripe_region, stripe_charges_enabled')
            .in('id', sellerIds);

        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('province, state, district, postcode')
            .eq('id', user.id)
            .single();

        // Shipping is inside every listing price (seller-set, since 2026-09-27):
        // the buyer pays the list price and nothing more. No courier quote is
        // made here, so the payment form never waits on Flash. The per-seller
        // fields stay in the response shape for older clients, all zero.
        const sellerShipping = new Map<string, number>(sellerIds.map((id) => [id, 0]));
        const sellerShippingIsFallback = new Map<string, boolean>(sellerIds.map((id) => [id, false]));

        // The shop's minimum order, identical to the gate in
        // /api/orders/checkout so the payment form never opens on a cart that
        // checkout would refuse. Accepted offers are exempt; fail-soft read.
        if (!acceptedOfferId) {
            const minOrders = await fetchSellerMinOrders(supabase, sellerIds, 'profiles');
            for (const sellerId of sellerIds) {
                const minOrder = minOrders[sellerId] ?? 0;
                if (minOrder <= 0) continue;
                const sellerSubtotal = listings
                    .filter(l => l.seller_id === sellerId)
                    .reduce((sum, l) => sum + Number(l.price || 0), 0);
                const shortfall = minOrderShortfall(sellerSubtotal, minOrder);
                if (shortfall > 0) {
                    return NextResponse.json(
                        {
                            error: minOrderMessage(false, minOrder, shortfall),
                            code: MIN_ORDER_NOT_MET_ERROR_CODE,
                            minOrder,
                            shortfall,
                        },
                        { status: 409 },
                    );
                }
            }
        }

        const subtotal = listings.reduce(
            (sum, l) => sum + (offerPriceByListing?.get(l.id) ?? Number(l.price || 0)),
            0,
        );
        const shipping = 0;
        const total = subtotal;
        const shippingIsEstimate = false;

        // For Thailand direct charges the buyer's card must be tokenized in the
        // SELLER's connected-account context (Stripe.js `stripeAccount`), or the
        // PaymentIntent that /api/checkout creates on that account rejects the
        // platform-scoped PaymentMethod. Only single-seller TH carts qualify
        // (matches the direct-charge constraint in /api/checkout); otherwise we
        // return null and the client tokenizes on the platform (US legacy).
        let sellerStripeAccountId: string | null = null;
        // True unless we can positively see a single-seller TH cart whose seller
        // hasn't finished Stripe verification (charges_enabled still false).
        // Sellers can list before verifying (list-first), so the buyer UI uses
        // this flag to block the pay step up front — an unverified seller's
        // listing is browsable but not purchasable until they verify. The
        // authoritative block is server-side in /api/orders/checkout.
        let sellerPayoutReady = true;
        if (sellerIds.length === 1) {
            const seller = sellerProfiles?.find(p => p.id === sellerIds[0]) as
                | { stripe_account_id?: string | null; stripe_region?: string | null; stripe_charges_enabled?: boolean | null }
                | undefined;
            if (seller?.stripe_region === 'th') {
                const ready = !!(seller.stripe_account_id && seller.stripe_charges_enabled);
                sellerPayoutReady = ready;
                if (ready) sellerStripeAccountId = seller.stripe_account_id!;
            }
        }

        // The payment form mounts as soon as this responds, and Apple Pay /
        // Google Pay only render if cardstreet.app is registered on the
        // seller's account by then. Bounded so Stripe can't stall checkout.
        if (sellerStripeAccountId && isRegionConfigured('th')) {
            await ensurePaymentMethodDomainsWithin(getStripeForRegion('th'), sellerStripeAccountId, 2500);
        }

        return NextResponse.json({
            success: true,
            subtotal,
            shipping,
            total,
            // True if any seller's shipping line uses the fallback (Flash didn't
            // return a real rate). UI should flag the total as "approx" so the
            // buyer knows it may shift slightly at checkout.
            shippingIsEstimate,
            // Connected account to bind Stripe.js to for a direct charge, or null
            // when tokenizing on the platform. See PaymentModal.
            sellerStripeAccountId,
            // False only for a single-seller TH cart whose seller hasn't finished
            // Stripe verification yet. PaymentModal blocks the pay step on this.
            sellerPayoutReady,
            perSellerShipping: Object.fromEntries(sellerShipping),
            perSellerShippingIsFallback: Object.fromEntries(sellerShippingIsFallback),
        });
    } catch (err: any) {
        console.error('[Orders/Estimate] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to estimate order total' },
            { status: 500 },
        );
    }
}
