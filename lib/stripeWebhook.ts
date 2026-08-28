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
import { finalizeLiveSpotOrders, finalizeLiveShippingFeeOrder } from '@/lib/liveSpotFulfillment';
import { syncPremiumFromSubscription } from '@/lib/premiumEntitlement';
import { publishDraftListings } from '@/lib/draftListings';
import { notifyWishlistersOfSellerActivation } from '@/lib/wishlistAlerts';
import { awardFirst } from '@/lib/rewards';
import {
    getStripeForRegion,
    getAllWebhookSecretsForRegion,
    isRegionConfigured,
    deriveConnectStatus,
    orderPaymentMethodFromIntent,
    type StripeRegion,
} from '@/lib/stripe';

/**
 * Stamp the buyer's ACTUAL payment method onto a transfer_group's orders.
 *
 * `orders.payment_method` is seeded from the client's declared method at
 * /api/orders/checkout, before the buyer picks one in Stripe's PaymentElement,
 * so it's frequently wrong (a PromptPay purchase reads 'credit_card'). The raw
 * webhook event object doesn't expand the method, so we retrieve the PI with
 * the method + latest charge expanded and normalize it. Best-effort: a failure
 * here must never affect the 200 we owe Stripe.
 */
async function stampOrderPaymentMethod(
    stripe: Stripe,
    transferGroup: string,
    piId: string,
    stripeAccount: string | null,
    logPrefix: string,
): Promise<void> {
    try {
        const pi = await stripe.paymentIntents.retrieve(
            piId,
            { expand: ['payment_method', 'latest_charge'] },
            stripeAccount ? { stripeAccount } : undefined,
        );
        const method = orderPaymentMethodFromIntent(pi);
        if (!method) return;

        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { error } = await supabase
            .from('orders')
            .update({ payment_method: method })
            .eq('transfer_group', transferGroup);
        if (error) console.error(`${logPrefix} payment_method stamp failed:`, error.message);
    } catch (e) {
        console.error(`${logPrefix} payment_method stamp (non-fatal):`, (e as Error).message);
    }
}

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

        // Direct charges fire payment_intent.* events on the connected
        // account; account.updated and platform events fire on the platform.
        // Each is configured as a separate "Event destination" in the Stripe
        // Dashboard with its own signing secret. We accept all of them on
        // one endpoint by trying each configured secret in turn.
        let webhookSecrets: string[];
        try {
            webhookSecrets = getAllWebhookSecretsForRegion(region);
        } catch (err: any) {
            console.error(`${logPrefix} No webhook secret configured:`, err.message);
            return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
        }

        let verifiedEvent: Stripe.Event | null = null;
        let lastVerifyError: string | null = null;
        for (const secret of webhookSecrets) {
            try {
                verifiedEvent = stripe.webhooks.constructEvent(body, signature, secret);
                break;
            } catch (err: any) {
                lastVerifyError = err.message;
            }
        }
        if (!verifiedEvent) {
            console.error(`${logPrefix} Signature verification failed against ${webhookSecrets.length} secret(s):`, lastVerifyError);
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }
        event = verifiedEvent;

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

                // Correct the seeded payment_method with what Stripe actually
                // processed (card vs. promptpay) before/alongside fulfillment.
                await stampOrderPaymentMethod(stripe, transferGroup, paymentId, connectedAccount, logPrefix);

                // Live-breaks isolation: `live_*` groups are spot orders and
                // `liveship_*` groups are consolidated shipping-fee orders.
                // NEITHER may enter fulfillOrdersByTransferGroup — it mints a
                // per-order Flash waybill + pickup, but live parcels are
                // consolidated per buyer at stream settle and labeled from the
                // seller console. Prefix-branching here keeps the marketplace
                // path untouched for every other transfer_group.
                if (transferGroup.startsWith('liveship_') || transferGroup.startsWith('live_')) {
                    const liveResult = transferGroup.startsWith('liveship_')
                        ? await finalizeLiveShippingFeeOrder(transferGroup, paymentId)
                        : await finalizeLiveSpotOrders(transferGroup, paymentId);
                    if (!liveResult.success) {
                        console.error(`${logPrefix} Live-breaks finalization had errors:`, liveResult.errors);
                        Sentry.captureMessage('Stripe webhook live-breaks finalization errors', {
                            level: 'error',
                            tags: { handler: 'stripe-webhook', event: 'payment_intent.succeeded', region },
                            extra: { transferGroup, paymentId, errors: liveResult.errors },
                        });
                        // Still return 200 to prevent Stripe retries — errors are logged
                    } else {
                        console.log(`${logPrefix} Live-breaks finalization complete: ${liveResult.ordersPaid} orders paid`);
                    }
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

            // PromptPay and other async methods can also expire unpaid, which
            // fires payment_intent.canceled rather than .payment_failed. Both
            // mean the same thing for us: release the reserved inventory.
            case 'payment_intent.canceled':
            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                const transferGroup = paymentIntent.transfer_group;

                console.warn(`${logPrefix} PaymentIntent ${event.type === 'payment_intent.canceled' ? 'canceled' : 'failed'}: ${paymentIntent.id}, transfer_group: ${transferGroup}`);

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

                            // Restore listings to active. Guard on 'sold' (the
                            // reservation state) like the cancel/reconcile
                            // release paths do, so this can never force-publish
                            // a row in any other state (e.g. a draft).
                            if (listingIds.length > 0) {
                                await supabase
                                    .from('listings')
                                    .update({ status: 'active' })
                                    .in('id', listingIds)
                                    .eq('status', 'sold');
                            }

                            console.log(`${logPrefix} Reverted ${orderIds.length} orders and ${listingIds.length} listings for failed payment`);
                        }
                    } catch (revertErr) {
                        console.error(`${logPrefix} Error reverting failed payment orders:`, revertErr);
                    }

                    // Label the abandoned/failed order with the method that was
                    // actually attempted (e.g. an expired PromptPay QR) so
                    // abandonment analytics aren't polluted by the 'credit_card'
                    // seed default.
                    await stampOrderPaymentMethod(stripe, transferGroup, paymentIntent.id, connectedAccount, logPrefix);
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

                    // Chargeable state BEFORE this sync. The wishlist replay
                    // below must fire only on the false -> true edge, and the
                    // update overwrites the column, so it has to be read first.
                    const { data: priorRows } = await supabase
                        .from('profiles')
                        .select('id, stripe_charges_enabled')
                        .eq('stripe_account_id', account.id)
                        .eq('stripe_region', region);
                    const wasChargeable = new Set(
                        (priorRows ?? [])
                            .filter((r: { stripe_charges_enabled: boolean | null }) => r.stripe_charges_enabled === true)
                            .map((r: { id: string }) => r.id)
                    );

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
                        // Wishlist alerts suppressed while this seller could not
                        // be paid are replayed now, on the false -> true edge.
                        //
                        // ORDER MATTERS: this runs BEFORE publishDraftListings.
                        // The replay only looks at already-active listings, so
                        // running it first keeps it disjoint from the drafts
                        // published below (which fire their own alerts). Doing
                        // it the other way round would let both paths alert the
                        // same freshly-published listing concurrently, and the
                        // user+card dedupe cannot settle a race that tight.
                        if (account.charges_enabled) {
                            const activated = updRows
                                .map((r: { id: string }) => r.id)
                                .filter((id: string) => !wasChargeable.has(id));
                            if (activated.length > 0) {
                                try {
                                    await notifyWishlistersOfSellerActivation(activated, logPrefix);
                                } catch (replayErr) {
                                    console.error(`${logPrefix} Wishlist replay failed:`, replayErr);
                                }
                            }
                        }
                        // Draft-first listings: onboarding just completed, so
                        // publish anything this seller drafted while
                        // unverified. Async backstop for the status-route
                        // publish (covers sellers who never return to the
                        // app). Best-effort — never fail the webhook over it.
                        if (account.details_submitted) {
                            try {
                                await publishDraftListings(
                                    supabase,
                                    updRows.map((r: { id: string }) => r.id),
                                    logPrefix,
                                );
                            } catch (publishErr) {
                                console.error(`${logPrefix} Draft publish failed:`, publishErr);
                            }
                            // Collector Pass: seller finished Stripe onboarding —
                            // a one-shot Journey award (fail-soft, ledger-deduped).
                            for (const r of updRows as { id: string }[]) {
                                await awardFirst(supabase, r.id, 'first_stripe_complete');
                            }
                        }
                    }
                } catch (syncErr) {
                    console.error(`${logPrefix} account.updated handler error:`, syncErr);
                }
                break;
            }

            // ─── CardStreet Pro (premium subscription, platform account) ───
            // These are PLATFORM events (no event.account) — premium billing
            // never touches a seller's connected account. Requires the TH
            // endpoint to subscribe to checkout.session.completed +
            // customer.subscription.updated/deleted in the Stripe Dashboard.
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                if (session.mode === 'subscription' && session.subscription && session.metadata?.purpose === 'cardstreet_premium') {
                    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
                    const sub = await stripe.subscriptions.retrieve(subId);
                    await syncPremiumFromSubscription(sub);
                }
                break;
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                if (sub.metadata?.purpose === 'cardstreet_premium') {
                    await syncPremiumFromSubscription(sub);
                } else {
                    console.log(`${logPrefix} ${event.type} for non-premium subscription ${sub.id} — ignored`);
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
