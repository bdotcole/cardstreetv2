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

/**
 * Graders a seller can pick in the listing form, and therefore the ones the
 * marketplace grade filter offers. The DB constraint also allows SGC and ARS
 * (collection imports), but nothing is listed under them, so a chip for each
 * would only ever show an empty grid.
 */
export const LISTING_GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'TAG'] as const;

/** Grade floors the filter offers: "9+" shows 9, 9.5 and 10. */
export const MIN_GRADE_OPTIONS = [10, 9, 8, 7] as const;

export const minGradeLabel = (grade: number): string => (grade >= 10 ? '10' : `${grade}+`);

export interface GradingFilter {
    grading: 'any' | 'raw' | 'graded';
    gradingCompany: string;
    minGrade: number;
}

export const NO_GRADING_FILTER: GradingFilter = { grading: 'any', gradingCompany: '', minGrade: 0 };

export const isGradingFilterActive = (f: GradingFilter): boolean =>
    f.grading !== 'any' || !!f.gradingCompany || f.minGrade > 0;

/**
 * One chip's worth of text for an applied grading filter: "Raw", "Graded",
 * "PSA", "PSA 9+", "Graded 9+". `labels` supplies the localized words.
 */
export function gradingFilterLabel(f: GradingFilter, labels: { raw: string; graded: string }): string {
    if (f.grading === 'raw') return labels.raw;
    const head = f.gradingCompany || labels.graded;
    return f.minGrade > 0 ? `${head} ${minGradeLabel(f.minGrade)}` : head;
}
