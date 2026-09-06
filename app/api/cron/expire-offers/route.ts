/**
 * OBO Best-Offer — hourly expiry cron.
 *
 * Flips pending offers past their expires_at to `expired` and notifies the
 * offeror. Mirrors the pinned cron pattern (app/api/cron/reconcile-shipments):
 * createAdminClient, nodejs runtime, Bearer CRON_SECRET, wall-clock budget,
 * JSON summary. Feature-flagged: while the flag is off it authenticates and
 * skips, so the schedule is inert until launch.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOfferExpiredNotification } from '@/lib/courier';
import { cardNameFromListingEmbed } from '@/lib/offerPolicy';

export const runtime = 'nodejs';
export const maxDuration = 60;
const TIME_BUDGET_MS = 50_000;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') {
        return NextResponse.json({ ok: true, skipped: 'flag off' });
    }

    const supabase = createAdminClient();
    const started = Date.now();
    const summary = { expired: 0, notified: 0, acceptedExpired: 0, errors: 0 };

    // ─── Accepted-but-unpaid offers expire at 48 hours ───
    //
    // Acceptance used to be permanent: this cron only ever touched `pending`
    // rows, so an accepted offer sat forever. 14 were accepted and none was
    // ever paid, several four weeks stale — the seller's card was informally
    // spoken for at a month-old price, by a buyer who had moved on, with no
    // event that ever ended it.
    //
    // 48 hours matches the pending window, and the acceptance mail now states
    // it. No reservation is released because none is taken (see the header):
    // the listing has been buyable throughout, so expiry costs the buyer only
    // the discount, which is exactly what a lapsed deadline should cost.
    const acceptedCutoff = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const { data: staleAccepted, error: acceptedErr } = await supabase
        .from('offers')
        .select('id, buyer_id, seller_id, actor_role, listing_id, amount, listings(card_data)')
        .eq('status', 'accepted')
        .is('accepted_order_id', null)
        .lte('updated_at', acceptedCutoff)
        .limit(200);
    if (acceptedErr) {
        Sentry.captureException(new Error(`expire-offers accepted query failed: ${acceptedErr.message}`));
    }
    for (const offer of staleAccepted || []) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        // CAS on BOTH status and accepted_order_id: a checkout completing in
        // this same second must win, and stamping accepted_order_id is how it
        // announces that. Expiring a paid offer would orphan a real order.
        const { data: won, error: updErr } = await supabase
            .from('offers')
            .update({ status: 'expired' })
            .eq('id', offer.id)
            .eq('status', 'accepted')
            .is('accepted_order_id', null)
            .select('id');
        if (updErr) { summary.errors++; Sentry.captureException(updErr); continue; }
        if (!won || won.length !== 1) continue;
        summary.acceptedExpired++;

        // The buyer is the one left hanging here, not the offeror — they are
        // the party who had something to do and did not do it.
        try {
            await sendOfferExpiredNotification(offer.buyer_id, {
                offerId: offer.id,
                amount: offer.amount,
                listingId: offer.listing_id,
                cardName: cardNameFromListingEmbed((offer as { listings?: unknown }).listings),
            });
            summary.notified++;
        } catch (e) {
            console.error('[ExpireOffers] accepted-expiry notify (non-fatal):', e);
        }
    }

    // listings(card_data) rides along so the notification can name the card —
    // without it every expiry push/email reads "Offer expired — a card".
    const { data: due, error } = await supabase
        .from('offers')
        .select('id, buyer_id, seller_id, actor_role, listing_id, amount, listings(card_data)')
        .eq('status', 'pending')
        .lte('expires_at', new Date().toISOString())
        .limit(200);

    if (error) {
        Sentry.captureException(new Error(`expire-offers query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const offer of due || []) {
        if (Date.now() - started > TIME_BUDGET_MS) break;

        // CAS: only expire if still pending (a concurrent accept/withdraw may have won).
        const { data: won, error: updErr } = await supabase
            .from('offers')
            .update({ status: 'expired' })
            .eq('id', offer.id)
            .eq('status', 'pending')
            .select('id');
        if (updErr) { summary.errors++; Sentry.captureException(updErr); continue; }
        if (!won || won.length !== 1) continue; // lost the race; skip
        summary.expired++;

        // Notify the offeror (the actor left hanging).
        const offerorId = offer.actor_role === 'buyer' ? offer.buyer_id : offer.seller_id;
        try {
            await sendOfferExpiredNotification(offerorId, {
                offerId: offer.id,
                amount: offer.amount,
                listingId: offer.listing_id,
                cardName: cardNameFromListingEmbed((offer as { listings?: unknown }).listings),
            });
            summary.notified++;
        } catch (e) {
            console.error('[ExpireOffers] notify (non-fatal):', e);
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
