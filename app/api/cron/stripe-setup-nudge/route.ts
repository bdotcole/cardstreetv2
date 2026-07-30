/**
 * Daily Vercel cron (09:00 Bangkok): reminder sequence to sellers who created
 * a Stripe connected account but abandoned the hosted onboarding.
 *
 * Prod funnel motivation (2026-07-04): 34 sellers started onboarding, only 9
 * finished — the 25 stalled sellers got no follow-up of any kind. TH direct
 * charges legally require full KYC before a seller can accept payments, so we
 * can't shorten Stripe's form below its floor; recovering abandoners is the
 * highest-leverage fix.
 *
 * 2026-07-16: the one-shot email proved saturated — 34 of 38 stalled sellers
 * had received it and were still stalled — so this now drives a short
 * SEQUENCE (up to NUDGE_MAX_TOUCHES touches, >=NUDGE_MIN_SPACING_MS apart,
 * email + push). Running daily just re-checks eligibility; the spacing, the
 * cap, and the claim all live in the sender.
 *
 * Selection: account exists, details never submitted, charges not enabled,
 * sequence not exhausted, no touch within the spacing window, and the last
 * Stripe-state change is >24h old (so we never email someone mid-flow; the
 * webhook and status?refresh keep stripe_account_updated_at fresh). The actual
 * claim-and-send (CAS on profiles.stripe_setup_nudge_count) lives in
 * lib/courier.ts:sendStripeSetupReminderEmail — this route only picks
 * candidates, so a crash here can never double-send.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    sendStripeSetupReminderEmail,
    NUDGE_MAX_TOUCHES,
    NUDGE_MIN_SPACING_MS,
} from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 60;

const STALL_HOURS = 24;
// Per-run cap: bounds runtime and smooths the first run over the backlog.
const BATCH_LIMIT = 40;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const cutoff = new Date(Date.now() - STALL_HOURS * 3600_000).toISOString();
    // Earliest a seller nudged before can receive the next touch.
    const spacingCutoff = new Date(Date.now() - NUDGE_MIN_SPACING_MS).toISOString();

    // Each .or() group ANDs with the rest. Explicit is-null arms because
    // `neq true` would drop NULL rows (SQL three-valued logic), and legacy
    // rows predate some of these columns.
    const { data: candidates, error } = await admin
        .from('profiles')
        .select('id')
        .not('stripe_account_id', 'is', null)
        .lt('stripe_setup_nudge_count', NUDGE_MAX_TOUCHES)
        .or(`stripe_setup_nudge_sent_at.is.null,stripe_setup_nudge_sent_at.lte.${spacingCutoff}`)
        .or('stripe_details_submitted.is.null,stripe_details_submitted.eq.false')
        .or('stripe_charges_enabled.is.null,stripe_charges_enabled.eq.false')
        .or(`stripe_account_updated_at.is.null,stripe_account_updated_at.lte.${cutoff}`)
        .limit(BATCH_LIMIT);

    if (error) {
        // Pre-migration guard: stripe_setup_nudge_count lands with
        // 20260716_stripe_nudge_sequence. No-op until then rather than 500ing
        // the cron every night.
        if (/column|does not exist/i.test(error.message || '')) {
            console.warn('[SetupNudge] Awaiting migration 20260716_stripe_nudge_sequence — skipping run');
            return NextResponse.json({ ok: true, skipped: 'awaiting migration' });
        }
        console.error('[SetupNudge] Candidate query failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const counts = { candidates: candidates?.length ?? 0, sent: 0, skipped: 0, errors: 0 };

    for (const { id } of candidates ?? []) {
        const result = await sendStripeSetupReminderEmail(id);
        if (result === 'sent') counts.sent++;
        else if (result === 'skipped') counts.skipped++;
        else counts.errors++;
    }

    console.log('[SetupNudge] Run complete:', JSON.stringify(counts));
    return NextResponse.json(counts);
}
