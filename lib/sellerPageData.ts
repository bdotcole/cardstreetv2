import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import { attachSellers, fetchPublicSellers } from '@/lib/publicProfiles';
import type { MarketplaceListing } from '@/services/marketplaceService';

export interface SellerInfo {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    partner_tier: string | null;
    partner_joined_at: string | null;
    rating: number | null;
    review_count: number | null;
    is_verified_shop: boolean | null;
    created_at: string | null;
    // Collector Pass display columns; absent until the 20260828/20260829
    // migrations run (the select falls back to the legacy column list).
    reward_level?: number | null;
    displayed_badges?: string[] | null;
    equipped_frame?: string | null;
}

const LISTING_SELECT = `
    id, seller_id, card_id, card_data, price, condition, is_graded,
    grading_company, grade, image_front_url, image_back_url, status,
    created_at, updated_at
`;

// Resolve a public seller shop by username, with their active listings. Cached
// so generateMetadata + the page body share one round-trip.
export const getSellerPageData = cache(
    async (username: string): Promise<{ seller: SellerInfo | null; listings: MarketplaceListing[] }> => {
        const supabase = await createClient();

        const SELLER_COLUMNS_LEGACY =
            'id, username, display_name, avatar_url, partner_tier, partner_joined_at, rating, review_count, is_verified_shop, created_at';
        const firstTry = await supabase
            .from('public_profiles')
            .select(`${SELLER_COLUMNS_LEGACY}, reward_level, displayed_badges, equipped_frame`)
            .eq('username', username)
            .maybeSingle<SellerInfo>();
        let seller = firstTry.data;
        // Pre-migration the view lacks the Collector Pass columns and PostgREST
        // rejects the whole select — retry with the legacy list so seller pages
        // never 404 over a cosmetic column.
        if (firstTry.error) {
            ({ data: seller } = await supabase
                .from('public_profiles')
                .select(SELLER_COLUMNS_LEGACY)
                .eq('username', username)
                .maybeSingle<SellerInfo>());
        }
        if (!seller) return { seller: null, listings: [] };

        const { data: rows } = await supabase
            .from('listings')
            .select(LISTING_SELECT)
            .eq('seller_id', seller.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false });

        const listings = await attachSellers(supabase, ((rows || []) as any[]).map((r) => ({
            ...r,
            card_data: normalizeCard(r.card_data, r.card_id),
        })) as MarketplaceListing[]);

        return { seller, listings };
    }
);

// Usernames of sellers with at least one active listing — the shops worth
// indexing (a seller page renders only active listings, so these are the pages
// with real content). Used by the sellers sitemap. Paged past the 1000-row
// PostgREST cap and deduped by username; usernames may be null on legacy rows.
export async function getActiveSellerUsernames(): Promise<string[]> {
    const supabase = await createClient();
    // Collect distinct seller ids from active listings, then resolve their public
    // usernames from public_profiles (the base table no longer allows cross-user
    // reads, so a seller:profiles(...) embed would come back null).
    const sellerIds = new Set<string>();
    for (let from = 0; ; from += 1000) {
        const { data } = await supabase
            .from('listings')
            .select('seller_id')
            .eq('status', 'active')
            .order('seller_id', { ascending: true })
            .range(from, from + 999);
        if (!data?.length) break;
        for (const row of data as { seller_id: string | null }[]) {
            if (row.seller_id) sellerIds.add(row.seller_id);
        }
        if (data.length < 1000) break;
    }
    const sellers = await fetchPublicSellers(supabase, [...sellerIds]);
    const usernames = new Set<string>();
    for (const s of sellers.values()) {
        if (s.username) usernames.add(s.username);
    }
    return [...usernames];
}

export interface ShopSummary {
    username: string;
    displayName: string;
    avatarUrl: string | null;
    rating: number | null;
    reviewCount: number;
    isVerified: boolean;
    listingCount: number;
    /** Cheapest active listing, THB — the "from" price on a directory card. */
    fromPrice: number | null;
}

// Every shop with active inventory, for the /shops directory.
//
// getActiveSellerUsernames() above returns usernames only, which is all the
// sitemap needs. A directory page needs enough to be worth landing on, so this
// carries the listing count and a "from" price too.
//
// WHY THE PAGE EXISTS: measured 2026-09-01, the seller pages holding the whole
// of the active inventory had ZERO internal links from any content page — they
// were reachable only through sellers-sitemap. With 222 listings against
// 117,322 card pages, the shops are the scarce, convertible surface, and they
// had no crawl path.
//
// Sorted by listing count so the shops with real stock lead. Fails soft: any
// error returns an empty list and the page renders its empty state rather than
// throwing.
export const getActiveShops = cache(async (): Promise<ShopSummary[]> => {
    const supabase = await createClient();

    // Same 1000-row paging as getActiveSellerUsernames — PostgREST caps a
    // single response, and a silent truncation here would drop real shops.
    const rows: { seller_id: string | null; price: number | null }[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('listings')
            .select('seller_id, price')
            .eq('status', 'active')
            .order('seller_id', { ascending: true })
            .range(from, from + 999);
        if (error || !data?.length) break;
        rows.push(...(data as typeof rows));
        if (data.length < 1000) break;
    }
    if (!rows.length) return [];

    const byId = new Map<string, { count: number; from: number | null }>();
    for (const r of rows) {
        if (!r.seller_id) continue;
        const cur = byId.get(r.seller_id) ?? { count: 0, from: null };
        cur.count += 1;
        const price = Number(r.price);
        if (price > 0 && (cur.from === null || price < cur.from)) cur.from = price;
        byId.set(r.seller_id, cur);
    }

    const sellers = await fetchPublicSellers(supabase, [...byId.keys()]);
    const shops: ShopSummary[] = [];
    for (const [id, agg] of byId) {
        const s = sellers.get(id);
        // A shop with no public username has no page to link to.
        if (!s?.username) continue;
        const rating = s.rating === null || s.rating === undefined ? null : Number(s.rating);
        shops.push({
            username: s.username,
            displayName: s.display_name || s.username,
            avatarUrl: s.avatar_url ?? null,
            rating: Number.isFinite(rating as number) ? (rating as number) : null,
            reviewCount: s.review_count ?? 0,
            isVerified: !!s.is_verified_shop,
            listingCount: agg.count,
            fromPrice: agg.from,
        });
    }
    shops.sort((a, b) => b.listingCount - a.listingCount || a.displayName.localeCompare(b.displayName));
    return shops;
});
