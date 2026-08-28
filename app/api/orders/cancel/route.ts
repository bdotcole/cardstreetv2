/**
 * POST /api/orders/cancel
 *
 * Releases an ABANDONED checkout. When the buyer clicks "Pay",
 * /api/orders/checkout creates the orders at `pending_payment` and flips their
 * listings `active → sold` (the reservation) BEFORE the Stripe charge. If the
 * payment then fails or the buyer closes the modal without paying, those orders
 * would sit at `pending_payment` forever and the listings would stay `sold`
 * (vanished from the marketplace) with nothing to clean them up. The client
 * calls this endpoint on payment failure / modal close to undo the reservation
 * immediately.
 *
 * PromptPay zombie-payment guard: an async method leaves the order at
 * `pending_payment` with `payment_id` NULL while the buyer pays in their bank
 * app — the exact state this endpoint is allowed to kill. A buyer who scanned
 * the QR, paid, and then closed the modal used to get their order cancelled a
 * second before the money landed (and the still-live QR could even be paid
 * AFTER the cancel). So when a PaymentIntent exists we now cancel it on
 * Stripe FIRST — Stripe serializes this against the payment:
 *   - PI cancel succeeds  → the QR is dead, no payment can ever land. Safe to
 *                           cancel the orders + release the listings.
 *   - PI cancel refused   → the payment settled (or is settling). NEVER cancel:
 *       succeeded  → run fulfillment instead — the buyer paid, they get the order.
 *       processing → leave the order pending; the webhook / reconcile cron
 *                    settles it either way.
 *
 * Safety:
 *   - Buyer-scoped: only the authenticated buyer's own orders are touched.
 *   - CAS on `status='pending_payment'` AND `payment_id IS NULL`, so a payment
 *     that already succeeded (webhook/finalize flipped it to `paid` and stamped
 *     payment_id) is never cancelled — the update matches zero rows and no-ops.
 *   - Listings are reverted `sold → active` only while still `sold`, so a
 *     concurrent legitimate sale is never clobbered.
 *   - Fail-closed: if Stripe can't confirm the PI is dead, we leave the
 *     reservation in place — the reconcile cron cleans up a truly-abandoned
 *     checkout within ~30-45 min, which is cheaper than eating a buyer's money.
 *   - Idempotent: a second call finds nothing pending and returns cleanly.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeForRegion, isRegionConfigured, type StripeRegion } from '@/lib/stripe';
import { fulfillOrdersByTransferGroup } from '@/lib/fulfillOrder';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const transferGroup: unknown = body?.transferGroup;
        if (typeof transferGroup !== 'string' || transferGroup.length === 0) {
            return NextResponse.json({ error: 'transferGroup is required' }, { status: 400 });
        }

        const admin = createAdminClient();

        // Read the group's still-unpaid orders first: we need the recorded
        // PaymentIntent to decide whether cancelling is SAFE, before any write.
        type PendingRow = {
            id: string;
            listing_id: string | null;
            seller_id: string;
            stripe_region: string | null;
            stripe_payment_intent_id: string | null;
        };
        const { data: pending, error: readErr } = await admin
            .from('orders')
            .select('id, listing_id, seller_id, stripe_region, stripe_payment_intent_id')
            .eq('transfer_group', transferGroup)
            .eq('buyer_id', user.id)
            .eq('status', 'pending_payment')
            .is('payment_id', null)
            .returns<PendingRow[]>();

        if (readErr) {
            console.error('[Orders/Cancel] Order read failed:', readErr);
            return NextResponse.json({ error: 'Failed to cancel orders' }, { status: 500 });
        }
        if (!pending || pending.length === 0) {
            // Nothing to release — already paid, already cancelled, or never created.
            return NextResponse.json({ success: true, cancelledOrders: [], releasedListings: [] });
        }

        // A PaymentIntent exists for this checkout: kill it on Stripe before
        // touching our rows. All orders in a group share one PI.
        const piId = pending.find(o => o.stripe_payment_intent_id)?.stripe_payment_intent_id ?? null;
        const region: StripeRegion = pending[0].stripe_region === 'th' ? 'th' : 'us';

        if (piId && isRegionConfigured(region)) {
            const stripe = getStripeForRegion(region);

            // TH direct charges live on the seller's connected account.
            let piOpts: { stripeAccount: string } | undefined;
            if (region === 'th') {
                const sellerIds = [...new Set(pending.map(o => o.seller_id))];
                if (sellerIds.length === 1) {
                    const { data: seller } = await admin
                        .from('profiles')
                        .select('stripe_account_id')
                        .eq('id', sellerIds[0])
                        .single<{ stripe_account_id: string | null }>();
                    if (seller?.stripe_account_id) piOpts = { stripeAccount: seller.stripe_account_id };
                }
            }

            try {
                await stripe.paymentIntents.cancel(piId, { cancellation_reason: 'abandoned' }, piOpts);
                // PI is now dead — a late QR scan can no longer take the
                // buyer's money. Fall through to the order cancel below.
            } catch {
                // Stripe refused the cancel: the PI is not in a cancelable
                // state, i.e. the payment settled or is mid-settlement.
                try {
                    const pi = await stripe.paymentIntents.retrieve(piId, piOpts);
                    if (pi.status === 'succeeded') {
                        // The buyer PAID while abandoning (classic PromptPay
                        // pay-then-close). Fulfill instead of cancelling.
                        console.log(`[Orders/Cancel] PI ${piId} already succeeded — fulfilling ${transferGroup} instead of cancelling`);
                        const result = await fulfillOrdersByTransferGroup(transferGroup, pi.id);
                        return NextResponse.json({
                            success: true,
                            fulfilled: true,
                            ordersUpdated: result.ordersUpdated,
                            cancelledOrders: [],
                            releasedListings: [],
                        });
                    }
                    if (pi.status === 'processing') {
                        // Settlement in flight — leave the order pending; the
                        // webhook (or reconcile cron) resolves it either way.
                        return NextResponse.json({
                            success: true,
                            paymentInFlight: true,
                            cancelledOrders: [],
                            releasedListings: [],
                        });
                    }
                    if (pi.status !== 'canceled') {
                        // Still confirmable (requires_action / requires_payment_
                        // method / ...) — the first cancel must have failed on a
                        // transient error, not state. Retry once; if the PI
                        // still won't die, fail closed rather than release a
                        // listing whose QR could still be paid.
                        await stripe.paymentIntents.cancel(piId, { cancellation_reason: 'abandoned' }, piOpts);
                    }
                    // PI is dead (canceled) — safe to cancel the orders below.
                } catch (verifyErr) {
                    // Can't prove the PI is dead — fail closed and keep the
                    // reservation. The reconcile cron sweeps it up shortly.
                    console.error('[Orders/Cancel] Could not verify PI state, refusing to cancel:', (verifyErr as Error).message);
                    return NextResponse.json(
                        { error: 'Could not verify payment state' },
                        { status: 503 }
                    );
                }
            }
        }

        // Cancel only THIS buyer's still-unpaid reservations in the group. The
        // CAS (pending_payment + payment_id IS NULL) fail-closes against any
        // order that already got paid, so we can never cancel a real purchase.
        const { data: cancelled, error: cancelErr } = await admin
            .from('orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('transfer_group', transferGroup)
            .eq('buyer_id', user.id)
            .eq('status', 'pending_payment')
            .is('payment_id', null)
            .select('id, listing_id');

        if (cancelErr) {
            console.error('[Orders/Cancel] Order cancel failed:', cancelErr);
            return NextResponse.json({ error: 'Failed to cancel orders' }, { status: 500 });
        }

        // A Collector Pass voucher consumed by this checkout is returned to
        // the wallet with the reservation (fail-soft; no-op without one).
        if ((cancelled ?? []).length > 0) {
            const { restoreVouchersForTransferGroup } = await import('@/lib/rewards');
            await restoreVouchersForTransferGroup(admin, transferGroup);
        }

        const listingIds = (cancelled ?? [])
            .map(o => o.listing_id)
            .filter((v): v is string => typeof v === 'string');

        // Free the reserved listings. Guard on status='sold' so we only undo the
        // reservation this checkout took, never a listing that's active/other.
        let releasedListings: string[] = [];
        if (listingIds.length > 0) {
            const { data: released, error: releaseErr } = await admin
                .from('listings')
                .update({ status: 'active' })
                .in('id', listingIds)
                .eq('status', 'sold')
                .select('id');
            if (releaseErr) {
                // Non-fatal: the order is cancelled; the sweep cron / support can
                // reconcile the listing. Report it so the client knows.
                console.error('[Orders/Cancel] Listing release failed:', releaseErr);
            } else {
                releasedListings = (released ?? []).map(r => r.id);
            }
        }

        return NextResponse.json({
            success: true,
            cancelledOrders: (cancelled ?? []).map(o => o.id),
            releasedListings,
        });
    } catch (err: any) {
        console.error('[Orders/Cancel] Error:', err);
        return NextResponse.json({ error: err.message || 'Cancel failed' }, { status: 500 });
    }
}
