/**
 * Weekly Vercel cron (Monday 02:00 UTC = 09:00 Bangkok): the "what worked,
 * what to try" email for each brand, covering Monday–Sunday of the week
 * just ended, to SOCIAL_INSIGHTS_EMAIL (default support@thailandtcg.com).
 *
 * Idempotent on (brand, week): a report already sent for that week is not
 * sent again unless ?force=1. ?brand=<brand> limits to one brand. Runs after
 * the 01:30 UTC metrics sync so Sunday's numbers are in. Fails soft per
 * brand so one brand's problem never blocks the other's email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { produceWeeklyReport, insightsRecipient } from '@/lib/social/insights';
import { isoDay, shiftDay, SOCIAL_BRANDS, type SocialBrand } from '@/lib/social/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sp = request.nextUrl.searchParams;
    const force = sp.get('force') === '1';
    const only = sp.get('brand');
    const brands = SOCIAL_BRANDS.filter((b) => !only || b === only);
    const weekEnd = shiftDay(isoDay(new Date()), -1);
    const weekStart = shiftDay(weekEnd, -6);
    const supabase = createAdminClient();
    const to = insightsRecipient();

    const results: Record<string, unknown>[] = [];
    for (const brand of brands as SocialBrand[]) {
        try {
            if (!force) {
                const { data: existing } = await supabase
                    .from('social_insight_reports').select('id, sent_at')
                    .eq('brand', brand).eq('week_start', weekStart).maybeSingle();
                if (existing?.sent_at) {
                    results.push({ brand, skipped: 'already sent', sentAt: existing.sent_at });
                    continue;
                }
            }
            const r = await produceWeeklyReport(brand, { weekEnd, send: true, to });
            results.push({ brand, weekStart, weekEnd, sent: r.sent, to: r.sentTo, headline: r.narrative.headline, narrativeBy: r.narrative.generatedBy, storeError: r.error });
        } catch (e) {
            results.push({ brand, error: e instanceof Error ? e.message : String(e) });
        }
    }
    console.log('[social-weekly-insights]', JSON.stringify(results));
    return NextResponse.json({ weekStart, weekEnd, results });
}
