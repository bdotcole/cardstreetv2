/**
 * Pre-show reminder sweep — every 5 minutes.
 *
 * Sends the "starts in ~15 minutes" heads-up to everyone who tapped Get
 * notified on a scheduled show (stream_reminders). The go-live fan-out is a
 * different moment and still fires on top: this is the calendar nudge that
 * gets someone to the couch, that one is the watch-now alert.
 *
 * Claim before send: each show is CAS-claimed on streams.prestart_reminder_at
 * (NULL -> now), so overlapping runs, a retry after a timeout, and a
 * redeploy mid-sweep can none of them double-notify. A crash AFTER the claim
 * but BEFORE the sends costs that show its heads-up — deliberate: subscribers
 * still get the go-live alert, and a duplicate push is worse than a missed
 * nudge.
 *
 * Window: shows whose scheduled_at falls inside the next REMINDER_WINDOW_MIN.
 * With a 5-minute cadence that lands the nudge 10-15 minutes ahead. Shows
 * whose start time has already passed are skipped — a breaker running late
 * should not trigger a "starts in 15 minutes" alert; going live sends its own.
 *
 * Fails soft end to end: absent tables/columns (pre-migration) return a clean
 * skipped response rather than 500ing the cron.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendShowStartingSoonNotification } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** How far ahead a show must be to still earn the heads-up. */
const REMINDER_WINDOW_MIN = 15;
/** Per-run cap — bounds runtime; more shows are picked up next pass. */
const SHOW_LIMIT = 10;

interface ShowRow {
    id: string;
    title: string;
    seller_id: string;
    scheduled_at: string;
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const nowIso = new Date().toISOString();
    const windowEndIso = new Date(Date.now() + REMINDER_WINDOW_MIN * 60_000).toISOString();

    const { data: shows, error: showsErr } = await supabase
        .from('streams')
        .select('id, title, seller_id, scheduled_at')
        .eq('status', 'scheduled')
        .is('prestart_reminder_at', null)
        .gt('scheduled_at', nowIso)
        .lte('scheduled_at', windowEndIso)
        .order('scheduled_at', { ascending: true })
        .limit(SHOW_LIMIT)
        .returns<ShowRow[]>();

    if (showsErr) {
        // 42703 = prestart_reminder_at missing (run 20260821), PGRST205 = table
        // absent. Either way there is nothing this sweep can do yet.
        if (showsErr.code === '42703' || showsErr.code === 'PGRST205') {
            console.warn('[Cron/ShowReminders] schema missing — run 20260821_show_prestart_reminder.sql');
            return NextResponse.json({ skipped: 'schema_missing' });
        }
        console.error('[Cron/ShowReminders] show query failed:', showsErr.message);
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
    }

    if (!shows || shows.length === 0) {
        return NextResponse.json({ shows: 0, notified: 0 });
    }

    let notified = 0;
    let claimedShows = 0;

    for (const show of shows) {
        // CAS: only the run that flips NULL -> now owns this show's fan-out.
        const { data: claimed, error: claimErr } = await supabase
            .from('streams')
            .update({ prestart_reminder_at: new Date().toISOString() })
            .eq('id', show.id)
            .is('prestart_reminder_at', null)
            .select('id')
            .maybeSingle<{ id: string }>();
        if (claimErr) {
            console.error(`[Cron/ShowReminders] claim failed for ${show.id}:`, claimErr.message);
            continue;
        }
        if (!claimed) continue; // another run got it
        claimedShows += 1;

        const { data: subs, error: subsErr } = await supabase
            .from('stream_reminders')
            .select('user_id')
            .eq('stream_id', show.id)
            .returns<{ user_id: string }[]>();
        if (subsErr) {
            console.error(`[Cron/ShowReminders] subscriber query failed for ${show.id}:`, subsErr.message);
            continue;
        }

        const userIds = [...new Set((subs ?? []).map(s => s.user_id))]
            .filter(id => id !== show.seller_id);
        if (userIds.length === 0) continue;

        // Round to the nearest minute so the copy reads "15 minutes", not
        // "14.6" — and never below 1.
        const minutes = Math.max(
            1,
            Math.round((Date.parse(show.scheduled_at) - Date.now()) / 60_000),
        );

        const results = await Promise.allSettled(
            userIds.map(id =>
                sendShowStartingSoonNotification(id, {
                    streamId: show.id,
                    title: show.title,
                    minutes,
                }),
            ),
        );
        const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        notified += sent;
        console.log(
            `[Cron/ShowReminders] ${show.id}: ${sent}/${userIds.length} heads-up alerts sent (${minutes}m out)`,
        );
    }

    return NextResponse.json({ shows: claimedShows, notified });
}
