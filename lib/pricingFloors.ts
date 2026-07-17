/**
 * Listing price floors, and the test for whether a realized sale may teach market value.
 *
 * Admins list below the public floor to seed the marketplace (a 1-baht test listing).
 * Such a sale is NOT a market signal: no ordinary seller can list that low, so the
 * price says nothing about what the card is worth. Left unfiltered it is actively
 * harmful — Thai keys switch to internal pricing on the FIRST sale, and the
 * clobber-guard trigger then protects that price from every API writer, so one 1-baht
 * seed sale would pin a card at ~$0.03 permanently.
 *
 * Isomorphic on purpose (no server imports): the listing form gates the input on it
 * and the fulfillment path records against it.
 *
 * MIRRORED, because neither can import TypeScript:
 *   - supabase/migrations/20260717_exclude_below_floor_sales_from_market_value.sql
 *     (market_value_sale_floor_thb(), the authority — every internal recompute filters
 *      on it, so the rule holds for sales recorded by any version of this code)
 *   - supabase/functions/daily-market-update/index.ts (the legacy Thai sold-listings
 *     average, which runs as a separately-deployed edge function)
 * Change the floor here and in both of those together.
 */

/** Minimum asking price for an ordinary seller. */
export const PUBLIC_MIN_LISTING_PRICE_THB = 20;

/** Minimum asking price for staff seeding the marketplace. */
export const ADMIN_MIN_LISTING_PRICE_THB = 1;

export function minListingPriceThb(isAdmin: boolean): number {
  return isAdmin ? ADMIN_MIN_LISTING_PRICE_THB : PUBLIC_MIN_LISTING_PRICE_THB;
}

/**
 * True when a realized sale price is a usable market signal.
 *
 * Keyed on the price, not on the seller's role: the sub-floor price is what makes the
 * sale meaningless, and testing the price also covers a below-floor accepted offer and
 * any listing that reached the DB under the floor (the 20-baht minimum is enforced in
 * the listing form only — `/api/listings` accepts any positive price).
 */
export function isMarketSignalPriceThb(thb: number): boolean {
  return Number.isFinite(thb) && thb >= PUBLIC_MIN_LISTING_PRICE_THB;
}
