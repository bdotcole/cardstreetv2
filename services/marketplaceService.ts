import { createClient } from '@/lib/supabase/client';
import { Card } from '@/types';

// Shape returned from profiles table join (Supabase column names, not UserProfile)
export interface SellerProfile {
    id: string;
    display_name?: string;
    avatar_url?: string;
    partner_tier?: string;
    rating?: number | string;
}


export interface MarketplaceListing {
    id: string;
    seller_id: string;
    card_id: string;
    card_data: Card;
    price: number;
    condition: string;
    is_graded: boolean;
    grading_company?: string;
    grade?: number;
    image_front_url?: string;
    image_back_url?: string;
    status: 'active' | 'sold' | 'cancelled';
    created_at: string;
    sold_at?: string;
    updated_at: string;
    seller?: SellerProfile;
}

export interface ListingFilters {
    search?: string;
    language?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: 'newest' | 'price_asc' | 'price_desc';
    limit?: number;
    offset?: number;
}

export const marketplaceService = {
    /**
     * Fetch active listings with optional server-side filters.
     * Only fetches fields that are actually rendered — never profiles(*).
     */
    async getActiveListings(filters: ListingFilters = {}): Promise<MarketplaceListing[]> {
        const supabase = createClient();
        const {
            search,
            language,
            minPrice,
            maxPrice,
            sort = 'newest',
            limit = 50,
            offset = 0,
        } = filters;

        try {
            let query = supabase
                .from('listings')
                .select(`
                    id,
                    seller_id,
                    card_id,
                    card_data,
                    price,
                    condition,
                    is_graded,
                    grading_company,
                    grade,
                    image_front_url,
                    image_back_url,
                    status,
                    created_at,
                    updated_at,
                    seller:profiles(id, display_name, avatar_url, partner_tier)
                `)
                .eq('status', 'active');

            // Server-side search: filter by card name inside JSONB
            if (search && search.trim().length > 0) {
                query = query.ilike('card_data->>name', `%${search.trim()}%`);
            }

            // Server-side language filter
            if (language && language !== 'all') {
                query = query.eq('card_data->>language', language);
            }

            // Server-side price range
            if (minPrice !== undefined && minPrice > 0) {
                query = query.gte('price', minPrice);
            }
            if (maxPrice !== undefined && maxPrice < 100000) {
                query = query.lte('price', maxPrice);
            }

            // Server-side sort
            switch (sort) {
                case 'price_asc':
                    query = query.order('price', { ascending: true });
                    break;
                case 'price_desc':
                    query = query.order('price', { ascending: false });
                    break;
                default:
                    query = query.order('created_at', { ascending: false });
            }

            // Pagination
            query = query.range(offset, offset + limit - 1);

            const { data, error } = await query;
            if (error) throw error;
            return (data || []) as unknown as MarketplaceListing[];
        } catch (error) {
            console.error('Error fetching active listings:', error);
            return [];
        }
    },

    /**
     * Create a new listing for a card.
     */
    async createListing(params: {
        cardId: string;
        cardData: Card;
        price: number;
        condition: string;
        isGraded?: boolean;
        gradingCompany?: string;
        grade?: number;
        image_front_url?: string;
        image_back_url?: string;
    }): Promise<MarketplaceListing | null> {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to create a listing');

            const { data, error } = await supabase
                .from('listings')
                .insert({
                    seller_id: user.id,
                    card_id: params.cardId,
                    card_data: params.cardData,
                    price: params.price,
                    condition: params.condition,
                    is_graded: params.isGraded || false,
                    grading_company: params.gradingCompany || null,
                    grade: params.grade || null,
                    image_front_url: params.image_front_url || null,
                    image_back_url: params.image_back_url || null,
                    status: 'active'
                })
                .select(`
                    *,
                    seller:profiles(id, display_name, avatar_url, partner_tier)
                `)
                .single();

            if (error) throw error;
            return data as MarketplaceListing;
        } catch (error) {
            console.error('Error creating listing:', error);
            throw error;
        }
    },

    /**
     * Cancel an active listing
     */
    async cancelListing(listingId: string): Promise<boolean> {
        const supabase = createClient();
        try {
            const { error } = await supabase
                .from('listings')
                .update({ status: 'cancelled' })
                .eq('id', listingId);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error cancelling listing:', error);
            return false;
        }
    }
};
