import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/adminAuth';

// GET /api/admin/catalog/coverage?game=pokemon&language=en
//
// PriceCharting sets ("consoles") we carry poorly or not at all, newest first.
// Filled once a day per game by /api/cron/pricecharting into
// pricecharting_console_coverage. A low number means the set is missing from our
// catalog OR present but unmatched to PriceCharting (so unpriced); either way it
// needs a look. Chinese/Korean consoles are left out: we don't sell those catalogs.

export const runtime = 'nodejs';

// A console is listed when we have matched less than this share of its singles.
const MAX_COVERAGE = 0.5;
// Ignore tiny consoles (promo one-offs, misfiled singles).
const MIN_CARDS = 10;

export async function GET(request: NextRequest) {
    const denied = await requireAdmin();
    if (denied) return denied;

    const game = request.nextUrl.searchParams.get('game');
    const language = request.nextUrl.searchParams.get('language');

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    let q = supabase
        .from('pricecharting_console_coverage')
        .select('console_name, game, language, card_products, mapped_products, release_date, first_seen_at, updated_at')
        .in('language', ['en', 'ja'])
        .gte('card_products', MIN_CARDS)
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(1000);
    if (game) q = q.eq('game', game);
    if (language) q = q.eq('language', language === 'jp' ? 'ja' : language);

    const { data, error } = await q;
    if (error) {
        // Before the migration runs the table is missing; the panel shows a hint.
        return NextResponse.json({ available: false, sets: [], error: error.message });
    }
    const sets = (data || [])
        .filter((r) => r.mapped_products / r.card_products < MAX_COVERAGE)
        .slice(0, 200);
    return NextResponse.json({ available: true, sets, updatedAt: data?.[0]?.updated_at ?? null });
}
