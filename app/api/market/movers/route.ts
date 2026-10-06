import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';

// GET /api/market/movers?game=all|pokemon|...&window=1|7&dir=up|down&limit=12
//
// The cards whose market price moved most (market_movers, rebuilt daily by
// /api/cron/market-movers). Returns mapped Card objects, so either shell can open
// the card directly. Public and CDN-cached: the data changes once a day.

export const runtime = 'nodejs';

// Same columns the card pages select, so the mapper derives the same headline price.
const CARD_SELECT =
    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, game, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, language, market_avg, currency, last_updated)';

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const game = params.get('game') || 'all';
    const windowDays = params.get('window') === '1' ? 1 : 7;
    const dir = params.get('dir') === 'down' ? 'down' : 'up';
    const limit = Math.min(30, Math.max(1, parseInt(params.get('limit') || '12', 10) || 12));

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    let q = supabase
        .from('market_movers')
        .select('subject_id, language, old_thb, new_thb, change_pct, computed_at')
        .eq('window_days', windowDays)
        .order('change_pct', { ascending: dir === 'down' })
        .limit(limit);
    if (game !== 'all') q = q.eq('game', game);
    if (dir === 'up') q = q.gt('change_pct', 0); else q = q.lt('change_pct', 0);

    const { data: movers, error } = await q;
    if (error) {
        // Table missing (migration not applied yet) reads as "no movers", not a 500:
        // the strip simply stays hidden.
        return NextResponse.json({ items: [], computedAt: null });
    }

    const ids = (movers || []).map((m) => m.subject_id);
    const cardsById = new Map<string, ReturnType<typeof mapSupabaseCardToInternal>>();
    if (ids.length) {
        const { data: cards } = await supabase.from('pokemon_cards').select(CARD_SELECT).in('id', ids);
        for (const row of cards || []) {
            const card = mapSupabaseCardToInternal(row);
            cardsById.set(card.id, card);
        }
    }

    const items = (movers || [])
        .map((m) => {
            const card = cardsById.get(m.subject_id);
            if (!card) return null;
            return {
                card,
                oldThb: Number(m.old_thb),
                newThb: Number(m.new_thb),
                changePct: Number(m.change_pct),
            };
        })
        .filter(Boolean);

    return NextResponse.json(
        { items, computedAt: movers?.[0]?.computed_at ?? null },
        { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    );
}
