import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import type { Card } from '@/types';

export interface SetRow {
    id: string;
    name: string;
    game: string;
    language: string;
    logo_url: string | null;
    symbol_url: string | null;
    printed_total: number | null;
    total: number | null;
    release_date: string | null;
}

const SET_COLUMNS = 'id, name, game, language, logo_url, symbol_url, printed_total, total, release_date';

const CARD_COLUMNS =
    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, market_avg, currency, last_updated)';

// Set ids are unique across languages (verified), so one id resolves to exactly
// one set and its cards. Cached per request so generateMetadata + the page body
// share a single round-trip.
export const getSetPageData = cache(
    async (setId: string): Promise<{ set: SetRow | null; cards: Card[] }> => {
        const supabase = await createClient();

        const { data: setRows } = await supabase
            .from('pokemon_sets')
            .select(SET_COLUMNS)
            .eq('id', setId)
            .limit(1);
        const set = (setRows?.[0] as SetRow) ?? null;
        if (!set) return { set: null, cards: [] };

        const { data: cardRows } = await supabase
            .from('pokemon_cards')
            .select(CARD_COLUMNS)
            .eq('set_id', setId)
            .order('number', { ascending: true });

        const cards = (cardRows || []).map(mapSupabaseCardToInternal);
        // `number` is text, so the DB sort is lexicographic (1,10,100,2…).
        // Re-sort numerically for a natural card order on the page.
        cards.sort((a, b) => {
            const na = parseInt(a.number, 10);
            const nb = parseInt(b.number, 10);
            if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
            return a.number.localeCompare(b.number);
        });

        return { set, cards };
    }
);

// Every set, newest first — for the /sets index and the sets sitemap.
// PostgREST caps a single response at 1000 rows and the catalog is already
// close (966 sets as of 2026-07, growing with every ingest), so page through
// explicitly — a single query would start silently truncating.
export const getAllSets = cache(async (): Promise<SetRow[]> => {
    const supabase = await createClient();
    const PAGE = 1000;
    const all: SetRow[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
            .from('pokemon_sets')
            .select(SET_COLUMNS)
            .order('release_date', { ascending: false, nullsFirst: false })
            // Stable tiebreak so range pagination never skips/dupes rows that
            // share a release_date.
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        const rows = (data || []) as SetRow[];
        all.push(...rows);
        if (rows.length < PAGE) break;
    }
    return all;
});

export async function getAllSetIds(): Promise<string[]> {
    const supabase = await createClient();
    const PAGE = 1000;
    const ids: string[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
            .from('pokemon_sets')
            .select('id')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        const rows = (data || []) as { id: string }[];
        ids.push(...rows.map((r) => r.id));
        if (rows.length < PAGE) break;
    }
    return ids;
}
