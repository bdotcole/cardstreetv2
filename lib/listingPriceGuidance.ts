/**
 * "Is this a sane asking price?" — one answer, shared by the listing form, the
 * one-tap sell sheet, and the stale-listing cron.
 *
 * The audit measured 146 of 222 active listings priced above their own market
 * snapshot, on a marketplace with 9 buyers ever. Nothing in the listing form
 * ever said so: it offered a recommendation and then accepted any number in
 * silence. This module is the missing feedback.
 *
 * TWO THINGS IT REFUSES TO DO, both load-bearing:
 *
 * 1. It hides itself when the market value is the 10-baht placeholder.
 *    supabase/functions/daily-market-update writes Math.max(price, 10), so
 *    3,803 Thai rows (52% of them) carry a 10 that is not a price. Telling a
 *    seller their 400-baht card is "3,900% above market" against that number
 *    would be worse than saying nothing — it would be confidently wrong, and
 *    it would push a correct price down.
 *
 * 2. It never recommends below the 20-baht public floor. A recommendation the
 *    listing form would then reject is a bug the seller has to diagnose.
 *
 * Pure module: no react, no supabase, no next/*. The cron imports it too.
 */

import { PUBLIC_MIN_LISTING_PRICE_THB } from '@/lib/pricingFloors';

/**
 * The placeholder daily-market-update writes when it has nothing real. Kept as
 * its own constant rather than reusing the listing floor: they are 10 and 20
 * for unrelated reasons and coupling them would be an accident waiting to
 * happen.
 */
export const MARKET_PLACEHOLDER_THB = 10;

/** Above this, the price is flagged amber. */
export const OVER_MARKET_WARN_RATIO = 1.1;
/** Above this, publishing takes a second, deliberate tap. */
export const OVER_MARKET_CONFIRM_RATIO = 1.5;

export type PriceVerdict = 'under' | 'fair' | 'high' | 'very_high';

export interface PriceGuidance {
    /** price / market. Undefined when there is no usable market value. */
    ratio?: number;
    /** Signed percentage away from market, rounded. +18 = 18% above. */
    percentFromMarket?: number;
    verdict: PriceVerdict;
    /** True once the seller should see amber. */
    warn: boolean;
    /** True once publishing should require a second tap. */
    requiresConfirm: boolean;
    /** Cheapest active listing for the same card, when one exists. */
    lowestActive?: number;
}

/**
 * Is this market value real enough to compare against?
 *
 * Anything at or below the placeholder is not. So is a missing or non-finite
 * value. Deliberately `<=` and not `===`: a future floor change, or a currency
 * conversion landing at 9.97, must not slip a placeholder through.
 */
export function isUsableMarketValue(market: number | null | undefined): market is number {
    return typeof market === 'number' && Number.isFinite(market) && market > MARKET_PLACEHOLDER_THB;
}

/**
 * A recommendation the listing form will actually accept: never below the
 * public floor, always a whole baht. Returns 0 when there is nothing to
 * recommend, which callers read as "show no recommendation".
 */
export function clampRecommendation(raw: number | null | undefined): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
    return Math.max(PUBLIC_MIN_LISTING_PRICE_THB, Math.round(raw));
}

export function evaluatePrice(
    price: number | null | undefined,
    market: number | null | undefined,
    lowestActive?: number | null,
): PriceGuidance {
    const base: PriceGuidance = {
        verdict: 'fair',
        warn: false,
        requiresConfirm: false,
        ...(typeof lowestActive === 'number' && Number.isFinite(lowestActive) && lowestActive > 0
            ? { lowestActive }
            : {}),
    };

    if (!isUsableMarketValue(market)) return base;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return base;

    const ratio = price / market;
    const percentFromMarket = Math.round((ratio - 1) * 100);

    let verdict: PriceVerdict = 'fair';
    if (ratio > OVER_MARKET_CONFIRM_RATIO) verdict = 'very_high';
    else if (ratio > OVER_MARKET_WARN_RATIO) verdict = 'high';
    // A 10% band below market reads as "fair" too — underpricing is the
    // seller's own call and is good for the buyer; only call it out further down.
    else if (ratio < 0.9) verdict = 'under';

    return {
        ...base,
        ratio,
        percentFromMarket,
        verdict,
        warn: verdict === 'high' || verdict === 'very_high',
        requiresConfirm: verdict === 'very_high',
    };
}

/**
 * The "Sell for ~฿X" figure shown on the card detail bar and the post-scan
 * sheet. Returns 0 when the catalog has no usable market value, which every
 * caller reads as "show nothing" — a sell prompt built on the 10-baht
 * placeholder would invite someone to list a real card for 20 baht.
 *
 * Near-mint raw is the assumption, matching calculateRecommendedPrice's 1.0
 * multiplier. The listing form re-derives from the condition the seller
 * actually picks, so this is a headline, not a commitment.
 */
export function suggestedSellPrice(market: number | null | undefined): number {
    if (!isUsableMarketValue(market)) return 0;
    return clampRecommendation(market);
}

/**
 * The reprice target offered to a stale listing: market, floored at the public
 * minimum. Returns 0 when the market value is unusable, so the cron skips the
 * listing rather than proposing a number derived from a placeholder.
 */
export function repriceTarget(market: number | null | undefined): number {
    if (!isUsableMarketValue(market)) return 0;
    return clampRecommendation(market);
}
