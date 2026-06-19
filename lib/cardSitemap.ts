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

export async function cardIdsForPage(page: number): Promise<string[]> {
    const from = page * CARDS_PER_SITEMAP;
    const to = from + CARDS_PER_SITEMAP - 1;
    const { data } = await HAS_IMAGE(
        catalogClient().from('pokemon_cards').select('id').order('id', { ascending: true })
    ).range(from, to);
    return (data || []).map((r: { id: string }) => r.id);
}
