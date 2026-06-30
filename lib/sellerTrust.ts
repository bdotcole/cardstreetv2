// Single source of truth for the seller "trust chip" shown next to a seller's
// name on listings. There is no reviews table yet, so a seller's rating is only
// ever shown for the owner (a deliberate flagship display) or, once reviews
// exist, for sellers with at least one review. Everyone else is a "New Seller".
//
// Precedence (owner wins over partner so the owner keeps its rating display):
//   1. owner   — profiles.role === 'admin'                       → rating (★)
//   2. partner — partner_joined_at set OR role === 'partner'      → "Official Partner"
//   3. rated   — has real reviews (reviewCount > 0)               → rating (★)
//   4. new     — no reviews yet                                   → "New Seller"
//
// partner_joined_at is the canonical partner signal the checkout fee logic keys
// off (partner_tier defaults to 'bronze' for every account, so it can't
// distinguish partners). We also accept role === 'partner' as a fallback because
// the seed/QC scripts flag partners that way without stamping partner_joined_at —
// a partner must never be shown as a "New Seller".

export type SellerTrust =
    | { kind: 'owner'; rating: number }
    | { kind: 'partner' }
    | { kind: 'rated'; rating: number }
    | { kind: 'new' };

export interface SellerTrustInput {
    role?: string | null;
    partner_joined_at?: string | null;
    rating?: number | string | null;
    // DB column is review_count (snake_case); reviewCount is accepted too for the
    // mapped UserProfile shape.
    review_count?: number | null;
    reviewCount?: number | null;
}

// Owner gets a fixed flagship rating since there is no review data to derive one.
const OWNER_RATING = 5.0;

export function getSellerTrust(seller?: SellerTrustInput | null): SellerTrust {
    if (!seller) return { kind: 'new' };

    const rating =
        typeof seller.rating === 'string' ? parseFloat(seller.rating) : seller.rating ?? 0;
    const count = seller.review_count ?? seller.reviewCount ?? 0;
    const hasRealRating = count > 0 && rating > 0;

    // Owner: show their real rating once reviews exist, else the flagship 5.0 so
    // the marketplace's own storefront never reads as a "New Seller".
    if (seller.role === 'admin') {
        return { kind: 'owner', rating: hasRealRating ? rating : OWNER_RATING };
    }

    if (seller.partner_joined_at || seller.role === 'partner') return { kind: 'partner' };

    if (hasRealRating) return { kind: 'rated', rating };

    return { kind: 'new' };
}
