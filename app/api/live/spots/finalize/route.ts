/**
 * POST /api/live/spots/finalize — after the existing /api/checkout +
 * PaymentModal rail succeeds, verify the PaymentIntent and flip the spots.
 *
 * Mirrors app/api/orders/finalize: verify the PI succeeded ON THE CORRECT
 * platform (TH direct charges live on the seller's connected account), then
 * delegate to lib/liveSpotFulfillment.ts — the SAME implementation the Stripe
 * webhook runs on payment_intent.succeeded, so this client fallback and the
 * async-payment (PromptPay) path can never diverge (the lib does: CAS
 * the orders pending_payment -> paid, then finalize_break_spot per spot and
 * announce each sale in chat). NOT the general fulfillment path — spot orders
 * must not get per-order Flash shipments; that happens consolidated at settle.
 *
 * Idempotent: the order CAS decides who announces; finalize_break_spot is
 * CAS-guarded in SQL; a re-run after full success is a no-op success.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeForRegion, type StripeRegion } from '@/lib/stripe';
import { finalizeLiveSpotOrders } from '@/lib/liveSpotFulfillment';

interface SpotOrderRow {
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    stripe_region: string | null;
    break_spot_id: string;
}

export async function POST(req: Request) {
    try {
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const body = await req.json().catch(() => ({}));
        const transferGroup = typeof body?.transferGroup === 'string' ? body.transferGroup : null;
        const paymentIntentId = typeof body?.paymentIntentId === 'string' ? body.paymentIntentId : null;
        if (!transferGroup || !paymentIntentId) {
            return NextResponse.json(
                { error: 'transferGroup and paymentIntentId are required' },
                { status: 400 },
            );
        }

        const admin = createAdminClient();

        // Only spot orders — this route must never touch listing orders even
        // if handed a marketplace transfer_group.
        const { data: orders } = await admin
            .from('orders')
            .select('id, buyer_id, seller_id, status, stripe_region, break_spot_id')
            .eq('transfer_group', transferGroup)
            .not('break_spot_id', 'is', null)
            .returns<SpotOrderRow[]>();

        if (!orders || orders.length === 0) {
            return NextResponse.json(
                { error: 'No spot orders found for this transfer_group' },
                { status: 404 },
            );
        }
        if (!orders.every(o => o.buyer_id === user.id)) {
            return NextResponse.json(
                { error: 'You are not the buyer for these orders' },
                { status: 403 },
            );
        }

        // ─── Verify the PaymentIntent on the platform that charged it ───
        const region: StripeRegion = orders[0].stripe_region === 'th' ? 'th' : 'us';
        const stripe = getStripeForRegion(region);

        let lookupOptions: { stripeAccount?: string } | undefined;
        if (region === 'th') {
            const { data: seller } = await admin
                .from('profiles')
                .select('stripe_account_id')
                .eq('id', orders[0].seller_id)
                .single<{ stripe_account_id: string | null }>();
            if (seller?.stripe_account_id) {
                lookupOptions = { stripeAccount: seller.stripe_account_id };
            }
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, lookupOptions);

        if (paymentIntent.status !== 'succeeded') {
            return NextResponse.json(
                { error: `Payment is not complete (status: ${paymentIntent.status})` },
                { status: 400 },
            );
        }
        if (paymentIntent.transfer_group !== transferGroup) {
            return NextResponse.json(
                { error: 'PaymentIntent transfer_group does not match' },
                { status: 400 },
            );
        }

        // ─── Delegate to the shared implementation (also run by the webhook) ───
        const result = await finalizeLiveSpotOrders(transferGroup, paymentIntentId);
        if (result.errors.length > 0) {
            console.error('[Live/SpotsFinalize] finalization issues:', result.errors);
        }

        return NextResponse.json({
            success: result.success,
            ordersPaid: result.ordersPaid,
            alreadyPaid: result.alreadyPaid,
            errors: result.errors,
        });
    } catch (err: any) {
        console.error('[Live/SpotsFinalize] error:', err);
        return NextResponse.json(
            { error: 'Failed to finalize spots' },
            { status: 500 },
        );
    }
}
