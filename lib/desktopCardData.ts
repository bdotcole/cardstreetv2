import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import { mapSealedRowToProduct, sealedProductToCard, SealedProductRow } from '@/lib/sealedProduct';
import type { Card } from '@/types';
import type { MarketplaceListing } from '@/services/marketplaceService';

// Same columns marketplaceService.getListingsForCard selects, fetched with the
// server (cookie-scoped, RLS-respecting) client so the card page can render its
// content server-side for SEO instead of fetching it in the browser.
const LISTING_SELECT = `
    id, seller_id, card_id, card_data, price, condition, is_graded,
    grading_company, grade, image_front_url, image_back_url, accepts_offers, status,
    created_at, updated_at,
    seller:profiles(id, username, display_name, avatar_url, partner_tier, role, partner_joined_at, rating, review_count)
`;

// Catalog columns the card mapper needs to derive the live market price +
// freshness (and the breadcrumb set_id). Mirrors the client fetch in
// DesktopCardDetail and marketplaceService's catalog fallback.
const CATALOG_SELECT =
    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, market_avg, currency, last_updated)';

// React cache() dedupes the query across generateMetadata + the page body
// within a single request (both call this for the same cardId).
export const getCardPageData = cache(
    async (cardId: string): Promise<{ card: Card | null; listings: MarketplaceListing[]; setId: string | null }> => {
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

        // The card resolves from (in order) the cheapest active listing's frozen
        // card_data snapshot, then the live catalog, then the sealed catalog.
        // pokemon_cards holds every game (Pokémon/MTG/Yu-Gi-Oh/One Piece).
        let card: Card | null = listings[0]?.card_data ?? null;
        const cardFromListing = !!card;
        let setId: string | null = null;

        if (!card) {
            const { data } = await supabase
                .from('pokemon_cards')
                .select(CATALOG_SELECT)
                .eq('id', cardId)
                .maybeSingle();
            if (data) {
                card = mapSupabaseCardToInternal(data);
                setId = (data as { set_id?: string | null }).set_id ?? null;
            }
        }

        // Still nothing — sealed products live in their own catalog table, so a
        // sealed listing's /card/<id> page keeps resolving after it sells out.
        if (!card) {
            const { data: sealedRow } = await supabase
                .from('sealed_products')
                .select('id, game, language, set_id, name, product_type, image_url, pricecharting_id, loose_price, cib_price, new_price, currency, last_updated')
                .eq('id', cardId)
                .maybeSingle();
            if (sealedRow) {
                // set_id is not a FK, so the set name needs its own lookup.
                let setName: string | null = null;
                if (sealedRow.set_id) {
                    const { data: setRow } = await supabase
                        .from('pokemon_sets')
                        .select('name')
                        .eq('id', sealedRow.set_id)
                        .maybeSingle();
                    setName = setRow?.name ?? null;
                }
                card = sealedProductToCard(mapSealedRowToProduct(sealedRow as SealedProductRow, setName));
            }
        }

        // A card rendered from a listing carries that listing's FROZEN card_data,
        // whose market price + "updated" freshness are snapshot-stale. Pull the
        // live catalog row once to (a) get the breadcrumb set_id and (b) overlay
        // the current market price + freshness. Listing prices/conditions stay
        // as-is. Cards not in pokemon_cards (sealed) have no row, so they keep
        // their snapshot values and setId stays null.
        if (card && cardFromListing) {
            const { data: ref } = await supabase
                .from('pokemon_cards')
                .select(CATALOG_SELECT)
                .eq('id', cardId)
                .maybeSingle();
            if (ref) {
                setId = (ref as { set_id?: string | null }).set_id ?? null;
                const live = mapSupabaseCardToInternal(ref);
                card = { ...card, marketPrice: live.marketPrice, prices: live.prices };
            }
        }

        return { card, listings, setId };
    }
);
