import { createClient } from '@/lib/supabase/client';
import { Card } from '@/types';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import { sanitizeOrFilterTerm } from '@/lib/utils/postgrestFilter';
import {
    SELLER_REQUIRED_PROFILE_FIELDS,
    checkSellerProfileComplete,
    isStripeOnlyIncomplete,
    PROFILE_INCOMPLETE_TOAST,
    PROFILE_INCOMPLETE_ERROR_CODE,
} from '@/lib/profileValidation';
import { attachSellers } from '@/lib/publicProfiles';

/**
 * Thrown when a seller tries to create a listing while their profile is
 * missing required shipping fields. Callers can match on `.code` to
 * distinguish this from generic Supabase errors and surface a redirect.
 */
export class ProfileIncompleteError extends Error {
    readonly code = PROFILE_INCOMPLETE_ERROR_CODE;
    readonly missing: string[];
    constructor(missing: string[]) {
        super(PROFILE_INCOMPLETE_TOAST);
        this.name = 'ProfileIncompleteError';
        this.missing = missing;
    }
}

// Coerce a raw listing row's `card_data` JSONB into a fully-populated Card so
// downstream rendering can never crash on a null `set` / `number` / `marketPrice`.
function normalizeListing<T extends { card_id: string; card_data: any }>(row: T): T {
    return { ...row, card_data: normalizeCard(row.card_data, row.card_id) };
}

// Shape returned from profiles table join (Supabase column names, not UserProfile)
export interface SellerProfile {
    id: string;
    username?: string;
    display_name?: string;
    avatar_url?: string;
    partner_tier?: string;
    // Canonical partner signal is partner_joined_at (partner_tier defaults to
    // 'bronze' for everyone, so it can't distinguish partners).
    // `role` is legacy: populated only by own-profile/admin reads, never by the
    // public_profiles view (which omits it so admin identity isn't enumerable).
    // Cross-user reads use `is_official` for the owner-account chip instead.
    role?: string | null;
    is_official?: boolean;
    partner_joined_at?: string | null;
    rating?: number | string;
    review_count?: number | null;
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
    accepts_offers?: boolean;
    // 'draft': created before Stripe onboarding finished. Owner-only (RLS
    // hides it from everyone else) and auto-published when details_submitted
    // flips true. Never surfaces on any buyer-facing query, which all filter
    // status = 'active'.
    status: 'active' | 'sold' | 'cancelled' | 'draft';
    created_at: string;
    sold_at?: string;
    updated_at: string;
    seller?: SellerProfile;
}

export type ListingSort = 'newest' | 'price_asc' | 'price_desc' | 'best_deals';

export interface ListingFilters {
    search?: string;
    language?: string;
    game?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: ListingSort;
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
            game,
            minPrice,
            maxPrice,
            sort = 'newest',
            limit = 50,
            offset = 0,
        } = filters;

        try {
            const buildQuery = (sortKey: ListingSort) => {
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
                        accepts_offers,
                        status,
                        created_at,
                        updated_at
                    `)
                    .eq('status', 'active');

                // Server-side search inside the JSONB snapshot. Match the
                // secondary name too: a Japanese card snapshots its printed
                // Japanese name, with the English one in thaiName, so an
                // English query would otherwise miss every JA listing.
                const searchTerm = sanitizeOrFilterTerm(search ?? '');
                if (searchTerm) {
                    query = query.or(`card_data->>name.ilike.%${searchTerm}%,card_data->>thaiName.ilike.%${searchTerm}%`);
                }

                // Server-side language filter. Japanese singles snapshot as 'ja'
                // while sealed products snapshot as 'jp' (see cardMapper) — match
                // both so a Japanese filter doesn't silently drop singles.
                if (language && language !== 'all') {
                    if (language === 'ja' || language === 'jp') {
                        query = query.in('card_data->>language', ['ja', 'jp']);
                    } else {
                        query = query.eq('card_data->>language', language);
                    }
                }

                // Server-side game filter. Legacy listings predate multi-game support
                // and have no game in card_data, so treat them as Pokemon.
                if (game && game !== 'all') {
                    if (game === 'pokemon') {
                        query = query.or('card_data->>game.eq.pokemon,card_data->>game.is.null');
                    } else {
                        query = query.eq('card_data->>game', game);
                    }
                }

                // Server-side price range
                if (minPrice !== undefined && minPrice > 0) {
                    query = query.gte('price', minPrice);
                }
                if (maxPrice !== undefined && maxPrice < 100000) {
                    query = query.lte('price', maxPrice);
                }

                // Server-side sort
                switch (sortKey) {
                    case 'price_asc':
                        query = query.order('price', { ascending: true });
                        break;
                    case 'price_desc':
                        query = query.order('price', { ascending: false });
                        break;
                    case 'best_deals':
                        // deal_ratio = price / market snapshot (generated column,
                        // 20260702_listing_deal_ratio.sql). Lowest ratio = deepest
                        // discount; listings with no market price sort last.
                        query = query
                            .order('deal_ratio', { ascending: true, nullsFirst: false })
                            .order('created_at', { ascending: false });
                        break;
                    default:
                        query = query.order('created_at', { ascending: false });
                }

                // Pagination
                return query.range(offset, offset + limit - 1);
            };

            let { data, error } = await buildQuery(sort);
            // If the deal_ratio migration hasn't been applied yet, degrade to
            // newest-first instead of an empty marketplace.
            if (error && sort === 'best_deals') {
                console.warn('best_deals sort unavailable, falling back to newest:', error.message);
                ({ data, error } = await buildQuery('newest'));
            }
            if (error) throw error;
            const listings = ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
            return attachSellers(supabase, listings);
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
        acceptsOffers?: boolean;
    }): Promise<MarketplaceListing | null> {
        const supabase = createClient();

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to create a listing');

            // Block listing creation if the seller's profile is missing the
            // shipping fields Flash Express needs. Without this, fulfillment
            // falls back to Bangkok placeholders and Flash rejects the
            // shipment as a region mismatch. The UI also pre-checks at
            // click-time, but this is the real write path and the last line
            // of defense.
            const { data: sellerProfile, error: profileErr } = await supabase
                .from('profiles')
                .select(SELLER_REQUIRED_PROFILE_FIELDS.join(','))
                .eq('id', user.id)
                .single<Record<string, string | boolean | null>>();
            if (profileErr) throw profileErr;
            const completeness = checkSellerProfileComplete(sellerProfile);
            // Draft-first: shipping fields stay a hard block (Flash needs
            // them), but a seller who is ONLY missing Stripe onboarding may
            // save the listing as a draft — it auto-publishes when
            // details_submitted flips true (connect status refresh + the
            // account.updated webhook both flip drafts).
            let asDraft = false;
            if (!completeness.complete) {
                if (!isStripeOnlyIncomplete(completeness.missing)) {
                    throw new ProfileIncompleteError(completeness.missing);
                }
                asDraft = true;
            }

            // Normalize on write so card_data can never be stored with null
            // required fields, even if the caller passed a partial Card.
            const safeCard = normalizeCard(params.cardData, params.cardId);

            const { data, error } = await supabase
                .from('listings')
                .insert({
                    seller_id: user.id,
                    card_id: params.cardId,
                    card_data: safeCard,
                    price: params.price,
                    condition: params.condition,
                    is_graded: params.isGraded || false,
                    grading_company: params.gradingCompany || null,
                    grade: params.grade || null,
                    image_front_url: params.image_front_url || null,
                    image_back_url: params.image_back_url || null,
                    accepts_offers: params.acceptsOffers ?? false,
                    status: asDraft ? 'draft' : 'active'
                })
                .select()
                .single();

            if (error) {
                // Pre-migration fail-soft: until 20260730_draft_listings.sql
                // widens the status CHECK, a 'draft' insert violates it
                // (23514). Degrade to the old hard block so the seller gets
                // the familiar "finish Stripe first" path, not a raw error.
                if (
                    asDraft &&
                    (error.code === '23514' || /listings_status_check/i.test(error.message || ''))
                ) {
                    throw new ProfileIncompleteError(completeness.missing);
                }
                throw error;
            }

            // Wake the wishlist-alert fan-out (Pro perk). This insert runs in
            // the browser, so alerting needs a server round-trip -- strictly
            // fire-and-forget: a failed alert must never fail the listing.
            // Drafts skip it: wishlisters are alerted at publish time instead
            // (see the auto-publish hooks), never about an unbuyable listing.
            if (!asDraft && data?.id && typeof fetch !== 'undefined') {
                void fetch('/api/alerts/listing-created', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ listingId: data.id }),
                }).catch(() => { /* best-effort */ });
            }

            const [withSeller] = await attachSellers(supabase, [normalizeListing(data as MarketplaceListing)]);
            return withSeller;
        } catch (error) {
            console.error('Error creating listing:', error);
            throw error;
        }
    },

    /**
     * Fetch all active listings for one card, cheapest first. Used by the
     * desktop card detail page.
     */
    async getListingsForCard(cardId: string): Promise<MarketplaceListing[]> {
        const supabase = createClient();
        try {
            const { data, error } = await supabase
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
                    accepts_offers,
                    status,
                    created_at,
                    updated_at
                `)
                .eq('card_id', cardId)
                .eq('status', 'active')
                .order('price', { ascending: true });
            if (error) throw error;
            const listings = ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
            return attachSellers(supabase, listings);
        } catch (error) {
            console.error('Error fetching listings for card:', error);
            return [];
        }
    },

    /**
     * Lightweight active-listing rows for a batch of catalog card ids. Powers
     * the Explore grid's "Buy from ฿…" overlay: the grid used to key off the
     * 50 newest listings sitewide, so any listing older than that window
     * silently lost its buy button even while still active. Chunked so each
     * PostgREST `in` filter stays well under URL-length limits.
     */
    async getActiveListingsForCards(cardIds: string[]): Promise<Array<{ id: string; card_id: string; price: number }>> {
        if (cardIds.length === 0) return [];
        const supabase = createClient();
        const CHUNK = 150;
        const chunks: string[][] = [];
        for (let i = 0; i < cardIds.length; i += CHUNK) chunks.push(cardIds.slice(i, i + CHUNK));
        try {
            const results = await Promise.all(chunks.map(chunk =>
                supabase
                    .from('listings')
                    .select('id, card_id, price')
                    .eq('status', 'active')
                    .in('card_id', chunk)
            ));
            const rows: Array<{ id: string; card_id: string; price: number }> = [];
            for (const r of results) {
                if (r.error) throw r.error;
                rows.push(...((r.data || []) as Array<{ id: string; card_id: string; price: number }>));
            }
            return rows;
        } catch (error) {
            console.error('Error fetching listings for cards:', error);
            return [];
        }
    },

    /**
     * Fetch one seller's active listings, newest first. Used by the mobile
     * seller profile's Shop tab (the desktop shop page has its own
     * server-side query in lib/sellerPageData.ts).
     */
    async getSellerListings(sellerId: string, limit = 100): Promise<MarketplaceListing[]> {
        const supabase = createClient();
        try {
            const { data, error } = await supabase
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
                    accepts_offers,
                    status,
                    created_at,
                    updated_at
                `)
                .eq('seller_id', sellerId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            const listings = ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
            return attachSellers(supabase, listings);
        } catch (error) {
            console.error('Error fetching seller listings:', error);
            return [];
        }
    },

    /**
     * Fetch the signed-in user's own active listings, newest first. Used by
     * the desktop Sell page.
     */
    async getMyListings(): Promise<MarketplaceListing[]> {
        const supabase = createClient();
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];

            const { data, error } = await supabase
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
                    updated_at
                `)
                .eq('seller_id', user.id)
                // Drafts are the seller's own pre-Stripe listings — they
                // belong on the "my listings" surface (with a Draft badge),
                // else the seller re-lists the card and duplicates it.
                .in('status', ['active', 'draft'])
                .order('created_at', { ascending: false });
            if (error) throw error;
            const listings = ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
            return attachSellers(supabase, listings);
        } catch (error) {
            console.error('Error fetching my listings:', error);
            return [];
        }
    },

    /**
     * Update the asking price of an active listing. Returns false when the
     * listing is no longer active (sold/cancelled while the seller was
     * editing), so callers can reconcile stale UI instead of silently
     * "succeeding" on zero rows.
     */
    async updateListingPrice(listingId: string, price: number): Promise<boolean> {
        // Mirror the bounds enforced by /api/listings' zod schema.
        if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) {
            throw new Error('Invalid listing price');
        }
        const supabase = createClient();
        try {
            const { data, error } = await supabase
                .from('listings')
                .update({ price })
                .eq('id', listingId)
                // Drafts are price-editable too — only sold/cancelled rows
                // report false so callers reconcile stale UI.
                .in('status', ['active', 'draft'])
                .select('id');

            if (error) throw error;
            return (data?.length ?? 0) > 0;
        } catch (error) {
            console.error('Error updating listing price:', error);
            throw error;
        }
    },

    /**
     * Update the price of the signed-in user's active listing for a given
     * card. Same id-less matching as cancelListingForCard: the mobile Vault
     * only knows card_id (+ condition), not the listing id.
     */
    async updateListingPriceForCard(cardId: string, condition: string | undefined, price: number): Promise<boolean> {
        const supabase = createClient();
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to update a listing');

            const { data: listings, error: fetchError } = await supabase
                .from('listings')
                .select('id, condition')
                .eq('seller_id', user.id)
                .eq('card_id', cardId)
                .in('status', ['active', 'draft']);

            if (fetchError) throw fetchError;
            if (!listings || listings.length === 0) return false;

            const target = listings.find(l => l.condition === condition) || listings[0];
            return await this.updateListingPrice(target.id, price);
        } catch (error) {
            console.error('Error updating listing price for card:', error);
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
    },

    /**
     * Cancel the signed-in user's active listing for a given card.
     *
     * The mobile Vault doesn't track the underlying listing id — it derives
     * the "Live on Market" flag by matching collection items to active
     * listings on card_id (+ condition), exactly as `useUserCollections`
     * does on load. So removal matches the same way: prefer an exact
     * condition match, otherwise cancel the first active listing for the card.
     * Returns false when no active listing is found (already removed/sold).
     */
    async cancelListingForCard(cardId: string, condition?: string): Promise<boolean> {
        const supabase = createClient();
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Must be signed in to remove a listing');

            const { data: listings, error: fetchError } = await supabase
                .from('listings')
                .select('id, condition')
                .eq('seller_id', user.id)
                .eq('card_id', cardId)
                .in('status', ['active', 'draft']);

            if (fetchError) throw fetchError;
            if (!listings || listings.length === 0) return false;

            const target = listings.find(l => l.condition === condition) || listings[0];

            const { error } = await supabase
                .from('listings')
                .update({ status: 'cancelled' })
                .eq('id', target.id);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error cancelling listing for card:', error);
            throw error;
        }
    }
};
