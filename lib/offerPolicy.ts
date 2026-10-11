/**
 * OBO Best-Offer anti-abuse thresholds — single source of truth.
 *
 * Mirrors the lib/partnerTiers.ts convention: tunable constants live here so
 * the create route (app/api/offers/route.ts) and any future consumer can't
 * drift. Enforced server-side in POST /api/offers unless noted.
 */

/**
 * Offer must be >= 60% of the list price. Offers and counters ABOVE the list
 * price are refused (OFFER_ABOVE_ASKING): Buy Now already beats them.
 */
export const OFFER_MIN_FLOOR_FRACTION = 0.6;

/** Global cap on live (pending, buyer-made) offers per buyer. */
export const OFFER_MAX_PENDING_PER_BUYER = 15;

/** After a reject, the buyer waits this long before re-offering the same listing. */
export const OFFER_REJECT_COOLDOWN_HOURS = 6;

/** Endpoint rate-limit: max offer creates per minute per buyer. */
export const OFFER_CREATE_RATE_PER_MIN = 5;

/** Offer lifetime. Mirrors the SQL `expires_at` default in 20260707_offers.sql. */
export const OFFER_EXPIRY_HOURS = 48;

/**
 * How long a buyer has to pay once an offer is accepted. The accept route
 * stamps it into `expires_at`; the hourly expire-offers cron enforces it.
 */
export const ACCEPTED_PAY_WINDOW_MS = OFFER_EXPIRY_HOURS * 3_600_000;

/**
 * Listing states that end every open offer on the listing: the seller took it
 * down, or moderation removed it. Not 'sold' — that is voided after payment
 * (lib/voidOffersForListing.ts), and a reservation can still fall through —
 * and not 'paused', which a shop reopens from.
 */
export const LISTING_GONE_STATUSES = ['cancelled', 'removed'];

export function isListingGone(status: string | null | undefined): boolean {
    return !!status && LISTING_GONE_STATUSES.includes(status);
}

/** Whether the OBO feature is enabled. Single flag, read on client and server. */
export const OFFERS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

/**
 * Pull a card name out of a Supabase `listings(card_data)` embed, tolerant of
 * both shapes the client can return (a single object for a to-one FK, or a
 * one-element array). Purely cosmetic for notification copy — returns undefined
 * when absent (the send functions fall back to "a card").
 */
export function cardNameFromListingEmbed(embed: unknown): string | undefined {
    const row = Array.isArray(embed) ? embed[0] : embed;
    const cardData = (row as { card_data?: { name?: string } } | null | undefined)?.card_data;
    return cardData?.name;
}
