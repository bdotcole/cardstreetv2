/**
 * POST /api/checkout
 *
 * Creates and confirms a Stripe PaymentIntent for an already-created
 * transfer_group of pending_payment orders.
 *
 * Charge model depends on the order's stripe_region:
 *   - 'th' (current): destination-charge PaymentIntent. transfer_data.destination
 *     and on_behalf_of point at the seller's connected account, so the seller
 *     is merchant of record (Stripe TH requirement — platforms can't be
 *     loss-liable). The platform takes an application_fee_amount equal to the
 *     summed platform_fee on the orders. Buyer's funds settle into the
 *     seller's Stripe balance with payouts disabled; release-funds pushes
 *     them to the seller's bank later. Single-seller cart only.
 *
 *   - 'us' (legacy): separate-charges-and-transfers PaymentIntent on the
 *     platform balance. release-funds creates a Transfer to the seller.
 *     Multi-seller carts allowed.
 *
 * Security model:
 *   - Caller must be authenticated and be the buyer for every order in the group.
 *   - The amount comes from the DB (sum of total_amount + shipping_fee on
 *     pending_payment orders) — never from the client.
 *   - Idempotency key derived from transfer_group prevents double-charge on
 *     retry (network hiccup, double-tap).
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
    getStripeForRegion,
    getAppBaseUrl,
    defaultCurrencyForRegion,
    type StripeRegion,
} from '@/lib/stripe';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import { SELLER_UNVERIFIED_ERROR_CODE } from '@/lib/profileValidation';
import type Stripe from 'stripe';

export async function POST(req: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Defense in depth — /api/orders/checkout already gated this, but block
        // non-Thailand buyers here too so the PaymentIntent can never be
        // created out of region. See lib/geo.ts.
        const buyerCountry = getRequestCountry(req);
        if (!isPurchaseAllowedFromCountry(buyerCountry)) {
            return NextResponse.json(
                {
                    error:
                        'Purchases are currently only available in Thailand. ' +
                        'Buying is coming soon to your country.',
                    code: 'GEO_RESTRICTED',
                },
                { status: 403 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const { token, metadata } = body || {};
        const transferGroup: string | undefined = metadata?.transfer_group;

        if (!transferGroup || typeof transferGroup !== 'string') {
            return NextResponse.json(
                { error: 'transfer_group is required — create orders first via /api/orders/checkout' },
                { status: 400 }
            );
        }
        // Two charge flows are supported:
        //   - PaymentElement (current): no `token`. We create an unconfirmed
        //     PaymentIntent and return its client_secret; the client confirms
        //     with stripe.confirmPayment, which also unlocks non-card methods
        //     like PromptPay. This is the path the app uses.
        //   - Legacy card token: `token` is a card PaymentMethod id we confirm
        //     server-side. Kept for back-compat with any older client.
        const usePaymentElement = !token;
        if (token && typeof token !== 'string') {
            return NextResponse.json({ error: 'Invalid payment method token' }, { status: 400 });
        }

        // ─── Load the pending orders and verify ownership ───
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        type OrderRow = {
            id: string;
            buyer_id: string;
            seller_id: string;
            status: string;
            total_amount: number | null;
            shipping_fee: number | null;
            platform_fee: number | null;
            stripe_region: string | null;
            discount_amount?: number | null;
        };

        // discount_amount is the Collector Pass voucher discount (20260829
        // migration). Selecting a missing column fails the WHOLE query, so
        // fall back to the legacy list until the migration is applied —
        // checkout must never break over a cosmetic-era column.
        let { data: orders, error: ordersErr } = await admin
            .from('orders')
            .select(
                'id, buyer_id, seller_id, status, total_amount, shipping_fee, ' +
                'platform_fee, stripe_region, discount_amount'
            )
            .eq('transfer_group', transferGroup)
            .returns<OrderRow[]>();
        if (ordersErr) {
            ({ data: orders, error: ordersErr } = await admin
                .from('orders')
                .select(
                    'id, buyer_id, seller_id, status, total_amount, shipping_fee, ' +
                    'platform_fee, stripe_region'
                )
                .eq('transfer_group', transferGroup)
                .returns<OrderRow[]>());
        }

        if (ordersErr || !orders || orders.length === 0) {
            return NextResponse.json({ error: 'No orders for this transfer_group' }, { status: 404 });
        }
        if (!orders.every(o => o.buyer_id === user.id)) {
            return NextResponse.json({ error: 'You are not the buyer for these orders' }, { status: 403 });
        }
        if (!orders.every(o => o.status === 'pending_payment')) {
            return NextResponse.json(
                { error: 'These orders are not in a payable state — they may have already been processed' },
                { status: 409 }
            );
        }

        // ─── Authoritative amount in satang (integer math, never floats). ───
        // discount_amount (voucher) comes off the buyer's charge; the matching
        // platform_fee reduction was stamped at order creation, so the
        // application_fee sum below is already discounted and the seller's
        // net (charge − fee) is unchanged.
        const amountSatang = orders.reduce(
            (sum, o) =>
                sum +
                Math.round(Number(o.total_amount || 0) * 100) +
                Math.round(Number(o.shipping_fee || 0) * 100) -
                Math.round(Number(o.discount_amount || 0) * 100),
            0,
        );
        if (amountSatang <= 0) {
            return NextResponse.json({ error: 'Order total is zero — refusing to charge' }, { status: 400 });
        }

        // ─── Route to the correct Stripe platform. ───
        // The region is sticky on the order rows (set when orders were created),
        // so a re-attempted payment can't be routed through the wrong platform.
        const region: StripeRegion = orders[0].stripe_region === 'th' ? 'th' : 'us';
        const stripe = getStripeForRegion(region);
        const baseUrl = getAppBaseUrl();
        // Charge currency is fixed by the platform region — order amounts are
        // stored in THB, so the currency is never client-controllable. (An
        // earlier version trusted the client's *display* currency here, which
        // paired the THB amount with `usd` and would have charged a ฿340 order
        // as $340.)
        const chargeCurrency = defaultCurrencyForRegion(region);

        // ─── Build PaymentIntent params per region. ───
        const idempotencyKey = `checkout:${transferGroup}`;
        const piParams: Stripe.PaymentIntentCreateParams = {
            amount: amountSatang,
            currency: chargeCurrency,
            metadata: {
                transfer_group: transferGroup,
                buyer_id: user.id,
                stripe_region: region,
            },
            transfer_group: transferGroup,
            // Ask the issuer for a 3DS challenge rather than letting Stripe pick.
            // Left unset, Stripe chose "Data Only" 3DS — it shares data with the
            // issuer but never challenges the cardholder, so fraud liability
            // stays with the issuer. On high-value cross-border cards that is a
            // decline pattern: three attempts on one ฿8,536 order (Visa ••1606,
            // MC ••8276, MC ••5158 — NZ-issued, TH billing address) all came
            // back `card_declined` after Data Only auth, and the Aug 9-23 window
            // ran a 62.5% failure rate across ฿39,055. Requesting the challenge
            // shifts liability to the issuer, which is what lifts approval on
            // exactly this profile.
            payment_method_options: {
                card: { request_three_d_secure: 'any' },
            },
        };

        if (usePaymentElement) {
            // Let Stripe surface every method enabled on the account (card +
            // PromptPay on the TH platform). The client confirms with
            // stripe.confirmPayment(), supplying the return_url then.
            piParams.automatic_payment_methods = { enabled: true };
        } else {
            // Legacy server-side card confirmation.
            piParams.payment_method = token;
            piParams.confirm = true;
            piParams.return_url = `${baseUrl}/?payment_status=complete`;
        }

        // Request options for the PaymentIntent create call. On TH this gets
        // `stripeAccount` set so the charge is created directly on the
        // seller's connected account (direct charge model — Stripe TH platform
        // setup specifies sellers collect payments directly). On US (legacy)
        // it stays empty and the charge lands on the platform.
        const requestOptions: { idempotencyKey: string; stripeAccount?: string } = {
            idempotencyKey,
        };

        if (region === 'th') {
            // Direct charge: PaymentIntent is created ON the seller's connected
            // account. Funds settle into that account; the platform takes an
            // application_fee_amount. Single seller per cart is enforced at
            // /api/orders/checkout — this is a defensive secondary check.
            const sellerIds = [...new Set(orders.map(o => o.seller_id))];
            if (sellerIds.length !== 1) {
                return NextResponse.json(
                    {
                        error:
                            'Multi-seller carts are not supported on the Thailand platform. ' +
                            'Check out one seller at a time.',
                    },
                    { status: 400 }
                );
            }
            const sellerId = sellerIds[0];

            // Resolve the seller's connected Stripe account.
            const { data: seller, error: sellerErr } = await admin
                .from('profiles')
                .select('stripe_account_id, stripe_charges_enabled, stripe_region')
                .eq('id', sellerId)
                .single<{
                    stripe_account_id: string | null;
                    stripe_charges_enabled: boolean | null;
                    stripe_region: string | null;
                }>();

            if (sellerErr || !seller?.stripe_account_id) {
                return NextResponse.json(
                    {
                        error: 'Seller has not finished Stripe onboarding — cannot charge yet.',
                        code: SELLER_UNVERIFIED_ERROR_CODE,
                    },
                    { status: 409 }
                );
            }
            if (seller.stripe_region !== 'th') {
                return NextResponse.json(
                    { error: 'Seller account is not on the Thailand Stripe platform.' },
                    { status: 409 }
                );
            }
            if (!seller.stripe_charges_enabled) {
                return NextResponse.json(
                    {
                        error:
                            "Seller's Stripe account is still being verified. Please try " +
                            'again later.',
                        code: SELLER_UNVERIFIED_ERROR_CODE,
                    },
                    { status: 409 }
                );
            }

            // Application fee = platform_fee ONLY (the seller's tier cut), summed
            // across the cart's orders. Stored as a float in THB; convert to
            // satang and re-floor to avoid 0.5-stang rounding drift.
            //
            // Shipping is deliberately NOT in the application fee. On this TH
            // direct charge the buyer's full payment (item + shipping) settles
            // into the SELLER's connected account, and Flash Express bills the
            // SENDER (the seller) for the freight at pickup — the waybill reads
            // "Paid by sender", and the platform's account is never invoiced for
            // it. So the buyer's shipping payment must STAY in the seller's
            // balance to fund what they pay Flash. Pulling it into the application
            // fee would hand the seller's shipping money to the platform while
            // the seller still pays the courier out of pocket — leaving them
            // underwater on every sale.
            //
            // (An earlier version added shipping_fee here on the assumption that
            // Flash invoices the platform. A real shipment disproved it — order
            // 26126d8d: Flash freight ฿18 "Paid by sender" while the platform had
            // already collected the ฿36 shipping estimate. Reverted.)
            const applicationFeeSatang = orders.reduce(
                (sum, o) => sum + Math.round(Number(o.platform_fee || 0) * 100),
                0,
            );

            if (applicationFeeSatang > 0 && applicationFeeSatang < amountSatang) {
                piParams.application_fee_amount = applicationFeeSatang;
            }

            // The defining bit of a direct charge: create the PaymentIntent
            // on the seller's connected account, not the platform.
            requestOptions.stripeAccount = seller.stripe_account_id;
        }

        const paymentIntent = await stripe.paymentIntents.create(piParams, requestOptions);

        // Record the PaymentIntent id on the group's orders so the
        // reconciliation cron (app/api/cron/reconcile-pending-orders) can verify
        // a stalled checkout against Stripe before cancelling — distinguishing an
        // abandoned attempt from an in-flight PromptPay or a paid-but-webhook-lost
        // order. Best-effort: never fail the charge over this (e.g. if the column
        // hasn't been migrated yet). The webhook/finalize path remains canonical.
        {
            const { error: piIdErr } = await admin
                .from('orders')
                .update({ stripe_payment_intent_id: paymentIntent.id })
                .eq('transfer_group', transferGroup)
                .eq('status', 'pending_payment');
            if (piIdErr) {
                console.error('[Checkout] Could not record payment_intent_id (non-fatal):', piIdErr.message);
            }
        }

        return NextResponse.json({
            status: paymentIntent.status,
            id: paymentIntent.id,
            client_secret: paymentIntent.client_secret,
            transfer_group: transferGroup,
            region,
        });
    } catch (error: any) {
        console.error('[Checkout] Stripe PaymentIntent Error:', error);
        return NextResponse.json(
            // Stripe's own error code rides along (e.g. 'amount_too_small')
            // so callers can tell a permanent rejection from a retryable one
            // instead of pattern-matching Stripe's raw English message.
            // Additive — existing consumers read `error` and are unaffected.
            { error: error.message || 'Payment processing failed', code: error.code },
            { status: 500 }
        );
    }
}
