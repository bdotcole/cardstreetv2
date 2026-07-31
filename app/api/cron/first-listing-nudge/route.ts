/**
 * Daily Vercel cron (09:30 Bangkok): one-time activation nudge to sellers who
 * FINISHED Stripe onboarding but never listed a card.
 *
 * Prod funnel motivation (2026-07-30): 34 sellers were fully verified
 * (charges_enabled), yet only 13 ever created a listing. That 21-seller gap
 * isn't KYC friction — it's activation. One email + push, ever, pointing at
 * the Vault's "New Listing" flow (/?view=vault).
 *
 * Selection: charges enabled, never nudged, and the last Stripe-state change
 * is >24h old — a freshly verified seller is usually still in-app looking at
 * their own success state; the nudge lands the next morning instead. The
 * zero-listings check joins here (one query for the whole candidate batch);
 * the sender re-verifies per seller before claiming, so a listing created
 * between query and send cancels the nudge. The claim-and-send (CAS on
 * profiles.first_listing_nudge_sent_at) lives in
 * lib/courier.ts:sendFirstListingNudgeEmail — a crash here can never
 * double-send.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendFirstListingNudgeEmail } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SETTLE_HOURS = 24;
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

    const cutoff = new Date(Date.now() - SETTLE_HOURS * 3600_000).toISOString();

    const { data: candidates, error } = await admin
        .from('profiles')
        .select('id')
        .eq('stripe_charges_enabled', true)
        .is('first_listing_nudge_sent_at', null)
        .or(`stripe_account_updated_at.is.null,stripe_account_updated_at.lte.${cutoff}`)
        .limit(BATCH_LIMIT);

    if (error) {
        // Pre-migration guard: first_listing_nudge_sent_at lands with
        // 20260730_first_listing_nudge. No-op until then rather than 500ing
        // the cron every night.
        if (/column|does not exist/i.test(error.message || '')) {
            console.warn('[FirstListingNudge] Awaiting migration 20260730_first_listing_nudge — skipping run');
            return NextResponse.json({ ok: true, skipped: 'awaiting migration' });
        }
        console.error('[FirstListingNudge] Candidate query failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Drop candidates who have ANY listing row (active, draft, sold or
    // cancelled — all prove the seller has activated before). One query for
    // the batch; the sender re-checks per seller before claiming.
    let eligible = candidates ?? [];
    if (eligible.length > 0) {
        const { data: sellersWithListings, error: listingsErr } = await admin
            .from('listings')
            .select('seller_id')
            .in('seller_id', eligible.map((c) => c.id));
        if (listingsErr) {
            console.error('[FirstListingNudge] Listings check failed:', listingsErr);
            return NextResponse.json({ error: listingsErr.message }, { status: 500 });
        }
        const activated = new Set((sellersWithListings ?? []).map((l) => l.seller_id));
        eligible = eligible.filter((c) => !activated.has(c.id));
    }

    const counts = { candidates: candidates?.length ?? 0, eligible: eligible.length, sent: 0, skipped: 0, errors: 0 };

    for (const { id } of eligible) {
        const result = await sendFirstListingNudgeEmail(id);
        if (result === 'sent') counts.sent++;
        else if (result === 'skipped') counts.skipped++;
        else counts.errors++;
    }

    console.log('[FirstListingNudge] Run complete:', JSON.stringify(counts));
    return NextResponse.json(counts);
}
