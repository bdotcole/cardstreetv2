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

        const { data: seller } = await supabase
            .from('public_profiles')
            .select('id, username, display_name, avatar_url, partner_tier, partner_joined_at, rating, review_count, is_verified_shop, created_at')
            .eq('username', username)
            .maybeSingle<SellerInfo>();
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
