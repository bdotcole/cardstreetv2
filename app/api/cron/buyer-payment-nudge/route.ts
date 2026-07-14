/**
 * Buyer abandoned-checkout recovery nudge.
 *
 * Motivation (2026-07-14): a buyer started a PromptPay checkout — order created,
 * listing reserved — then never completed the QR. The reconcile cron correctly
 * cancelled the order and freed the listing, but the buyer got no follow-up, so
 * a warm purchase intent just evaporated. This cron is the buyer-side analog of
 * the seller stripe-setup-nudge: one re-engagement email/push per abandoned
 * checkout, pointing back to the (now buyable again) card.
 *
 * Selection: the order is cancelled, was never paid (`payment_id IS NULL`),
 * actually reached the payment step (`stripe_payment_intent_id IS NOT NULL` — so
 * the buyer got as far as a PaymentIntent, not just opened and closed a cart),
 * was never nudged, and is 30m–24h old. The 30m floor is a cool-down so we never
 * nudge someone who might still be mid-retry; the 24h ceiling keeps the message
 * relevant. The actual claim-and-send (CAS on orders.checkout_nudge_sent_at) and
 * the "is the listing still buyable" re-check live in
 * lib/courier.ts:sendAbandonedCheckoutNudge, so a crash here can never
 * double-send.
 *
 * Mirrors the pinned cron pattern (stripe-setup-nudge / reconcile-pending):
 * Bearer CRON_SECRET, nodejs runtime, per-run cap, JSON summary.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendAbandonedCheckoutNudge } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Cool-down before nudging (don't chase a buyer who may still be retrying) and
// the relevance ceiling past which we stay quiet.
const MIN_AGE_MS = 30 * 60 * 1000; // 30 min
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h
// Per-run cap: bounds runtime and smooths the first run over any backlog.
const BATCH_LIMIT = 40;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const now = Date.now();
    const newestEligible = new Date(now - MIN_AGE_MS).toISOString();
    const oldestEligible = new Date(now - MAX_AGE_MS).toISOString();

    const { data: candidates, error } = await admin
        .from('orders')
        .select('id, transfer_group')
        .eq('status', 'cancelled')
        .is('payment_id', null)
        .not('stripe_payment_intent_id', 'is', null)
        .is('checkout_nudge_sent_at', null)
        .gte('created_at', oldestEligible)
        .lte('created_at', newestEligible)
        .order('created_at', { ascending: true })
        .limit(BATCH_LIMIT);

    if (error) {
        // Pre-migration guard: if `checkout_nudge_sent_at` doesn't exist yet
        // (20260714_orders_checkout_nudge.sql not applied), skip quietly rather
        // than 500-ing the cron every run.
        if (/checkout_nudge_sent_at|does not exist/i.test(error.message)) {
            return NextResponse.json({ ok: true, skipped: 'awaiting migration 20260714_orders_checkout_nudge' });
        }
        console.error('[CheckoutNudge] Candidate query failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // One nudge per CART, not per row: a multi-item single-seller cart becomes
    // one cancelled order per card, all sharing a transfer_group. Collapse to
    // the first order of each group; the courier claim covers the whole group.
    const byGroup = new Map<string, string>();
    for (const row of candidates ?? []) {
        const tg = (row as { transfer_group: string | null }).transfer_group;
        const id = (row as { id: string }).id;
        if (tg && !byGroup.has(tg)) byGroup.set(tg, id);
    }

    const counts = { candidates: candidates?.length ?? 0, carts: byGroup.size, sent: 0, skipped: 0, errors: 0 };

    for (const id of byGroup.values()) {
        const result = await sendAbandonedCheckoutNudge(id);
        if (result === 'sent') counts.sent++;
        else if (result === 'skipped') counts.skipped++;
        else counts.errors++;
    }

    console.log('[CheckoutNudge] Run complete:', JSON.stringify(counts));
    return NextResponse.json(counts);
}
