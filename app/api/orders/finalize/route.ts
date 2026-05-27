/**
 * POST /api/orders/finalize
 *
 * Client-side fallback for the Stripe webhook. After a successful Stripe
 * charge, the client posts here with the PaymentIntent id and transfer_group.
 * We verify with Stripe that the payment really succeeded, then trigger the
 * same fulfillment path the webhook uses.
 *
 * Why: the webhook is the canonical fulfillment trigger, but webhook
 * misconfiguration / signing-secret mismatch / network failures would leave
 * paid orders stuck at `pending_payment` forever — invisible to both buyer
 * and seller. This belt-and-suspenders endpoint covers that gap.
 *
 * Safe to call alongside the webhook: `fulfillOrdersByTransferGroup` does a
 * compare-and-swap on the `pending_payment → paid` transition, so only one
 * caller wins the side effects.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getStripeForRegion, type StripeRegion } from '@/lib/stripe';
import { fulfillOrdersByTransferGroup } from '@/lib/fulfillOrder';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { transferGroup, paymentIntentId } = await req.json();
        if (!transferGroup || !paymentIntentId) {
            return NextResponse.json(
                { error: 'transferGroup and paymentIntentId are required' },
                { status: 400 }
            );
        }

        // Look up the order region first — the PaymentIntent lives on the
        // platform that originally charged the buyer, so we must verify it
        // through the matching Stripe client.
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        type OrderRow = {
            buyer_id: string;
            seller_id: string;
            stripe_region: string | null;
        };

        const { data: orders } = await admin
            .from('orders')
            .select('buyer_id, seller_id, stripe_region')
            .eq('transfer_group', transferGroup)
            .returns<OrderRow[]>();

        if (!orders || orders.length === 0) {
            return NextResponse.json(
                { error: 'No orders found for this transfer_group' },
                { status: 404 }
            );
        }

        const region: StripeRegion = orders[0].stripe_region === 'th' ? 'th' : 'us';
        const stripe = getStripeForRegion(region);

        // On TH (direct charges) the PaymentIntent lives on the seller's
        // connected account, not the platform. Retrieve it via the
        // stripeAccount option so Stripe knows which account to query.
        let paymentIntentLookupOptions: { stripeAccount?: string } | undefined;
        if (region === 'th') {
            const sellerIds = [...new Set(orders.map(o => o.seller_id))];
            if (sellerIds.length === 1) {
                const { data: seller } = await admin
                    .from('profiles')
                    .select('stripe_account_id')
                    .eq('id', sellerIds[0])
                    .single<{ stripe_account_id: string | null }>();
                if (seller?.stripe_account_id) {
                    paymentIntentLookupOptions = { stripeAccount: seller.stripe_account_id };
                }
            }
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(
            paymentIntentId,
            paymentIntentLookupOptions
        );

        if (paymentIntent.status !== 'succeeded') {
            return NextResponse.json(
                { error: `Payment is not complete (status: ${paymentIntent.status})` },
                { status: 400 }
            );
        }

        if (paymentIntent.transfer_group !== transferGroup) {
            return NextResponse.json(
                { error: 'PaymentIntent transfer_group does not match' },
                { status: 400 }
            );
        }

        if (!orders.every(o => o.buyer_id === user.id)) {
            return NextResponse.json(
                { error: 'You are not the buyer for these orders' },
                { status: 403 }
            );
        }

        // Trigger fulfillment. Idempotent — the CAS guard on
        // pending_payment → paid means only one of {this call, the webhook}
        // creates Flash shipments + labels + notifications, even if both fire.
        console.log(`[Orders/Finalize] Triggering fulfillment for transfer_group ${transferGroup}`);
        const result = await fulfillOrdersByTransferGroup(transferGroup, paymentIntentId);

        return NextResponse.json({
            success: result.success,
            ordersUpdated: result.ordersUpdated,
            trackingNumbers: result.trackingNumbers,
            errors: result.errors,
        });
    } catch (err: any) {
        console.error('[Orders/Finalize] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to finalize orders' },
            { status: 500 }
        );
    }
}
