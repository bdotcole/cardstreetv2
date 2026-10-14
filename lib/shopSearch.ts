// Shop search by seller name (GET /api/search/shops). Pure module: the route
// imports the result type, the search surfaces import the fetcher through
// lib/hooks/useShopSearch.ts.

export interface ShopSearchResult {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
    rating: number | null;
    review_count: number;
    is_verified_shop: boolean;
    partner_joined_at: string | null;
    listing_count: number;
    /** Has listings, but the shop is on vacation so none are showing. */
    paused: boolean;
}

/** Shorter than the card search's three: Thai and nickname shop names are often two. */
export const SHOP_SEARCH_MIN_CHARS = 2;

/** Fail-soft: any error is "no shops", so the card results still render. */
export async function searchShops(q: string, signal?: AbortSignal): Promise<ShopSearchResult[]> {
    const term = q.trim();
    if (term.length < SHOP_SEARCH_MIN_CHARS) return [];
    try {
        const res = await fetch(`/api/search/shops?q=${encodeURIComponent(term)}`, { signal });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.shops) ? (data.shops as ShopSearchResult[]) : [];
    } catch {
        return [];
    }
}
