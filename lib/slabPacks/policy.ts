/**
 * Slab Packs — the money rules around a pull, in one place: how a pack is
 * paid for, what the wallet is, what it costs to list a pull on the
 * marketplace, to have it shipped, or to turn credit into cash. Pure.
 *
 * The shape is deliberate and mirrors the operators that run this at scale:
 *
 *  - There is no stored-value top-up. A pack is paid for by card (or
 *    PromptPay) at the moment of purchase, like any marketplace order. The
 *    wallet only ever holds what Cardstreet has paid the collector for pulls
 *    they sold back, so the platform never issues e-money.
 *  - Credit is easy to SPEND (packs, the marketplace) and deliberately slow
 *    to WITHDRAW: identity and bank verification, a holding period, a
 *    minimum, a fee, a cap, and business-day processing.
 *  - Listing a pull on the Cardstreet marketplace is the cheap exit: the
 *    seller fee is cut, and Cardstreet ships from the vault.
 *  - Shipping a slab out of the vault is the slow exit: a flat fee and a
 *    long window, so the card stays liquid on the platform instead.
 *
 * All numbers are WORKING DEFAULTS for the admin-wall prototype, not reviewed.
 */

import { NON_PARTNER_FEE_FRACTION } from '@/lib/partnerTiers';

// ── Marketplace listing ─────────────────────────────────────────────────────

/** The marketplace's standard seller fee for a non-partner, single-sourced in lib/partnerTiers.ts. */
export const MARKET_FEE_RATE = NON_PARTNER_FEE_FRACTION;
/** The cut seller fee for a slab pulled from a pack and listed from the vault. */
export const PULL_MARKET_FEE_RATE = 0.05;
/** Listings open at this share of market value, editable before posting. */
export const DEFAULT_LIST_RATIO = 1;

export function listingPayoutThb(priceThb: number): number {
    return Math.floor(priceThb * (1 - PULL_MARKET_FEE_RATE));
}

// ── Shipping a slab out of the vault ────────────────────────────────────────

/** Flat fee per shipment, about USD 35: insured courier, custody release, packing. */
export const SHIP_FEE_THB = 1200;
/** Delivery window quoted to the buyer, in calendar days from the request. */
export const SHIP_DAYS: readonly [number, number] = [14, 21];
/** What a shipment needs before it can be requested. */
export const SHIP_REQUIRES = ['identity', 'address'] as const;

// ── Cash-out ────────────────────────────────────────────────────────────────

/** What a withdrawal needs before it can be requested. */
export const CASHOUT_REQUIRES = ['identity', 'bank'] as const;
export const CASHOUT_MIN_THB = 1000;
/** Fee on the amount withdrawn, with a floor. */
export const CASHOUT_FEE_RATE = 0.03;
export const CASHOUT_FEE_MIN_THB = 50;
/** Sell-back credit must be this old before it can be withdrawn. */
export const CASHOUT_HOLD_DAYS = 7;
/** Processing time quoted to the collector, in business days. */
export const CASHOUT_BUSINESS_DAYS: readonly [number, number] = [5, 7];
/** Rolling 30-day withdrawal cap per account. */
export const CASHOUT_MONTHLY_CAP_THB = 100_000;

export function cashoutFeeThb(amountThb: number): number {
    return Math.max(CASHOUT_FEE_MIN_THB, Math.ceil(amountThb * CASHOUT_FEE_RATE));
}

export function cashoutNetThb(amountThb: number): number {
    return Math.max(0, amountThb - cashoutFeeThb(amountThb));
}

// ── Points ──────────────────────────────────────────────────────────────────

/**
 * Cardstreet coins can pay for packs at the coin's existing redemption value:
 * one coin is one satang (lib/rewardTiers.ts caps every redemption at that
 * face value), so 100 coins buy one baht of pack. Coins only ever buy packs;
 * they are never paid out and never become wallet credit. A coin-paid pack
 * counts against the monthly reward budget like any real-cost redemption.
 */
export const COINS_PER_THB = 100;

export function coinsForThb(thb: number): number {
    return Math.ceil(thb * COINS_PER_THB);
}

export function thbForCoins(coins: number): number {
    return Math.floor(coins / COINS_PER_THB);
}

/** Coins earned per baht spent on packs, paid at purchase. */
export const COINS_EARNED_PER_THB = 1;

// ── Verification ────────────────────────────────────────────────────────────

export type VerificationKind = 'identity' | 'address' | 'bank';

export interface Verification {
    /** Government ID + a selfie, checked by a KYC vendor. */
    identity: boolean;
    /** A delivery address confirmed on the account. */
    address: boolean;
    /** A Thai bank account in the same name as the ID. */
    bank: boolean;
}

export const NO_VERIFICATION: Verification = { identity: false, address: false, bank: false };

export function missingVerification(v: Verification, needs: readonly VerificationKind[]): VerificationKind[] {
    return needs.filter((k) => !v[k]);
}

export const DAY_MS = 86_400_000;

/** [earliest, latest] delivery timestamps for a shipment requested at `at`. */
export function shipWindow(at: number): [number, number] {
    return [at + SHIP_DAYS[0] * DAY_MS, at + SHIP_DAYS[1] * DAY_MS];
}

/** Business days from `at`, skipping weekends only (no holiday calendar). */
export function addBusinessDays(at: number, days: number): number {
    const d = new Date(at);
    let left = days;
    while (left > 0) {
        d.setDate(d.getDate() + 1);
        const wd = d.getDay();
        if (wd !== 0 && wd !== 6) left -= 1;
    }
    return d.getTime();
}
