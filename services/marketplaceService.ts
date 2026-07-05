import { createClient } from '@/lib/supabase/client';
import { Card } from '@/types';
import { normalizeCard } from '@/lib/utils/normalizeCard';
import {
    SELLER_REQUIRED_PROFILE_FIELDS,
    checkSellerProfileComplete,
    PROFILE_INCOMPLETE_TOAST,
    PROFILE_INCOMPLETE_ERROR_CODE,
} from '@/lib/profileValidation';

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
    // 'bronze' for everyone, so it can't distinguish partners). role === 'admin'
    // marks the owner account, which keeps its rating display.
    role?: string | null;
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
    status: 'active' | 'sold' | 'cancelled';
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
                        status,
                        created_at,
                        updated_at,
                        seller:profiles(id, username, display_name, avatar_url, partner_tier, role, partner_joined_at, rating, review_count)
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
            return ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
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
            if (!completeness.complete) {
                throw new ProfileIncompleteError(completeness.missing);
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
                    status: 'active'
                })
                .select(`
                    *,
                    seller:profiles(id, username, display_name, avatar_url, partner_tier, role, partner_joined_at, rating, review_count)
                `)
                .single();

            if (error) throw error;

            // Wake the wishlist-alert fan-out (Pro perk). This insert runs in
            // the browser, so alerting needs a server round-trip -- strictly
            // fire-and-forget: a failed alert must never fail the listing.
            if (data?.id && typeof fetch !== 'undefined') {
                void fetch('/api/alerts/listing-created', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ listingId: data.id }),
                }).catch(() => { /* best-effort */ });
            }

            return normalizeListing(data as MarketplaceListing);
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
                    status,
                    created_at,
                    updated_at,
                    seller:profiles(id, username, display_name, avatar_url, partner_tier, role, partner_joined_at, rating, review_count)
                `)
                .eq('card_id', cardId)
                .eq('status', 'active')
                .order('price', { ascending: true });
            if (error) throw error;
            return ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
        } catch (error) {
            console.error('Error fetching listings for card:', error);
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
                    status,
                    created_at,
                    updated_at,
                    seller:profiles(id, username, display_name, avatar_url, partner_tier, role, partner_joined_at, rating, review_count)
                `)
                .eq('seller_id', sellerId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(limit);
            if (error) throw error;
            return ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
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
                .eq('status', 'active')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return ((data || []) as unknown as MarketplaceListing[]).map(normalizeListing);
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
                .eq('status', 'active')
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
                .eq('status', 'active');

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
                .eq('status', 'active');

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
