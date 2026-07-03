import { createClient } from '@/lib/supabase/client';
import { Card, pickDisplayMarketValue } from '@/services/pokemonService';

export interface CollectionItem {
    id: string;
    card_id: string;
    user_id: string;
    quantity: number;
    grade?: string;
    purchase_price?: number;
    added_at: string;
    card?: Card; // Joined data
}

export const collectionService = {
    async getUserCollection(userId: string): Promise<CollectionItem[]> {
        const supabase = createClient();

        try {
            const { data, error } = await supabase
                .from('user_collections')
                .select(`
                    *,
                    card:pokemon_cards!inner (
                        *,
                        market_values(condition, market_avg, currency, last_updated)
                    )
                `)
                .eq('user_id', userId)
                .order('added_at', { ascending: false });

            if (error) {
                console.error('Error fetching collection:', error);
                return [];
            }

            // Transform to app format
            return (data || []).map(item => ({
                ...item,
                card: item.card ? this.mapSupabaseCardToInternal(item.card) : undefined
            }));

        } catch (e) {
            console.error('Collection fetch failed:', e);
            return [];
        }
    },

    // Duplicate logic from pokemonService to avoid circular dependency if needed, 
    // or better, export helper from pokemonService. For now, simplified mapping.
    mapSupabaseCardToInternal(supabaseCard: any): any {
        // Simplified mapping for now, ideally import from pokemonService but we need to check if it exports the mapper
        // It seems pokemonService has mapSupabaseCardToInternal but it is a method on the object.
        // For speed, I'll just map the essentials or user pokemonService's public cards if possible.
        // Actually, let's just return the raw card for now and let the UI handle it, or standard mapping.

        // Basic mapping for list display
        return {
            id: supabaseCard.id,
            name: supabaseCard.name,
            set: supabaseCard.set_id, // raw
            imageUrl: supabaseCard.image_small || supabaseCard.image_large || 'https://images.pokemontcg.io/placeholder.png',
            rarity: supabaseCard.rarity,
            marketPrice: pickDisplayMarketValue(supabaseCard.market_values)?.market_avg || 0
        };
    }
};
