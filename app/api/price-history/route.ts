import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePremium } from '@/lib/premiumAuth';
import { NextRequest, NextResponse } from 'next/server';

// Market-value-over-time for one subject, read from price_snapshots (grown daily by
// the price-snapshots cron; the past was seeded once by the 20260710 estimated
// backfill, flagged source='estimated' in the table). Returns THB-base points
// ascending by day. The client folds in the current live price as the final point.
//
//   GET /api/price-history?id=<subject_id>&language=<lang>&condition=<Market|Sealed>&range=<7d|30d|90d|180d|1y>
//
// subject_id is a pokemon_cards.id (condition defaults to 'Market') or a
// sealed_products.id 'pc-<id>' (defaults to 'Sealed'). Prices are public catalog data
// for the free ranges; 180d/1y are Pro (advanced_market) and gated with the same
// requirePremium() lock as /api/insights — the client never requests them unlocked,
// so a 401/403 here only ever answers a hand-crafted request. The RLS policy on
// price_snapshots mirrors the split (public SELECT covers only the free window), so
// Pro reads go through the service role once the gate passes.

export const runtime = 'nodejs';

const RANGE_DAYS: Record<string, number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '180d': 180,
    '1y': 365,
};
const PRO_RANGES = new Set(['180d', '1y']);

export async function GET(request: NextRequest) {
    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');
    if (!id) return NextResponse.json({ history: [] });

    const language = sp.get('language') || 'en';
    const condition = sp.get('condition') || (id.startsWith('pc-') ? 'Sealed' : 'Market');
    const range = sp.get('range') || '30d';
    const days = RANGE_DAYS[range] ?? 30;
    const isPro = PRO_RANGES.has(range);

    if (isPro) {
        const gate = await requirePremium();
        if (gate instanceof NextResponse) return gate;
    }

    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    try {
        // Pro ranges read past the RLS free-window policy; the gate above already ran.
        const supabase = isPro ? createAdminClient() : await createClient();
        const { data, error } = await supabase
            .from('price_snapshots')
            .select('captured_on, market_thb')
            .eq('subject_id', id)
            .eq('language', language)
            .eq('condition', condition)
            .gte('captured_on', cutoff)
            .order('captured_on', { ascending: true })
            .limit(400);
        if (error) throw error;

        const history = (data || []).map((r) => ({ t: r.captured_on as string, v: Number(r.market_thb) }));
        return NextResponse.json(
            { history },
            {
                headers: {
                    // Free ranges are public catalog data, refreshed at most once/day by
                    // the cron. Pro ranges must stay private: a shared/CDN cache entry
                    // keyed only on the URL would serve one subscriber's response to
                    // everyone who asks after them.
                    'Cache-Control': isPro
                        ? 'private, max-age=3600'
                        : 'public, max-age=3600, stale-while-revalidate=86400',
                },
            },
        );
    } catch {
        // Fail soft: the chart simply hides when there's no data.
        return NextResponse.json({ history: [] });
    }
}
