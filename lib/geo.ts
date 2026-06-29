/**
 * Purchase country gating.
 *
 * Shipping (Flash Express) is only configured for Thailand, so buying is
 * restricted to TH for now. Everyone else can still browse the marketplace and
 * manage their collection — only the checkout/purchase path is gated.
 *
 * Signal: Vercel sets `x-vercel-ip-country` (ISO 3166-1 alpha-2) on every
 * request that reaches a function, derived from the client IP. The same header
 * is already used elsewhere (app/join/[slug]/route.ts, referral attribution).
 * It is absent only in local dev or when geo can't be resolved.
 */

export const PURCHASE_ALLOWED_COUNTRY = 'TH';

const VERCEL_COUNTRY_HEADER = 'x-vercel-ip-country';

/** Reads the request's resolved country, or null when geo is unavailable. */
export function getRequestCountry(req: Request): string | null {
    const raw = req.headers.get(VERCEL_COUNTRY_HEADER);
    const country = raw?.trim().toUpperCase();
    return country ? country : null;
}

/**
 * Allow a purchase when we positively know the buyer is in Thailand, OR when
 * the country is unknown (local dev / unresolvable geo). We only hard-block a
 * country we can actually see is not Thailand — blocking unknowns would lock
 * out legitimate Thai buyers on the rare request Vercel can't geolocate, and
 * the worst case for an unknown is no worse than today.
 */
export function isPurchaseAllowedFromCountry(country: string | null): boolean {
    return country === null || country === PURCHASE_ALLOWED_COUNTRY;
}
