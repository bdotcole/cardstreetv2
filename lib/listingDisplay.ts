import type { MarketplaceListing } from '@/services/marketplaceService';

// Discounts smaller than this read as noise, not a deal — no badge.
export const DEAL_BADGE_MIN_PCT = 5;

/**
 * Percent a listing is priced below its market snapshot, or null when the
 * discount is too small to badge or there's no usable market price. Both
 * inputs are THB (listing.price and card_data.marketPrice share currency),
 * so the ratio is display-currency independent.
 */
export function getDealPercent(price: number, marketPrice?: number | null): number | null {
    if (!marketPrice || !Number.isFinite(marketPrice) || marketPrice <= 0) return null;
    if (!Number.isFinite(price) || price <= 0) return null;
    const pct = Math.round((1 - price / marketPrice) * 100);
    return pct >= DEAL_BADGE_MIN_PCT ? pct : null;
}

const CONDITION_ABBR: Record<string, string> = {
    'Mint': 'M',
    'Near Mint': 'NM',
    'Lightly Played': 'LP',
    'Moderately Played': 'MP',
    'Heavily Played': 'HP',
    'Damaged': 'DMG',
};

type BadgeSource = Pick<MarketplaceListing, 'condition' | 'is_graded' | 'grading_company' | 'grade'>;

/** "PSA 9" for graded listings, otherwise the abbreviated condition ("NM"). */
export function conditionBadgeLabel(listing: BadgeSource): string {
    if (listing.is_graded && listing.grading_company) {
        return `${listing.grading_company} ${listing.grade ?? ''}`.trim();
    }
    return CONDITION_ABBR[listing.condition] ?? listing.condition;
}

/** Graded and near-pristine raw conditions get the green treatment. */
export function isTopCondition(listing: BadgeSource): boolean {
    if (listing.is_graded) return true;
    return listing.condition === 'Mint' || listing.condition === 'Near Mint';
}
