/**
 * Daily Vercel cron (09:00 Bangkok): one-time reminder email to sellers who
 * created a Stripe connected account but abandoned the hosted onboarding.
 *
 * Prod funnel motivation (2026-07-04): 34 sellers started onboarding, only 9
 * finished — the 25 stalled sellers got no follow-up of any kind. TH direct
 * charges legally require full KYC before a seller can accept payments, so we
 * can't shorten Stripe's form below its floor; recovering abandoners is the
 * highest-leverage fix.
 *
 * Selection: account exists, details never submitted, charges not enabled,
 * never nudged, and the last Stripe-state change is >24h old (so we never
 * email someone mid-flow; the webhook and status?refresh keep
 * stripe_account_updated_at fresh). The actual claim-and-send (CAS on
 * profiles.stripe_setup_nudge_sent_at) lives in
 * lib/courier.ts:sendStripeSetupReminderEmail — this route only picks
 * candidates, so a crash here can never double-email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendStripeSetupReminderEmail } from '@/lib/courier';

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

    // Each .or() group ANDs with the rest. Explicit is-null arms because
    // `neq true` would drop NULL rows (SQL three-valued logic), and legacy
    // rows predate some of these columns.
    const { data: candidates, error } = await admin
        .from('profiles')
        .select('id')
        .not('stripe_account_id', 'is', null)
        .is('stripe_setup_nudge_sent_at', null)
        .or('stripe_details_submitted.is.null,stripe_details_submitted.eq.false')
        .or('stripe_charges_enabled.is.null,stripe_charges_enabled.eq.false')
        .or(`stripe_account_updated_at.is.null,stripe_account_updated_at.lte.${cutoff}`)
        .limit(BATCH_LIMIT);

    if (error) {
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
