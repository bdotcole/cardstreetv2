import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { normalizeCard } from '@/lib/utils/normalizeCard';
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
    created_at, updated_at,
    seller:profiles(id, username, display_name, avatar_url, partner_tier, role, partner_joined_at, rating, review_count)
`;

// Resolve a public seller shop by username, with their active listings. Cached
// so generateMetadata + the page body share one round-trip.
export const getSellerPageData = cache(
    async (username: string): Promise<{ seller: SellerInfo | null; listings: MarketplaceListing[] }> => {
        const supabase = await createClient();

        const { data: seller } = await supabase
            .from('profiles')
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

        const listings = ((rows || []) as any[]).map((r) => ({
            ...r,
            card_data: normalizeCard(r.card_data, r.card_id),
        })) as MarketplaceListing[];

        return { seller, listings };
    }
);
