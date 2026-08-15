// Single source of truth for the auction engine's rules: the bid-increment
// ladder, duration presets, soft-close (anti-snipe) timing, the winner's
// payment window, second-chance offer validity, and the deadbeat strike
// policy.
//
// Everything that computes a minimum bid, an increment, or a deadline must
// import from here so the surfaces never drift (the partnerTiers discipline):
//   - the bid UI (min-next-bid display, raise validation)
//   - the API routes (app/api/auctions/*)
//   - the SQL that actually resolves bids -- auction_bid_increment() and the
//     place_bid() RPC in supabase/migrations/20260704_auction_house.sql
//
// If you change the ladder or a timing constant here, update that migration's
// auction_bid_increment() / DEFAULT clauses to match.
//
// All amounts are INTEGER SATANG (1 THB = 100 satang). The bid engine does
// exact integer math end to end; convert to THB only at display and at the
// order-creation boundary (orders.total_amount is THB).

export interface AuctionIncrementStep {
    /** Ladder step applies while current price < ceilingSatang (last step: Infinity). */
    ceilingSatang: number;
    incrementSatang: number;
}

// eBay-style ladder adapted to THB price bands.
export const AUCTION_INCREMENT_LADDER: readonly AuctionIncrementStep[] = [
    { ceilingSatang: 100_00, incrementSatang: 5_00 },        // < ฿100        → ฿5
    { ceilingSatang: 500_00, incrementSatang: 10_00 },       // ฿100–499      → ฿10
    { ceilingSatang: 1_000_00, incrementSatang: 20_00 },     // ฿500–999      → ฿20
    { ceilingSatang: 5_000_00, incrementSatang: 50_00 },     // ฿1,000–4,999  → ฿50
    { ceilingSatang: 10_000_00, incrementSatang: 100_00 },   // ฿5,000–9,999  → ฿100
    { ceilingSatang: 50_000_00, incrementSatang: 250_00 },   // ฿10,000–49,999→ ฿250
    { ceilingSatang: Infinity, incrementSatang: 500_00 },    // ≥ ฿50,000     → ฿500
];

/** Bid increment at a given current price. Mirrors SQL auction_bid_increment(). */
export function bidIncrementSatang(currentPriceSatang: number): number {
    for (const step of AUCTION_INCREMENT_LADDER) {
        if (currentPriceSatang < step.ceilingSatang) return step.incrementSatang;
    }
    return AUCTION_INCREMENT_LADDER[AUCTION_INCREMENT_LADDER.length - 1].incrementSatang;
}

/**
 * The minimum max-bid the next challenger must submit. The first bid may equal
 * the starting price; after that it's current price + one ladder increment.
 * (A current high bidder raising their own max is validated against their own
 * previous max instead -- the RPC handles that case.)
 */
export function minNextBidSatang(
    currentPriceSatang: number,
    bidCount: number,
    startingPriceSatang: number,
): number {
    if (bidCount <= 0) return startingPriceSatang;
    return currentPriceSatang + bidIncrementSatang(currentPriceSatang);
}

// ─── Listing constraints ───

/** Allowed auction durations, in hours (1 / 3 / 5 / 7 days). */
export const AUCTION_DURATION_HOURS = [24, 72, 120, 168] as const;
export type AuctionDurationHours = (typeof AUCTION_DURATION_HOURS)[number];

export function isValidAuctionDuration(hours: number): hours is AuctionDurationHours {
    return (AUCTION_DURATION_HOURS as readonly number[]).includes(hours);
}

/** ฿1 minimum start; ฿10,000,000 cap (matches the listings price cap). */
export const MIN_STARTING_PRICE_SATANG = 1_00;
export const MAX_PRICE_SATANG = 10_000_000_00;

// ─── Soft close (anti-snipe) ───
// A bid accepted inside the final window pushes ends_at out by the extension.
// Stored per-auction (soft_close_window_seconds / soft_close_extension_seconds)
// so a future 'live' mode can run short timers through the same RPC.

export const SOFT_CLOSE_WINDOW_SECONDS = 120;
export const SOFT_CLOSE_EXTENSION_SECONDS = 120;

/** Auction engine mode. 'timed' is the eBay-style MVP; 'live' is reserved for
 *  live breaking (short timers, no proxy) built on the same tables + RPC. */
export type AuctionMode = 'timed' | 'live';

// ─── Winner payment + deadbeat policy ───

/** Winner must pay within this window after close (order pending_payment). */
export const PAYMENT_WINDOW_HOURS = 24;

/** How long a second-chance offer to the runner-up stays open. */
export const SECOND_CHANCE_WINDOW_HOURS = 48;

/** N strikes inside the window ⇒ bidding suspended. Mirrored in place_bid(). */
export const STRIKE_LIMIT = 2;
export const STRIKE_WINDOW_DAYS = 90;

// ─── Formatting helpers ───

export function satangToThb(satang: number): number {
    return satang / 100;
}

export function thbToSatang(thb: number): number {
    return Math.round(thb * 100);
}
