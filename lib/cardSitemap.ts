import 'server-only';
import { createClient } from '@supabase/supabase-js';

// URLs per card-sitemap file. Capped at 1000 because PostgREST returns at most
// 1000 rows per query (a single .range() past that is silently truncated), so
// one file == one query keeps the code simple. ~76 files for the full catalog,
// far below the sitemaps.org 50k-URL / 50MB-per-file and 50k-sitemap-index caps.
export const CARDS_PER_SITEMAP = 1000;

// Anon client — pokemon_cards is public catalog data (the marketplace reads it
// from the browser), so no service role is needed for these read-only listings.
function catalogClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
    );
}

// Only cards with an image are worth submitting — an imageless page is thin.
const HAS_IMAGE = (q: any) => q.not('image_small', 'is', null);

export async function countSitemapCards(): Promise<number> {
    const { count } = await HAS_IMAGE(
        catalogClient().from('pokemon_cards').select('id', { count: 'exact', head: true })
    );
    return count || 0;
}

export async function sitemapPageCount(): Promise<number> {
    return Math.max(1, Math.ceil((await countSitemapCards()) / CARDS_PER_SITEMAP));
}

export interface SitemapCard {
    id: string;
    /** ISO timestamp, or null when we have no honest date for the card. */
    lastmod: string | null;
}

/**
 * A card page's real last-modified date.
 *
 * Two things change what the page renders: the catalog row itself
 * (pokemon_cards.updated_at) and its price (market_values.last_updated, one row
 * per condition/printing, so take the newest). The later of the two is the
 * honest answer; when neither exists we emit no <lastmod> at all rather than
 * inventing one, because per-URL lastmod is optional and a wrong date is worse
 * than none — Google ignores lastmod wholesale once it judges a site's dates
 * unreliable.
 *
 * Both inputs were checked for discrimination before this shipped (2026-08-14):
 * pokemon_cards.updated_at moved on 76 rows in 24h / 6,577 in 7d / 29,053 in 30d
 * of 104,992, and market_values.last_updated on 34,167 / 71,817 / 93,689 of
 * 453,284. A column that stamps everything on every run would be no better than
 * the fabricated timestamp this replaces.
 */
function lastmodFor(row: { updated_at?: string | null; market_values?: { last_updated: string | null }[] | null }): string | null {
    let newest = row.updated_at || null;
    for (const mv of row.market_values || []) {
        if (mv.last_updated && (!newest || mv.last_updated > newest)) newest = mv.last_updated;
    }
    return newest;
}

export async function cardsForPage(page: number): Promise<SitemapCard[]> {
    const from = page * CARDS_PER_SITEMAP;
    const to = from + CARDS_PER_SITEMAP - 1;
    // The embed costs ~0.3-1.7s per chunk against ~0.3s for ids alone, paid once
    // per chunk per day behind the route's revalidate. Verified 2026-08-14 to
    // return exactly the same row count as the id-only query — an embed that
    // silently dropped rows would drop URLs from the sitemap.
    const { data } = await HAS_IMAGE(
        catalogClient()
            .from('pokemon_cards')
            .select('id, updated_at, market_values(last_updated)')
            .order('id', { ascending: true })
    ).range(from, to);
    return (data || []).map((r: any) => ({ id: r.id, lastmod: lastmodFor(r) }));
}
