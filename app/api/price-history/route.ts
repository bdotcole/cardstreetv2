import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// Real market-value-over-time for one subject, read from price_snapshots (filled by
// the daily price-snapshots cron). Returns THB-base points ascending by day. The
// client folds in the current live price as the final point, so a chart appears as
// soon as there is >=1 stored snapshot. No synthesized data.
//
//   GET /api/price-history?id=<subject_id>&language=<lang>&condition=<Market|Sealed>
//
// subject_id is a pokemon_cards.id (condition defaults to 'Market') or a
// sealed_products.id 'pc-<id>' (defaults to 'Sealed'). Prices are public catalog data.

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');
    if (!id) return NextResponse.json({ history: [] });

    const language = sp.get('language') || 'en';
    const condition = sp.get('condition') || (id.startsWith('pc-') ? 'Sealed' : 'Market');

    try {
        const supabase = await createClient();
        const { data, error } = await supabase
            .from('price_snapshots')
            .select('captured_on, market_thb')
            .eq('subject_id', id)
            .eq('language', language)
            .eq('condition', condition)
            .order('captured_on', { ascending: true })
            .limit(400);
        if (error) throw error;

        const history = (data || []).map((r) => ({ t: r.captured_on as string, v: Number(r.market_thb) }));
        return NextResponse.json(
            { history },
            {
                headers: {
                    // Public catalog data, refreshed at most once/day by the cron.
                    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
                },
            },
        );
    } catch {
        // Fail soft: the chart simply hides when there's no data.
        return NextResponse.json({ history: [] });
    }
}
