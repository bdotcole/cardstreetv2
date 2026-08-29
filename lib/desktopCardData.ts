import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import { mapSealedRowToProduct, sealedProductToCard, SealedProductRow } from '@/lib/sealedProduct';
import { attachSellers } from '@/lib/publicProfiles';
import type { Card, SiblingCard } from '@/types';
import type { MarketplaceListing } from '@/services/marketplaceService';

// Same columns marketplaceService.getListingsForCard selects, fetched with the
// server (cookie-scoped, RLS-respecting) client so the card page can render its
// content server-side for SEO instead of fetching it in the browser.
const LISTING_SELECT = `
    id, seller_id, card_id, card_data, price, condition, is_graded,
    grading_company, grade, image_front_url, image_back_url, accepts_offers, status,
    created_at, updated_at
`;

// Catalog columns the card mapper needs to derive the live market price +
// freshness (and the breadcrumb set_id). Mirrors the client fetch in
// DesktopCardDetail and marketplaceService's catalog fallback.
const CATALOG_SELECT =
    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, market_avg, currency, last_updated)';

/** Tiles rendered in the "more from this set" block. */
const SIBLING_COUNT = 12;
/**
 * Fetched before ranking, since the ranking key can't be pushed into the query.
 *
 * Sized off the worst real set rather than the typical one. Most sets are one
 * row per card, so 40 candidates would be plenty — but Yu-Gi-Oh "Rarity
 * Collection" sets carry ~6 rarity rows per print, and `ygo-rc04-jp` yields
 * only 7 distinct cards in its first 40 rows (14 in its first 80). At 40 the
 * block rendered 7 tiles there instead of 12.
 */
const SIBLING_CANDIDATES = 80;

/**
 * Sibling cards from the same set, for the card page's "more from this set"
 * block.
 *
 * This is the card page's only lateral link surface. Without it every /card/*
 * page is a leaf with exactly one outlink (its breadcrumb) and ~430 characters
 * of unique body text, which is what Google is reading as a soft 404 across
 * 1,106 pages and climbing (GSC, 2026-08-11).
 *
 * Ranks by market price in JS rather than in the query: PostgREST cannot ORDER
 * BY a column on an embedded relation (market_values), and ordering by `number`
 * sorts as text — #1, #10, #100 — so a query-side sort would surface the same
 * dull head of every set.
 *
 * KNOWN LIMITATION, accepted for now: the price ranking applies to the first
 * SIBLING_CANDIDATES rows by id, not to the whole set, so on a 256-card set
 * this is "the best of a stable 40-card window", not the set's true top 12.
 * Every card in a set therefore shows the same 12 siblings, which concentrates
 * inlinks on those 12 rather than spreading them across the set. Fixing that
 * properly means a per-card neighbourhood window (the N cards either side by
 * collector number), which needs a numeric sort key the catalog does not have.
 * The current shape already does the job it shipped for: every card page gains
 * twelve outlinks and a few hundred characters of card-specific text.
 */
export const getSetSiblings = cache(
    async (setId: string | null, excludeId: string): Promise<SiblingCard[]> => {
        if (!setId) return [];

        const supabase = await createClient();
        const { data } = await supabase
            .from('pokemon_cards')
            // Explicit columns (never select('*') — raw_data is tens of KB per
            // row) and .eq, not .ilike, so the b-tree index on set_id is used.
            .select(CATALOG_SELECT)
            .eq('set_id', setId)
            .neq('id', excludeId)
            // Explicit order so the window is deterministic — without it the
            // block can differ between two renders of the same page.
            .order('id', { ascending: true })
            .limit(SIBLING_CANDIDATES);

        const seen = new Set<string>();
        // Sets carry one row per rarity of the same print, so a naive slice can
        // render the same card name three times in a row.
        const dedupe = (card: Card) => {
            const key = `${card.name}|${card.number ?? ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        };
        const toTile = (card: Card, fromOtherSet: boolean): SiblingCard => ({
            id: card.id,
            name: card.name,
            number: card.number ?? null,
            rarity: card.rarity ?? null,
            // Thumbnails always use image_small; image_large in a grid was
            // the single biggest cause of slow set loads (see CLAUDE.md).
            imageSmall: card.images?.small ?? null,
            marketPrice: card.marketPrice || null,
            ...(fromOtherSet ? { fromOtherSet: true } : {}),
        });

        const sameSet = (data || [])
            .map((row) => mapSupabaseCardToInternal(row))
            .filter(dedupe)
            .sort((a, b) => (b.marketPrice || 0) - (a.marketPrice || 0))
            .slice(0, SIBLING_COUNT)
            .map((card) => toTile(card, false));

        if (sameSet.length >= SIBLING_COUNT) return sameSet;

        // 256 sets in the catalog hold six cards or fewer, and a set of one
        // yields nothing at all — which drops the page back to ~700 characters
        // of body text and a single outlink, exactly the shape GSC files as a
        // Soft 404 (1,272 pages and climbing as of 2026-08-28). Top the block up
        // from the same game so every card page keeps its tiles whatever set it
        // is in. Only runs on the short path, so the common case pays nothing.
        const { data: own } = await supabase
            .from('pokemon_cards')
            .select('game, language')
            .eq('id', excludeId)
            .maybeSingle();
        const game = (own as { game?: string | null } | null)?.game;
        if (!game) return sameSet;
        // Match language too: a Thai card's block filling with Japanese prints
        // would be lateral links to pages the reader cannot use.
        const language = (own as { language?: string | null } | null)?.language ?? null;

        // Windowed by id RELATIVE TO THIS CARD rather than from the top of the
        // game, so two cards in different tiny sets do not receive an identical
        // block — a fill that was the same everywhere would be templated text,
        // which is the problem this is meant to solve. Cards within one tiny set
        // still share a fill, matching the same-set behaviour documented above.
        // `gt`/`lt` on the primary key stays an index range scan; OFFSET would not.
        const fillQuery = (dir: 'after' | 'before') => {
            let qb = supabase
                .from('pokemon_cards')
                .select(CATALOG_SELECT)
                .eq('game', game)
                .neq('set_id', setId)
                .not('image_small', 'is', null);
            if (language) qb = qb.eq('language', language);
            return dir === 'after'
                ? qb.gt('id', excludeId).order('id', { ascending: true }).limit(SIBLING_CANDIDATES)
                : qb.lt('id', excludeId).order('id', { ascending: false }).limit(SIBLING_CANDIDATES);
        };

        const { data: after } = await fillQuery('after');
        let candidates = after || [];
        // Wrap when the card sits near the end of its game's id range, or the
        // last cards in every game would get a short block for a second reason.
        if (candidates.length < SIBLING_CANDIDATES) {
            const { data: before } = await fillQuery('before');
            candidates = candidates.concat(before || []);
        }

        const fill = candidates
            .map((row) => mapSupabaseCardToInternal(row))
            .filter(dedupe)
            .sort((a, b) => (b.marketPrice || 0) - (a.marketPrice || 0))
            .slice(0, SIBLING_COUNT - sameSet.length)
            .map((card) => toTile(card, true));

        return sameSet.concat(fill);
    }
);

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

        const listings = await attachSellers(supabase, ((rows || []) as any[]).map((r) => ({
            ...r,
            card_data: normalizeCard(r.card_data, r.card_id),
        })) as MarketplaceListing[]);

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
