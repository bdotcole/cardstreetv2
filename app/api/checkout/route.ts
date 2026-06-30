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
        const { currency, token, metadata } = body || {};
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
        // Currency is optional now — if omitted, falls back to the region's
        // default (USD on the US platform, THB on TH).

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
        };

        const { data: orders, error: ordersErr } = await admin
            .from('orders')
            .select(
                'id, buyer_id, seller_id, status, total_amount, shipping_fee, ' +
                'platform_fee, stripe_region'
            )
            .eq('transfer_group', transferGroup)
            .returns<OrderRow[]>();

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
        const amountSatang = orders.reduce(
            (sum, o) =>
                sum +
                Math.round(Number(o.total_amount || 0) * 100) +
                Math.round(Number(o.shipping_fee || 0) * 100),
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
        const chargeCurrency = (
            typeof currency === 'string' && currency.length > 0
                ? currency
                : defaultCurrencyForRegion(region)
        ).toLowerCase();

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

            // Application fee = platform_fee + shipping_fee, summed across the
            // cart's orders. Both stored as floats in THB; convert to satang and
            // re-floor to avoid 0.5-stang rounding drift across many small items.
            //
            // Why shipping is included: on this TH direct charge the buyer's full
            // payment (item + shipping) settles into the SELLER's connected
            // account, but Flash Express bills the single PLATFORM merchant
            // account for every label. Pulling shipping_fee into the application
            // fee routes the buyer's shipping payment back to the platform — the
            // entity Flash actually invoices — so shipping is pass-through rather
            // than a per-order platform loss. The seller still bears Stripe's
            // processing fee on the shipping portion (they're MOR on a direct
            // charge); that residual is small (~฿1.5–3.6) vs. the full Flash cost
            // the platform would otherwise eat.
            const applicationFeeSatang = orders.reduce(
                (sum, o) =>
                    sum +
                    Math.round(Number(o.platform_fee || 0) * 100) +
                    Math.round(Number(o.shipping_fee || 0) * 100),
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
            { error: error.message || 'Payment processing failed' },
            { status: 500 }
        );
    }
}
