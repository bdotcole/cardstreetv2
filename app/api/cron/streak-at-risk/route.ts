/**
 * Streak-at-risk nudge — 19:00 Bangkok (12:00 UTC), daily.
 *
 * The Collector Pass check-in streak resets at Bangkok midnight, and nothing
 * ever told anyone that. A streak mechanic with no reminder measures how often
 * people happened to open the app, not whether the mechanic works.
 *
 * 19:00 is chosen, not arbitrary: five hours of runway before the streak dies,
 * after the working day, and outside the hours a notification would wake anyone.
 *
 * PUSH ONLY (lib/courier.ts sendStreakAtRiskPush). A daily email about a
 * check-in streak is spam, and would spend the sender reputation the order and
 * shipping mail depends on.
 *
 * Dedupe is the schedule itself: one run per Bangkok day, and the query only
 * selects users who have not checked in on that day, so a user can receive at
 * most one nudge per day without any log table to maintain.
 *
 * Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { bangkokDateString } from '@/lib/rewards';
import { sendStreakAtRiskPush } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Below this, there is nothing worth saving and the nudge is just noise. A
 * 1-day "streak" is a single check-in; reminding someone to protect it reads as
 * nagging, and it is also the largest population, so it would dominate the send
 * volume with the least valuable nudge.
 */
const MIN_STREAK = 2;

/** Bound the fan-out: this is a daily send, and an unbounded one is a bill. */
const MAX_SENDS = 400;
const PAGE = 1000;

interface RewardRow {
    user_id: string;
    streak_days: number | null;
    last_checkin_date: string | null;
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const today = bangkokDateString();

    try {
        // Paged: .limit() alone silently caps at PostgREST's 1000-row ceiling,
        // which would quietly stop nudging past the first page as the table grows.
        const atRisk: RewardRow[] = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await admin
                .from('rewards')
                .select('user_id, streak_days, last_checkin_date')
                .gte('streak_days', MIN_STREAK)
                .neq('last_checkin_date', today)
                .order('user_id', { ascending: true })
                .range(from, from + PAGE - 1)
                .returns<RewardRow[]>();
            if (error) {
                // Missing table = the Collector Pass migration has not run.
                // Quiet no-op, like the other rewards crons.
                if (error.code !== '42P01' && error.code !== 'PGRST205') {
                    console.error('[Cron/StreakAtRisk] query failed:', error.message);
                }
                return NextResponse.json({ ok: false, sent: 0 });
            }
            atRisk.push(...(data ?? []));
            if (!data || data.length < PAGE) break;
        }

        // .neq() drops NULLs in PostgREST, and a user who has never checked in
        // has last_checkin_date NULL — but they also have streak_days 0, so the
        // MIN_STREAK floor already excludes them. Nothing to add back.
        const targets = atRisk.slice(0, MAX_SENDS);

        // ?dryRun=1 counts and sends nothing — see the note in vault-demand.
        if (request.nextUrl.searchParams.get('dryRun') === '1') {
            console.log(`[Cron/StreakAtRisk] DRY RUN — would push to ${targets.length} user(s)`);
            return NextResponse.json({ ok: true, dryRun: true, atRisk: atRisk.length, sent: 0 });
        }

        let sent = 0;
        const CHUNK = 10;
        for (let i = 0; i < targets.length; i += CHUNK) {
            const results = await Promise.allSettled(
                targets.slice(i, i + CHUNK).map((r) =>
                    sendStreakAtRiskPush(r.user_id, r.streak_days ?? 0),
                ),
            );
            sent += results.filter((x) => x.status === 'fulfilled' && x.value === true).length;
        }

        console.log(
            `[Cron/StreakAtRisk] ${today}: ${atRisk.length} at risk, ${sent} push(es) dispatched`,
        );
        return NextResponse.json({ ok: true, atRisk: atRisk.length, sent });
    } catch (err) {
        console.error('[Cron/StreakAtRisk] error:', err);
        return NextResponse.json({ ok: false, sent: 0 });
    }
}
