/**
 * GET /api/admin/social/content?brand=&days=
 *
 * The Content tab's data: every stored post for the brand published in the
 * window with its content metrics, Instagram's hourly online-followers
 * (from the daily rows' raw) for "best time to post", and the brand's past
 * weekly reports (metadata only — the html is fetched by id from
 * /api/admin/social/insights).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isoDay, shiftDay, SOCIAL_BRANDS, type SocialBrand } from '@/lib/social/types';

export const runtime = 'nodejs';

const RANGES = new Set([7, 28, 90]);

export async function GET(request: NextRequest) {
    const gate = await requireAdmin();
    if (gate) return gate;
    const sp = request.nextUrl.searchParams;
    const brandParam = sp.get('brand') ?? 'cardstreet';
    const brand: SocialBrand = (SOCIAL_BRANDS as string[]).includes(brandParam) ? (brandParam as SocialBrand) : 'cardstreet';
    const daysParam = Number(sp.get('days'));
    const days = RANGES.has(daysParam) ? daysParam : 28;
    const until = shiftDay(isoDay(new Date()), -1);
    const since = shiftDay(until, -(days - 1));

    const supabase = createAdminClient();
    const { data: accounts, error: accErr } = await supabase
        .from('social_accounts').select('id, platform, display_name, handle').eq('brand', brand);
    if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });
    const ids = (accounts ?? []).map((a: any) => a.id);
    const igIds = (accounts ?? []).filter((a: any) => a.platform === 'instagram').map((a: any) => a.id);

    const [postsRes, onlineRes, reportsRes] = await Promise.all([
        ids.length
            ? supabase.from('social_posts').select('*').in('account_id', ids).gte('published_at', `${since}T00:00:00Z`).order('published_at', { ascending: false }).limit(400)
            : Promise.resolve({ data: [], error: null }),
        igIds.length
            ? supabase.from('social_metrics_daily').select('account_id, day, raw').in('account_id', igIds).gte('day', since).lte('day', until)
            : Promise.resolve({ data: [], error: null }),
        supabase.from('social_insight_reports').select('id, week_start, week_end, sent_to, sent_at, narrative, created_at').eq('brand', brand).order('week_start', { ascending: false }).limit(12),
    ]);
    if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });

    // Average each Bangkok hour across the days Instagram reported online followers.
    const hourTotals = new Array(24).fill(0);
    let onlineDays = 0;
    for (const r of (onlineRes.data ?? []) as any[]) {
        const online = r.raw?.online_followers;
        if (!online || typeof online !== 'object') continue;
        onlineDays++;
        for (const [h, n] of Object.entries(online)) {
            const hour = Number(h);
            if (hour >= 0 && hour < 24) hourTotals[(hour + 7) % 24] += Number(n) || 0;
        }
    }

    return NextResponse.json({
        brand,
        window: { since, until, days },
        accounts: accounts ?? [],
        posts: (postsRes.data ?? []).map((p: any) => {
            // The retention curve is only for a detail view; keep the list light.
            const { retention, raw, ...rest } = p;
            return { ...rest, has_retention: Array.isArray(retention) && retention.length > 0 };
        }),
        onlineFollowersByHour: onlineDays ? hourTotals.map((t) => Math.round(t / onlineDays)) : null,
        reports: reportsRes.error ? [] : (reportsRes.data ?? []),
        reportsError: reportsRes.error?.message ?? null,
    });
}
