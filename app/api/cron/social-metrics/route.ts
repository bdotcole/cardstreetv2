/**
 * Daily Vercel cron (01:30 UTC = 08:30 Bangkok): pull yesterday's social
 * metrics for every connected account into social_metrics_daily, and the
 * GA4 sessions-from-social into social_site_traffic_daily.
 *
 * Re-pulls the last DEFAULT_SYNC_DAYS days on every run because Meta and
 * YouTube keep restating a day for ~48h after it ends; the merge in
 * lib/social/sync.ts never lets a null overwrite a stored number. `?days=N`
 * (max 90) forces a longer backfill — the dashboard's Sync button does the
 * same through /api/admin/social/sync.
 *
 * Fails soft: an account whose token died is marked with last_sync_error and
 * the rest still sync; the response lists every outcome for the Vercel log.
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncSocialAccounts, DEFAULT_SYNC_DAYS, MAX_SYNC_DAYS } from '@/lib/social/sync';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const daysParam = Number(request.nextUrl.searchParams.get('days'));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(MAX_SYNC_DAYS, daysParam) : DEFAULT_SYNC_DAYS;

    try {
        const summary = await syncSocialAccounts({ days });
        const failed = summary.accounts.filter((a) => !a.ok);
        console.log('[social-metrics]', JSON.stringify({
            window: summary.window,
            synced: summary.accounts.length - failed.length,
            failed: failed.map((f) => `${f.platform}/${f.label}: ${f.error}`),
            siteTraffic: summary.siteTraffic,
            ms: summary.durationMs,
        }));
        return NextResponse.json(summary);
    } catch (e) {
        // Most likely the migration isn't applied yet; the cron must not page anyone over that.
        const message = e instanceof Error ? e.message : String(e);
        console.error('[social-metrics] run failed:', message);
        return NextResponse.json({ error: message }, { status: 200 });
    }
}
