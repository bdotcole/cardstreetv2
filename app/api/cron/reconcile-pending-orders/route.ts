/**
 * Reconcile stalled checkouts — backstop for abandoned / lost payments.
 *
 * /api/orders/checkout creates orders at `pending_payment` and reserves their
 * listings (`active -> sold`) BEFORE the Stripe charge. The client releases an
 * abandoned checkout on modal close (/api/orders/cancel), but a hard app-kill or
 * crash mid-payment can strand the order (and its listing) with nothing to clean
 * it up. This cron is the safety net.
 *
 * It NEVER cancels blindly on age. For each stalled order it verifies the real
 * PaymentIntent state with Stripe first:
 *   - succeeded  -> the buyer PAID but fulfillment never ran (webhook lost).
 *                   RECOVER by running the same fulfillment path the webhook uses.
 *   - processing / requires_action -> in flight (e.g. PromptPay QR outstanding).
 *                   Leave it alone.
 *   - requires_payment_method / requires_confirmation / canceled -> dead.
 *                   Cancel the order, revert the listing, cancel the PI so a
 *                   stale client can't confirm it late.
 * Orders with no recorded PaymentIntent (abandoned before /api/checkout, or a
 * best-effort id write that failed) are only cancelled after a long safety
 * window, since we can't verify them — by then any real payment would have
 * fulfilled (payment_id set) and been excluded.
 *
 * Mirrors the pinned cron pattern (reconcile-shipments / expire-offers):
 * Bearer CRON_SECRET, nodejs runtime, wall-clock budget, JSON summary.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeForRegion, isRegionConfigured, orderPaymentMethodFromIntent, type StripeRegion } from '@/lib/stripe';
import { fulfillOrdersByTransferGroup } from '@/lib/fulfillOrder';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
// A verified-PI order is safe to act on after this (a real card payment settles
// or fails within seconds; PromptPay we detect via PI status regardless).
const VERIFIED_GRACE_MS = 30 * 60 * 1000; // 30 min
// An order with NO recorded PaymentIntent can't be Stripe-verified, so we wait
// long enough that any real payment would already have fulfilled (payment_id
// stamped -> excluded from the scan) before we cancel it.
const NO_PI_GRACE_MS = 6 * 60 * 60 * 1000; // 6 h

type OrderRow = {
    id: string;
    listing_id: string | null;
    seller_id: string;
    transfer_group: string;
    stripe_region: string | null;
    stripe_payment_intent_id: string | null;
    created_at: string;
};

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const started = Date.now();
    const summary = { groups: 0, recovered: 0, cancelled: 0, skipped: 0, errors: 0 };

    // Stalled pending_payment orders (unpaid, older than the shortest grace).
    const cutoff = new Date(Date.now() - VERIFIED_GRACE_MS).toISOString();
    const { data: stale, error } = await supabase
        .from('orders')
        .select('id, listing_id, seller_id, transfer_group, stripe_region, stripe_payment_intent_id, created_at')
        .eq('status', 'pending_payment')
        .is('payment_id', null)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(200)
        .returns<OrderRow[]>();

    if (error) {
        // Pre-migration guard: if `stripe_payment_intent_id` doesn't exist yet
        // (20260708_orders_payment_intent_id.sql not applied), skip quietly
        // rather than paging Sentry every 15 minutes.
        if (/stripe_payment_intent_id|does not exist/i.test(error.message)) {
            return NextResponse.json({ ok: true, skipped: 'awaiting migration 20260708_orders_payment_intent_id' });
        }
        Sentry.captureException(new Error(`reconcile-pending-orders query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Group by transfer_group — all orders in a group share one PaymentIntent.
    const groups = new Map<string, OrderRow[]>();
    for (const o of stale ?? []) {
        if (!groups.has(o.transfer_group)) groups.set(o.transfer_group, []);
        groups.get(o.transfer_group)!.push(o);
    }

    // Cancel a group's still-unpaid orders and free their reserved listings.
    async function cancelGroup(tg: string): Promise<void> {
        const { data: cancelled, error: cErr } = await supabase
            .from('orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('transfer_group', tg)
            .eq('status', 'pending_payment')
            .is('payment_id', null)
            .select('id, listing_id');
        if (cErr) { summary.errors++; Sentry.captureException(cErr); return; }
        if (!cancelled || cancelled.length === 0) return; // lost a race — someone else handled it
        summary.cancelled += cancelled.length;

        const listingIds = cancelled
            .map(o => o.listing_id)
            .filter((v): v is string => typeof v === 'string');
        if (listingIds.length > 0) {
            const { error: rErr } = await supabase
                .from('listings')
                .update({ status: 'active' })
                .in('id', listingIds)
                .eq('status', 'sold');
            if (rErr) { summary.errors++; console.error('[ReconcilePending] listing revert failed:', rErr.message); }
        }
    }

    // Correct the seeded 'credit_card' default on a group's orders with the
    // method the buyer actually used (read off the PI we just retrieved), so
    // abandonment analytics can tell PromptPay from card. Best-effort.
    async function stampPaymentMethod(tg: string, method: string | null): Promise<void> {
        if (!method) return;
        const { error } = await supabase
            .from('orders')
            .update({ payment_method: method })
            .eq('transfer_group', tg);
        if (error) console.error('[ReconcilePending] payment_method stamp failed:', error.message);
    }

    for (const [tg, orders] of groups) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        summary.groups++;

        const first = orders[0];
        const piId = first.stripe_payment_intent_id;
        const ageMs = Date.now() - new Date(first.created_at).getTime();

        try {
            // ─── No PaymentIntent recorded: cannot verify — cancel only after the long window. ───
            if (!piId) {
                if (ageMs >= NO_PI_GRACE_MS) await cancelGroup(tg);
                else summary.skipped++;
                continue;
            }

            const region: StripeRegion = first.stripe_region === 'th' ? 'th' : 'us';
            if (!isRegionConfigured(region)) { summary.skipped++; continue; }
            const stripe = getStripeForRegion(region);

            // TH direct charges live on the seller's connected account.
            let piOpts: { stripeAccount?: string } | undefined;
            if (region === 'th') {
                const sellerIds = [...new Set(orders.map(o => o.seller_id))];
                if (sellerIds.length === 1) {
                    const { data: seller } = await supabase
                        .from('profiles')
                        .select('stripe_account_id')
                        .eq('id', sellerIds[0])
                        .single<{ stripe_account_id: string | null }>();
                    if (seller?.stripe_account_id) piOpts = { stripeAccount: seller.stripe_account_id };
                }
            }

            // Expand the method + latest charge so orderPaymentMethodFromIntent
            // can read the real method (card vs. promptpay) off the retrieved PI.
            const pi = await stripe.paymentIntents.retrieve(
                piId,
                { expand: ['payment_method', 'latest_charge'] },
                piOpts,
            );
            const method = orderPaymentMethodFromIntent(pi);

            switch (pi.status) {
                case 'succeeded': {
                    // Buyer paid; fulfillment never ran. Recover it (idempotent CAS inside).
                    const result = await fulfillOrdersByTransferGroup(tg, pi.id);
                    if (result.success) summary.recovered++;
                    else { summary.errors++; result.errors.forEach(e => console.error('[ReconcilePending] recover:', e)); }
                    await stampPaymentMethod(tg, method);
                    break;
                }
                case 'processing':
                case 'requires_action':
                    // In flight (e.g. PromptPay QR still outstanding) — leave it.
                    summary.skipped++;
                    break;
                case 'requires_payment_method':
                case 'requires_confirmation':
                case 'canceled':
                    await cancelGroup(tg);
                    await stampPaymentMethod(tg, method);
                    // Close the PI so a stale client can't confirm it after we've
                    // freed the listing. Only some states are cancelable.
                    if (pi.status !== 'canceled') {
                        try { await stripe.paymentIntents.cancel(pi.id, piOpts); }
                        catch (e) { console.error('[ReconcilePending] PI cancel (non-fatal):', (e as Error).message); }
                    }
                    break;
                default:
                    summary.skipped++;
                    break;
            }
        } catch (e) {
            summary.errors++;
            Sentry.captureException(e, { tags: { handler: 'reconcile-pending-orders' }, extra: { transfer_group: tg } });
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
