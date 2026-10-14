/**
 * Shop search by seller name. GET ?q=<text> → { shops }.
 *
 * Search only ever looked in the card catalog, so a buyer who left a shop page
 * had no way back to it (reported 2026-10-14: "tried following or searching,
 * couldn't find it"). This matches the shop's display name or username and
 * returns only real shops — accounts with listings, active or paused — so a
 * name search never surfaces buyers.
 *
 * The admin client is used for its lack of cookies, not for its privileges:
 * both reads are public data (the public_profiles view, active/paused
 * listings), and a cookie client could attach a refreshed session cookie to a
 * response the CDN is allowed to cache.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clipQuery, widthFold } from '@/lib/search/normalize';
import { SHOP_SEARCH_MIN_CHARS, type ShopSearchResult } from '@/lib/shopSearch';

export const dynamic = 'force-dynamic';

// Name matches are mostly buyers; this has to be wide enough that the shops
// among them survive a short query ("ar"), since only shops are returned.
const MAX_MATCHES = 200;
const MAX_RESULTS = 6;
// Seller ids per listings lookup, so the .in() list keeps the URL short.
const ID_CHUNK = 50;

// Everything that is not a letter, digit or combining mark (Thai vowels and
// tone marks are marks). That covers separators people type differently
// ("Ari_shop", "ari shop", "Ari-shop") and every character PostgREST's or()
// syntax or LIKE treats specially.
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;

/**
 * The query's words joined by LIKE wildcards, so any separator, or none,
 * matches. Not sanitizeTerm: that turns "_" into a space, and "Ari shop" then
 * misses the shop actually named "Ari_shop".
 */
function namePattern(q: string): string | null {
    const words = widthFold(q).split(NON_WORD).filter(Boolean);
    if (words.join('').length < SHOP_SEARCH_MIN_CHARS) return null;
    return `%${words.join('%')}%`;
}

const looseName = (s: string) => widthFold(s).toLowerCase().replace(NON_WORD, '');

export async function GET(request: NextRequest) {
    const raw = clipQuery(request.nextUrl.searchParams.get('q'));
    const pattern = namePattern(raw);
    if (!pattern) {
        return NextResponse.json({ shops: [] });
    }

    const supabase = createAdminClient();
    const { data: profiles, error } = await supabase
        .from('public_profiles')
        .select('id, username, display_name, avatar_url, rating, review_count, is_verified_shop, partner_joined_at')
        .or(`display_name.ilike.${pattern},username.ilike.${pattern}`)
        .limit(MAX_MATCHES);
    if (error) {
        console.error('[ShopSearch] profile lookup failed:', error.message);
        return NextResponse.json({ shops: [] });
    }
    const matches = (profiles ?? []) as Omit<ShopSearchResult, 'listing_count' | 'paused'>[];
    if (matches.length === 0) {
        return NextResponse.json({ shops: [] }, { headers: cacheHeaders() });
    }

    // Which matches are shops. Only existence + a rough count matter, and each
    // chunk's stock is well under PostgREST's 1000-row page.
    const ids = matches.map((m) => m.id);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
    const pages = await Promise.all(chunks.map(async (chunk) => {
        const { data } = await supabase
            .from('listings')
            .select('seller_id, status')
            .in('seller_id', chunk)
            .in('status', ['active', 'paused'])
            .limit(1000);
        return (data ?? []) as { seller_id: string; status: string }[];
    }));
    const active = new Map<string, number>();
    const paused = new Set<string>();
    for (const l of pages.flat()) {
        if (l.status === 'active') active.set(l.seller_id, (active.get(l.seller_id) ?? 0) + 1);
        else paused.add(l.seller_id);
    }

    const needle = looseName(raw);
    const rank = (m: { display_name: string | null; username: string | null }) => {
        const names = [m.display_name, m.username].filter(Boolean).map((n) => looseName(n as string));
        if (names.some((n) => n === needle)) return 0;
        if (names.some((n) => n.startsWith(needle))) return 1;
        return 2;
    };

    const shops: ShopSearchResult[] = matches
        .filter((m) => active.has(m.id) || paused.has(m.id))
        .map((m) => ({
            ...m,
            rating: m.rating === null || m.rating === undefined ? null : Number(m.rating),
            review_count: m.review_count ?? 0,
            is_verified_shop: !!m.is_verified_shop,
            listing_count: active.get(m.id) ?? 0,
            // Paused = has stock but none of it is showing.
            paused: !active.has(m.id),
        }))
        .sort((a, b) => rank(a) - rank(b) || b.listing_count - a.listing_count)
        .slice(0, MAX_RESULTS);

    return NextResponse.json({ shops }, { headers: cacheHeaders() });
}

// Same answer for everyone, and a shop appearing a minute late is harmless.
function cacheHeaders() {
    return { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' };
}
