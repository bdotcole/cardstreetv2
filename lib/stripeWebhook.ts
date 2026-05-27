/**
 * Shared Stripe webhook handler.
 *
 * Why split this from the route file: we now have two webhook endpoints, one
 * per Stripe platform (US + TH). They behave identically — verify against
 * the matching webhook secret, then dispatch on event.type — so the body
 * lives here and each route is a thin region-bound wrapper. Avoids drift
 * between the two handlers.
 *
 * Region is set by the calling route, NOT inferred from the request, because
 * Stripe doesn't tell us which platform sent the event — we know because
 * Stripe delivered it to our region-specific URL.
 */

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';
import { fulfillOrdersByTransferGroup } from '@/lib/fulfillOrder';
import {
    getStripeForRegion,
    getWebhookSecretForRegion,
    isRegionConfigured,
    deriveConnectStatus,
    type StripeRegion,
} from '@/lib/stripe';

export async function handleStripeWebhook(
    request: NextRequest,
    region: StripeRegion
): Promise<NextResponse> {
    const logPrefix = `[StripeWebhook:${region}]`;

    // Bail early if this platform isn't configured on this deploy. Without
    // this, getStripeForRegion below throws a missing-key error before we
    // reach the try/catch, returning a bare 500 with empty body — confusing
    // in Vercel logs and in any external monitoring that probes the URL.
    // 410 Gone tells Stripe (and curious scanners) the endpoint exists but
    // is intentionally disabled, while keeping the response cheap.
    if (!isRegionConfigured(region)) {
        console.warn(`${logPrefix} Webhook received but ${region.toUpperCase()} platform is not configured on this deploy`);
        return NextResponse.json(
            { error: `Stripe ${region.toUpperCase()} platform is not active on this deploy.` },
            { status: 410 }
        );
    }

    let event: Stripe.Event;
    let stripe: Stripe;

    try {
        stripe = getStripeForRegion(region);
        // ─── Step 1: Verify webhook signature ───
        const body = await request.text();
        const signature = request.headers.get('stripe-signature');

        if (!signature) {
            console.error(`${logPrefix} Missing stripe-signature header`);
            return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
        }

        let webhookSecret: string;
        try {
            webhookSecret = getWebhookSecretForRegion(region);
        } catch (err: any) {
            console.error(`${logPrefix} Webhook secret not configured:`, err.message);
            return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
        }

        try {
            event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
        } catch (err: any) {
            console.error(`${logPrefix} Signature verification failed:`, err.message);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }

        // event.account is set on Connect events (events that originated on a
        // connected account, like payment_intent.succeeded for a direct charge).
        // Platform-account events (e.g. account.updated) have it undefined.
        const connectedAccount = event.account || null;
        console.log(`${logPrefix} Received event: ${event.type} (${event.id})${connectedAccount ? ` from connected account ${connectedAccount}` : ''}`);

        // ─── Step 2: Handle events ───
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                const transferGroup = paymentIntent.transfer_group;
                const paymentId = paymentIntent.id;

                console.log(`${logPrefix} PaymentIntent succeeded: ${paymentId}, transfer_group: ${transferGroup}${connectedAccount ? `, account: ${connectedAccount}` : ''}`);

                if (!transferGroup) {
                    console.warn(`${logPrefix} PaymentIntent has no transfer_group — cannot link to orders`);
                    break;
                }

                // Trigger fulfillment (idempotent — safe to call multiple times)
                const result = await fulfillOrdersByTransferGroup(transferGroup, paymentId);

                if (!result.success) {
                    console.error(`${logPrefix} Fulfillment had errors:`, result.errors);
                    Sentry.captureMessage('Stripe webhook fulfillment errors', {
                        level: 'error',
                        tags: { handler: 'stripe-webhook', event: 'payment_intent.succeeded', region },
                        extra: { transferGroup, paymentId, errors: result.errors },
                    });
                    // Still return 200 to prevent Stripe retries — errors are logged
                } else {
                    console.log(`${logPrefix} Fulfillment complete: ${result.ordersUpdated} orders, ${result.trackingNumbers.length} shipments`);
                }

                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                const transferGroup = paymentIntent.transfer_group;

                console.warn(`${logPrefix} PaymentIntent failed: ${paymentIntent.id}, transfer_group: ${transferGroup}`);

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

                            console.log(`${logPrefix} Reverted ${orderIds.length} orders and ${listingIds.length} listings for failed payment`);
                        }
                    } catch (revertErr) {
                        console.error(`${logPrefix} Error reverting failed payment orders:`, revertErr);
                    }
                }

                break;
            }

            case 'account.updated': {
                // Stripe Connect: seller's account capabilities / requirements changed.
                // Sync into profiles so the UI and release-funds cron see fresh state.
                //
                // Match on (stripe_account_id, stripe_region) so a coincident
                // account-ID collision across platforms (extremely unlikely
                // given Stripe's ID-space, but defense in depth) can't write
                // through the wrong row.
                const account = event.data.object as Stripe.Account;
                try {
                    const { createClient } = await import('@supabase/supabase-js');
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
                        .eq('stripe_region', region)
                        .select('id');

                    if (updErr) {
                        console.error(`${logPrefix} account.updated DB write failed:`, updErr);
                    } else if (!updRows || updRows.length === 0) {
                        console.warn(
                            `${logPrefix} account.updated for ${account.id} matched no profile — ` +
                            `Connect account exists in Stripe but is not linked to any seller in this region.`
                        );
                    } else {
                        console.log(
                            `${logPrefix} Synced Connect account ${account.id} → status=${status}, ` +
                            `charges=${account.charges_enabled}, payouts=${account.payouts_enabled}`
                        );
                    }
                } catch (syncErr) {
                    console.error(`${logPrefix} account.updated handler error:`, syncErr);
                }
                break;
            }

            default:
                console.log(`${logPrefix} Unhandled event type: ${event.type}`);
        }

        // Always return 200 to acknowledge receipt
        return NextResponse.json({ received: true });

    } catch (err: any) {
        console.error(`${logPrefix} Unexpected error:`, err);
        Sentry.captureException(err, { tags: { handler: 'stripe-webhook', region } });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
