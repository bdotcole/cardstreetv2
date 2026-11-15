import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { englishJpSetName } from '@/lib/japaneseSetNames';
import { resolveMissingSetArt, setArtUrl } from '@/lib/setArt';
import { printedSetCode } from '@/lib/setCodes';
import type { BrowserSet } from '@/lib/setGroups';
import type { Card } from '@/types';

export interface SetRow {
    id: string;
    name: string;
    game: string;
    language: string;
    /** Uneven across the catalog; read it through lib/setGroups.ts. */
    series: string | null;
    logo_url: string | null;
    symbol_url: string | null;
    printed_total: number | null;
    total: number | null;
    release_date: string | null;
}

const SET_COLUMNS = 'id, name, game, language, series, logo_url, symbol_url, printed_total, total, release_date';

/** A neighbouring set, as much as a prev/next link needs. */
export interface SetLink {
    id: string;
    name: string;
}

/** The sets released just after and just before one, in its own game and language. */
export interface SetNeighbors {
    newer: SetLink | null;
    older: SetLink | null;
}

const NO_NEIGHBORS: SetNeighbors = { newer: null, older: null };

const CARD_COLUMNS =
    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, language, market_avg, currency, last_updated)';

// Set ids are unique across languages (verified), so one id resolves to exactly
// one set and its cards. Cached per request so generateMetadata + the page body
// share a single round-trip.
export const getSetPageData = cache(
    async (setId: string): Promise<{ set: SetRow | null; cards: Card[]; neighbors: SetNeighbors }> => {
        const supabase = await createClient();

        const { data: setRows } = await supabase
            .from('pokemon_sets')
            .select(SET_COLUMNS)
            .eq('id', setId)
            .limit(1);
        const set = (setRows?.[0] as SetRow) ?? null;
        if (!set) return { set: null, cards: [], neighbors: NO_NEIGHBORS };

        // The sibling list rides alongside the cards query, so the prev/next
        // links cost the page no extra round-trip time. Two light columns,
        // in the same order as getAllSets; the largest list (English Yu-Gi-Oh,
        // 646 sets) is still under PostgREST's 1000-row cap, and a set past
        // the cap would only lose its arrows.
        const [{ data: cardRows }, { data: siblingRows }] = await Promise.all([
            supabase
                .from('pokemon_cards')
                .select(CARD_COLUMNS)
                .eq('set_id', setId)
                .order('number', { ascending: true }),
            supabase
                .from('pokemon_sets')
                .select('id, name')
                .eq('game', set.game)
                .eq('language', set.language)
                .order('release_date', { ascending: false, nullsFirst: false })
                .order('id', { ascending: true })
                .limit(1000),
        ]);

        const cards = (cardRows || []).map(mapSupabaseCardToInternal);
        // `number` is text, so the DB sort is lexicographic (1,10,100,2…).
        // Re-sort numerically for a natural card order on the page.
        cards.sort((a, b) => {
            const na = parseInt(a.number, 10);
            const nb = parseInt(b.number, 10);
            if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
            return a.number.localeCompare(b.number);
        });

        const siblings = (siblingRows || []) as SetLink[];
        const at = siblings.findIndex((r) => r.id === setId);
        const link = (r: SetLink | undefined): SetLink | null =>
            r ? { id: r.id, name: englishJpSetName(r.id, r.name) } : null;
        const neighbors: SetNeighbors =
            at === -1 ? NO_NEIGHBORS : { newer: link(siblings[at - 1]), older: link(siblings[at + 1]) };

        return { set, cards, neighbors };
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

// Every set, shaped for the set browser: display name, printed code, and the
// pictures a tile should try in order (own logo, the other-language twin's
// logo, a pack photo from the sealed catalog, the set symbol). Deliberately
// lean, since the whole list is serialized into the page for the client.
export const getSetBrowserData = cache(async (): Promise<BrowserSet[]> => {
    const sets = await getAllSets();
    const supabase = await createClient();
    const fallbackArt = await resolveMissingSetArt(supabase, sets);

    return sets.map((s) => {
        const fallback = s.logo_url ? undefined : fallbackArt.get(s.id);
        const art = [
            setArtUrl(s.logo_url || fallback?.logo, 320),
            fallback?.product || '',
            setArtUrl(s.symbol_url || fallback?.symbol, 160),
        ].filter(Boolean);
        return {
            id: s.id,
            name: englishJpSetName(s.id, s.name),
            game: s.game,
            language: s.language,
            series: s.series,
            release_date: s.release_date,
            code: printedSetCode(s),
            total: s.total || s.printed_total || 0,
            art: [...new Set(art)],
        };
    });
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
