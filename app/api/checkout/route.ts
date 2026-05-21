/**
 * POST /api/checkout
 *
 * Creates and confirms a Stripe PaymentIntent for an already-created
 * transfer_group of pending_payment orders.
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

export async function POST(req: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        if (!token || typeof token !== 'string') {
            return NextResponse.json({ error: 'Stripe payment method id (token) is required' }, { status: 400 });
        }
        // Currency is optional now — if omitted, falls back to the region's
        // default (USD on the US platform, THB on TH).

        // ─── Load the pending orders and verify ownership ───
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: orders, error: ordersErr } = await admin
            .from('orders')
            .select('id, buyer_id, status, total_amount, shipping_fee, stripe_region')
            .eq('transfer_group', transferGroup);

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
        // so a re-attempt can't be routed through the wrong platform.
        const region: StripeRegion = orders[0].stripe_region === 'th' ? 'th' : 'us';
        const stripe = getStripeForRegion(region);
        const baseUrl = getAppBaseUrl();
        const chargeCurrency = (
            typeof currency === 'string' && currency.length > 0
                ? currency
                : defaultCurrencyForRegion(region)
        ).toLowerCase();

        // Idempotency key bound to the order group so a retry of the same
        // checkout request will not create or confirm a second PaymentIntent.
        const idempotencyKey = `checkout:${transferGroup}`;

        const paymentIntent = await stripe.paymentIntents.create(
            {
                amount: amountSatang,
                currency: chargeCurrency,
                payment_method: token,
                confirm: true,
                return_url: `${baseUrl}/?payment_status=complete`,
                metadata: {
                    transfer_group: transferGroup,
                    buyer_id: user.id,
                    stripe_region: region,
                },
                transfer_group: transferGroup,
            },
            { idempotencyKey },
        );

        return NextResponse.json({
            status: paymentIntent.status,
            id: paymentIntent.id,
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
