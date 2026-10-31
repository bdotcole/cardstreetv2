import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

// URLs per card-sitemap file. Capped at 1000 because PostgREST returns at most
// 1000 rows per query (a single .range() past that is silently truncated), so
// one file == one query keeps the code simple. ~120 files for the full catalog,
// far below the sitemaps.org 50k-URL / 50MB-per-file and 50k-sitemap-index caps.
export const CARDS_PER_SITEMAP = 1000;

// Service-role client, deliberately. pokemon_cards is public catalog data and
// the anon key used to be enough, but the anon role runs under Supabase's 3s
// statement_timeout and both queries below cross it on a cold instance: the
// exact count right after a deploy, and the deep-offset shard pages (~2.8s with
// the price embed). The cancelled query came back as a null count / empty data
// and was published as a 1-shard index or a 404 shard (see the guards below).
// The service role's timeout is 8s. This module is `server-only`, imported by
// two route handlers, and reads ids and timestamps only, so bypassing RLS
// changes nothing about what is exposed.
function catalogClient() {
    return createAdminClient();
}

// Only cards with an image are worth submitting — an imageless page is thin.
const HAS_IMAGE = (q: any) => q.not('image_small', 'is', null);

// A sitemap that silently shrinks is worse than one that fails. Google treats a
// 200 as the truth and a 5xx as "try again later", so every query here THROWS
// on error instead of degrading: with `revalidate = 86400` on the routes, a throw
// during background revalidation keeps the last good response in the cache, and
// a throw on a cold first render returns a 500 that Google retries. The
// degrading version published a 1-shard index for a day on 2026-10-15, 10-19
// and 10-30 (Search Console read it as 1,000 pages instead of ~116k), and
// turned slow shards into 404s.
//
// The catalog has >120k imaged cards; a count below this is a failed query,
// not a smaller catalog. Raise it only if the catalog is deliberately shrunk.
const SANITY_FLOOR = 50_000;

export async function countSitemapCards(): Promise<number> {
    const { count, error } = await HAS_IMAGE(
        catalogClient().from('pokemon_cards').select('id', { count: 'exact', head: true })
    );
    if (error) throw new Error(`cards-sitemap count failed: ${error.message}`);
    if (!count || count < SANITY_FLOOR) throw new Error(`cards-sitemap count implausible: ${count}`);
    return count;
}

export async function sitemapPageCount(): Promise<number> {
    return Math.ceil((await countSitemapCards()) / CARDS_PER_SITEMAP);
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

/**
 * One shard of card URLs. Throws on a query error; returns an empty array only
 * for a page number past the end of the catalog, which the route turns into the
 * one legitimate 404.
 */
export async function cardsForPage(page: number): Promise<SitemapCard[]> {
    const from = page * CARDS_PER_SITEMAP;
    const to = from + CARDS_PER_SITEMAP - 1;
    // The embed costs ~0.3-1.7s per chunk against ~0.3s for ids alone, paid once
    // per chunk per day behind the route's revalidate. Verified 2026-08-14 to
    // return exactly the same row count as the id-only query — an embed that
    // silently dropped rows would drop URLs from the sitemap.
    const { data, error } = await HAS_IMAGE(
        catalogClient()
            .from('pokemon_cards')
            .select('id, updated_at, market_values(last_updated)')
            .order('id', { ascending: true })
    ).range(from, to);
    if (error) throw new Error(`cards-sitemap page ${page} failed: ${error.message}`);
    return (data || []).map((r: any) => ({ id: r.id, lastmod: lastmodFor(r) }));
}
