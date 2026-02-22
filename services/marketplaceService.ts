import { createClient } from '@/lib/supabase/client';
import { Card, UserProfile } from '@/types';

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
    status: 'active' | 'sold' | 'cancelled';
    created_at: string;
    sold_at?: string;
    updated_at: string;
    seller?: UserProfile;
}

export const marketplaceService = {
    /**
     * Fetch all active listings from the marketplace, joining with seller profiles.
     */
    async getActiveListings(): Promise<MarketplaceListing[]> {
        const supabase = createClient();

        try {
            // Note: In Supabase, joining foreign key tables uses the syntax:
            // select('*, seller:profiles!seller_id(*)')
            // Or if foreign key is correctly inferred: select('*, seller:seller_id(*)')
            // Let's use standard table join syntax based on the schema
            const { data, error } = await supabase
                .from('listings')
                .select(`
                    *,
                    seller:profiles(*)
                `)
                .eq('status', 'active')
                .order('created_at', { ascending: false });

            if (error) throw error;

            return (data || []) as MarketplaceListing[];
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
                    status: 'active'
                })
                .select(`
                    *,
                    seller:profiles(*)
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
