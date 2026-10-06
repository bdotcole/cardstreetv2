/**
 * GET /api/admin/social/metrics?brand=<brand>&days=<7|28|90>
 *
 * Everything the dashboard needs for one brand in one round trip: the
 * brand's accounts (tokens stripped), the daily rows for the window AND the
 * window before it (for the "vs previous period" deltas), the recent posts,
 * and — for Cardstreet — the GA4 sessions that arrived from each platform.
 * Aggregation happens in the browser; four accounts over 180 days is a few
 * hundred rows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { CONNECT_PROVIDERS, isGa4Configured, isProviderConfigured } from '@/lib/social/config';
import { isoDay, shiftDay, SOCIAL_BRANDS, toPublicAccount, type SocialAccountRow, type SocialBrand } from '@/lib/social/types';

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
    const prevSince = shiftDay(since, -days);

    const supabase = createAdminClient();
    const { data: accountRows, error: accErr } = await supabase
        .from('social_accounts').select('*').eq('brand', brand).order('platform').order('connected_at');
    if (accErr) {
        const missing = /social_accounts/.test(accErr.message) && /does not exist|schema cache/.test(accErr.message);
        return NextResponse.json({ error: accErr.message, migrationMissing: missing }, { status: missing ? 200 : 500 });
    }
    const accounts = (accountRows ?? []) as SocialAccountRow[];
    const ids = accounts.map((a) => a.id);

    const [dailyRes, postsRes, trafficRes] = await Promise.all([
        ids.length
            ? supabase.from('social_metrics_daily')
                .select('account_id, day, followers, follower_delta, reach, views, profile_views, link_clicks, engagements, likes, comments, shares, saves, watch_minutes, posts')
                .in('account_id', ids).gte('day', prevSince).lte('day', until).order('day')
            : Promise.resolve({ data: [], error: null }),
        ids.length
            ? supabase.from('social_posts')
                .select('account_id, external_id, published_at, caption, media_type, permalink, thumbnail_url, reach, views, likes, comments, shares, saves')
                .in('account_id', ids).gte('published_at', `${prevSince}T00:00:00Z`).order('published_at', { ascending: false }).limit(200)
            : Promise.resolve({ data: [], error: null }),
        brand === 'cardstreet'
            ? supabase.from('social_site_traffic_daily').select('day, platform, sessions, users').gte('day', prevSince).lte('day', until).order('day')
            : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [dailyRes, postsRes, trafficRes]) {
        if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    }

    return NextResponse.json({
        brand,
        window: { since, until, prevSince, days },
        accounts: accounts.map(toPublicAccount),
        daily: dailyRes.data ?? [],
        posts: postsRes.data ?? [],
        siteTraffic: trafficRes.data ?? [],
        providers: Object.fromEntries(CONNECT_PROVIDERS.map((p) => [p, isProviderConfigured(p)])),
        ga4: isGa4Configured(),
    });
}
