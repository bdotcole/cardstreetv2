// Stand-in artwork for sets the catalog has no logo for. Shared by /api/sets
// (the app's set pickers) and the desktop set browser, so a set shows the same
// picture wherever it is listed.
//
// Takes the caller's Supabase client rather than making one: the API route
// reads with the service role, the server-rendered pages with the visitor's
// session, and `pokemon_sets` and `sealed_products` are publicly readable
// either way.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSetLogoUrl } from '@/lib/imageUtils';

export interface SetArtFallback {
    /** The same product's logo from its other-language twin. */
    logo: string | null;
    symbol: string | null;
    /** Booster pack or box photo from the sealed catalog. */
    product: string | null;
}

/**
 * Display URL for a set logo or symbol at roughly `width` pixels.
 *
 * getSetLogoUrl with one exception: a few sets use an object from the
 * `card-images` bucket as their logo, and catalog art in that bucket is served
 * as stored, never through the billed render endpoint (CLAUDE.md, "Card
 * images").
 */
export function setArtUrl(url: string | null | undefined, width: number): string {
    if (!url) return '';
    return url.includes('/card-images/') ? url.trim() : getSetLogoUrl(url, width);
}

/** A catalog id without its language suffix: S11a-th and S11a are one product. */
export const twinIdOf = (id: string): string => id.replace(/-(?:th|jp|ja|en)$/i, '');

// Which sealed product stands in for a set that has no logo: the booster pack
// is what a collector recognises a set by; the box and the rest follow.
const PRODUCT_ART_PREFERENCE = ['booster_pack', 'booster_box', 'etb', 'bundle', 'collection', 'other'];
const productArtRank = (type: string | null): number => {
    const i = PRODUCT_ART_PREFERENCE.indexOf(type || '');
    return i === -1 ? PRODUCT_ART_PREFERENCE.length : i;
};

// Ids per sealed_products request. The whole catalog has about 160 logo-less
// sets, which is too many ids for one URL and, at several products a set, more
// rows than one response carries.
const PRODUCT_CHUNK = 60;

/**
 * Fallback art for every row without a logo of its own, keyed by set id. Rows
 * that have a logo, and rows nothing could be found for, are absent.
 */
export async function resolveMissingSetArt(
    supabase: SupabaseClient,
    rows: { id: string; logo_url: string | null }[],
): Promise<Map<string, SetArtFallback>> {
    const out = new Map<string, SetArtFallback>();
    const missing = rows.filter((s) => !s.logo_url);
    if (missing.length === 0) return out;

    // Thai sets reprint a Japanese product 1:1 under the same code, and the
    // older Thai rows (S5a-th .. S11a-th, SVM-th) carry no logo while the JP
    // twin does. Borrow the twin's: it is the same artwork, only the
    // wordmark's script differs, and it beats a blank tile.
    const twinIds = [...new Set(missing.map((s) => twinIdOf(s.id)).filter((twin, i) => twin && twin !== missing[i].id))];
    const twinArt = new Map<string, { logo_url: string | null; symbol_url: string | null }>();
    if (twinIds.length > 0) {
        const { data: twins } = await supabase
            .from('pokemon_sets')
            .select('id, logo_url, symbol_url')
            .in('id', twinIds)
            .not('logo_url', 'is', null)
            .neq('logo_url', '');
        for (const t of twins || []) twinArt.set(t.id, t);
    }

    // Pack or box photo for every set still without a logo of its own. The
    // sealed catalog carries one for most Thai sets, and the set tiles fall
    // through to it when the logo is missing or fails to load.
    const productArt = new Map<string, { url: string; rank: number }>();
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += PRODUCT_CHUNK) chunks.push(missing.slice(i, i + PRODUCT_CHUNK).map((s) => s.id));
    const results = await Promise.all(
        chunks.map((ids) =>
            supabase
                .from('sealed_products')
                .select('set_id, product_type, image_url')
                .in('set_id', ids)
                .not('image_url', 'is', null)
                .limit(1000),
        ),
    );
    for (const { data: products } of results) {
        for (const p of products || []) {
            if (!p.set_id || !p.image_url) continue;
            const rank = productArtRank(p.product_type);
            const current = productArt.get(p.set_id);
            if (!current || rank < current.rank) productArt.set(p.set_id, { url: p.image_url, rank });
        }
    }

    for (const s of missing) {
        const twinId = twinIdOf(s.id);
        const twin = twinId !== s.id ? twinArt.get(twinId) : undefined;
        const product = productArt.get(s.id)?.url || null;
        if (!twin && !product) continue;
        out.set(s.id, { logo: twin?.logo_url || null, symbol: twin?.symbol_url || null, product });
    }
    return out;
}
