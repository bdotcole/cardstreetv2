/**
 * Daily Vercel cron: remind buyers holding an ACCEPTED but unpaid offer.
 *
 * QC 2026-08-14 motivation: 12 offers had been accepted and not one was ever
 * paid. Acceptance is only an invitation to check out — there is no reserve, so
 * the listing stays buyable the whole time — and nothing followed up. The
 * hourly expire-offers cron only touches `pending` rows, so accepted offers sat
 * indefinitely (several were four weeks stale) while the buyer's only signal
 * was a single acceptance email that, for Apple Private Relay addresses, never
 * arrived at all.
 *
 * Selection: offer still `accepted`, never linked to an order, the listing is
 * still `active` (never nudge someone toward a card that has since sold), the
 * acceptance is at least STALE_HOURS old, the sequence isn't exhausted, and no
 * touch inside the spacing window.
 *
 * Each send is CAS-claimed on payment_nudge_count BEFORE the notification goes
 * out, so a crash mid-run re-sends nothing. Mirrors the shape of
 * app/api/cron/stripe-setup-nudge/route.ts and app/api/cron/expire-offers.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOfferPaymentReminderNotification } from '@/lib/courier';
import { cardNameFromListingEmbed } from '@/lib/offerPolicy';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Wait this long after acceptance before the first reminder — the buyer may
// simply be mid-checkout, and same-hour nagging reads as broken.
const STALE_HOURS = 24;
// Don't resurrect ancient offers. An accepted offer never expires today, so
// without this the first run would email every offer ever accepted — including
// six from 24-28 days ago whose sellers have long since moved on, at prices
// agreed a month back. Two weeks is the window where "still yours" is still
// true to both sides. Raising this is a pricing/expectations call, not a
// technical one.
const MAX_AGE_DAYS = 14;
// Two reminders total (24h and ~72h). Past that it's spam; the offer is stale
// enough that a fresh negotiation is the better outcome.
const MAX_NUDGES = 2;
const MIN_SPACING_MS = 48 * 3600_000;
const BATCH_LIMIT = 50;
const TIME_BUDGET_MS = 50_000;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') {
        return NextResponse.json({ ok: true, skipped: 'flag off' });
    }

    const admin = createAdminClient();
    const started = Date.now();
    const summary = { considered: 0, nudged: 0, skippedSold: 0, errors: 0 };

    const staleCutoff = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString();
    const spacingCutoff = new Date(Date.now() - MIN_SPACING_MS).toISOString();
    const ageFloor = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();

    const { data: due, error } = await admin
        .from('offers')
        .select('id, buyer_id, listing_id, amount, payment_nudge_count, payment_nudge_sent_at')
        .eq('status', 'accepted')
        .is('accepted_order_id', null)
        // Staleness rides updated_at, which the accept CAS set to the
        // acceptance time. The age floor CANNOT: this route's own claim-write
        // trips the trg_offers_touch BEFORE UPDATE trigger and resets
        // updated_at, so a nudged offer would read as brand new forever.
        // created_at never moves, and offers are accepted within hours of being
        // made, so it dates the negotiation just as well.
        .lte('updated_at', staleCutoff)
        .gte('created_at', ageFloor)
        .lt('payment_nudge_count', MAX_NUDGES)
        // Explicit is-null arm: `lte` alone drops never-nudged rows, because a
        // NULL comparison is unknown rather than true (SQL three-valued logic).
        .or(`payment_nudge_sent_at.is.null,payment_nudge_sent_at.lte.${spacingCutoff}`)
        .order('updated_at', { ascending: true })
        .limit(BATCH_LIMIT);

    if (error) {
        // Pre-migration guard: the payment_nudge_* columns land with
        // 20260814_offer_payment_nudge.sql, which is applied by hand in the
        // Supabase SQL editor. No-op until then rather than 500ing nightly.
        if (/column|does not exist/i.test(error.message || '')) {
            console.warn('[NudgeAcceptedOffers] Awaiting migration 20260814_offer_payment_nudge — skipping run');
            return NextResponse.json({ ok: true, skipped: 'awaiting migration' });
        }
        Sentry.captureException(new Error(`nudge-accepted-offers query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const offer of due || []) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        summary.considered++;

        // Never point a buyer at a card that has since sold out from under them
        // (no reserve — Buy-Now can win at any time). card_data rides along for
        // the notification's card name.
        const { data: listing } = await admin
            .from('listings')
            .select('id, status, card_data')
            .eq('id', offer.listing_id)
            .maybeSingle();
        if (!listing || listing.status !== 'active') { summary.skippedSold++; continue; }

        // CAS the claim before sending: only one runner can take this touch, and
        // a crash after this point costs a missed reminder rather than a repeat.
        const { data: claimed, error: claimErr } = await admin
            .from('offers')
            .update({
                payment_nudge_count: (offer.payment_nudge_count ?? 0) + 1,
                payment_nudge_sent_at: new Date().toISOString(),
            })
            .eq('id', offer.id)
            .eq('status', 'accepted')
            .is('accepted_order_id', null)
            .eq('payment_nudge_count', offer.payment_nudge_count ?? 0)
            .select('id');
        if (claimErr) { summary.errors++; Sentry.captureException(claimErr); continue; }
        if (!claimed || claimed.length !== 1) continue; // lost the race

        try {
            await sendOfferPaymentReminderNotification(offer.buyer_id, {
                offerId: offer.id,
                listingId: offer.listing_id,
                amount: offer.amount,
                cardName: cardNameFromListingEmbed({ card_data: listing.card_data }),
            });
            summary.nudged++;
        } catch (e) {
            // The claim stands — a failed send is not worth re-queuing into a
            // retry loop that could double-deliver.
            console.error('[NudgeAcceptedOffers] notify (non-fatal):', e);
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
