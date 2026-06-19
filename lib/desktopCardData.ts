import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import type { Card } from '@/types';
import type { MarketplaceListing } from '@/services/marketplaceService';

// Same columns marketplaceService.getListingsForCard selects, fetched with the
// server (cookie-scoped, RLS-respecting) client so the card page can render its
// content server-side for SEO instead of fetching it in the browser.
const LISTING_SELECT = `
    id, seller_id, card_id, card_data, price, condition, is_graded,
    grading_company, grade, image_front_url, image_back_url, status,
    created_at, updated_at,
    seller:profiles(id, display_name, avatar_url, partner_tier)
`;

// React cache() dedupes the query across generateMetadata + the page body
// within a single request (both call this for the same cardId).
export const getCardPageData = cache(
    async (cardId: string): Promise<{ card: Card | null; listings: MarketplaceListing[] }> => {
        const supabase = await createClient();

        const { data: rows } = await supabase
            .from('listings')
            .select(LISTING_SELECT)
            .eq('card_id', cardId)
            .eq('status', 'active')
            .order('price', { ascending: true });

        const listings = ((rows || []) as any[]).map((r) => ({
            ...r,
            card_data: normalizeCard(r.card_data, r.card_id),
        })) as MarketplaceListing[];

        // No active listing — resolve from the catalog. pokemon_cards holds every
        // game (Pokémon/MTG/Yu-Gi-Oh/One Piece), so this covers all of them.
        let card: Card | null = listings[0]?.card_data ?? null;
        if (!card) {
            const { data } = await supabase
                .from('pokemon_cards')
                .select(
                    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(market_avg, currency, last_updated)'
                )
                .eq('id', cardId)
                .maybeSingle();
            if (data) card = mapSupabaseCardToInternal(data);
        }

        return { card, listings };
    }
);
