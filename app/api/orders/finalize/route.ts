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
import { getStripe } from '@/lib/stripe';
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

        // Verify with Stripe — never trust a client-supplied "payment succeeded".
        const stripe = getStripe();
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

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

        // Verify the caller is actually the buyer for these orders. Without
        // this check, any logged-in user who knew a transfer_group + PI id
        // could trigger someone else's fulfillment (or replay it).
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: orders } = await admin
            .from('orders')
            .select('buyer_id')
            .eq('transfer_group', transferGroup);

        if (!orders || orders.length === 0) {
            return NextResponse.json(
                { error: 'No orders found for this transfer_group' },
                { status: 404 }
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
