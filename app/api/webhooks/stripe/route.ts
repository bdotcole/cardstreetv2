/**
 * Stripe Webhook Handler
 * 
 * Receives Stripe webhook events and processes them.
 * Primary event: payment_intent.succeeded — triggers order fulfillment.
 * 
 * Security: All events are verified via stripe.webhooks.constructEvent()
 * using the STRIPE_WEBHOOK_SECRET environment variable.
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { fulfillOrdersByTransferGroup } from '@/lib/fulfillOrder';
import { getStripe } from '@/lib/stripe';

export async function POST(request: NextRequest) {
    const stripe = getStripe();
    let event: Stripe.Event;

    try {
        // ─── Step 1: Verify webhook signature ───
        const body = await request.text();
        const signature = request.headers.get('stripe-signature');

        if (!signature) {
            console.error('[StripeWebhook] Missing stripe-signature header');
            return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
        }

        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
        if (!webhookSecret) {
            console.error('[StripeWebhook] STRIPE_WEBHOOK_SECRET not configured');
            return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
        }

        try {
            event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err: any) {
            console.error('[StripeWebhook] Signature verification failed:', err.message);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }

        console.log(`[StripeWebhook] Received event: ${event.type} (${event.id})`);

        // ─── Step 2: Handle events ───
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                const transferGroup = paymentIntent.transfer_group;
                const paymentId = paymentIntent.id;

                console.log(`[StripeWebhook] PaymentIntent succeeded: ${paymentId}, transfer_group: ${transferGroup}`);

                if (!transferGroup) {
                    console.warn('[StripeWebhook] PaymentIntent has no transfer_group — cannot link to orders');
                    break;
                }

                // Trigger fulfillment (idempotent — safe to call multiple times)
                const result = await fulfillOrdersByTransferGroup(transferGroup, paymentId);

                if (!result.success) {
                    console.error('[StripeWebhook] Fulfillment had errors:', result.errors);
                    // Still return 200 to prevent Stripe retries — errors are logged
                } else {
                    console.log(`[StripeWebhook] Fulfillment complete: ${result.ordersUpdated} orders, ${result.trackingNumbers.length} shipments`);
                }

                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                const transferGroup = paymentIntent.transfer_group;

                console.warn(`[StripeWebhook] PaymentIntent failed: ${paymentIntent.id}, transfer_group: ${transferGroup}`);

                if (transferGroup) {
                    // Revert pending_payment orders back to cancelled and restore listings
                    try {
                        const { createClient } = await import('@supabase/supabase-js');
                        const supabase = createClient(
                            process.env.NEXT_PUBLIC_SUPABASE_URL!,
                            process.env.SUPABASE_SERVICE_ROLE_KEY!
                        );

                        // Find the pending orders
                        const { data: pendingOrders } = await supabase
                            .from('orders')
                            .select('id, listing_id')
                            .eq('transfer_group', transferGroup)
                            .eq('status', 'pending_payment');

                        if (pendingOrders && pendingOrders.length > 0) {
                            const orderIds = pendingOrders.map(o => o.id);
                            const listingIds = pendingOrders.map(o => o.listing_id).filter(Boolean);

                            // Cancel the orders
                            await supabase
                                .from('orders')
                                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                                .in('id', orderIds);

                            // Restore listings to active
                            if (listingIds.length > 0) {
                                await supabase
                                    .from('listings')
                                    .update({ status: 'active' })
                                    .in('id', listingIds);
                            }

                            console.log(`[StripeWebhook] Reverted ${orderIds.length} orders and ${listingIds.length} listings for failed payment`);
                        }
                    } catch (revertErr) {
                        console.error('[StripeWebhook] Error reverting failed payment orders:', revertErr);
                    }
                }

                break;
            }

            case 'account.updated': {
                // Stripe Connect: seller's account capabilities / requirements changed.
                // Sync into profiles so the UI and release-funds cron see fresh state.
                const account = event.data.object as Stripe.Account;
                try {
                    const { createClient } = await import('@supabase/supabase-js');
                    const { deriveConnectStatus } = await import('@/lib/stripe');
                    const supabase = createClient(
                        process.env.NEXT_PUBLIC_SUPABASE_URL!,
                        process.env.SUPABASE_SERVICE_ROLE_KEY!
                    );

                    const status = deriveConnectStatus(account);

                    const { error: updErr, data: updRows } = await supabase
                        .from('profiles')
                        .update({
                            stripe_account_status: status,
                            stripe_charges_enabled: account.charges_enabled ?? false,
                            stripe_payouts_enabled: account.payouts_enabled ?? false,
                            stripe_details_submitted: account.details_submitted ?? false,
                            stripe_account_updated_at: new Date().toISOString(),
                        })
                        .eq('stripe_account_id', account.id)
                        .select('id');

                    if (updErr) {
                        console.error('[StripeWebhook] account.updated DB write failed:', updErr);
                    } else if (!updRows || updRows.length === 0) {
                        console.warn(
                            `[StripeWebhook] account.updated for ${account.id} matched no profile — ` +
                            `Connect account exists in Stripe but is not linked to any seller.`
                        );
                    } else {
                        console.log(
                            `[StripeWebhook] Synced Connect account ${account.id} → status=${status}, ` +
                            `charges=${account.charges_enabled}, payouts=${account.payouts_enabled}`
                        );
                    }
                } catch (syncErr) {
                    console.error('[StripeWebhook] account.updated handler error:', syncErr);
                }
                break;
            }

            default:
                console.log(`[StripeWebhook] Unhandled event type: ${event.type}`);
        }

        // Always return 200 to acknowledge receipt
        return NextResponse.json({ received: true });

    } catch (err: any) {
        console.error('[StripeWebhook] Unexpected error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
