// Single source of truth for the partner loyalty ladder: how many attributed
// app downloads (profiles.total_downloads) a partner needs to reach each level,
// and the seller fee each level pays.
//
// Everything that maps downloads -> level -> fee must import from here so the
// three surfaces never drift:
//   - the fee a seller is actually charged   (app/api/orders/checkout)
//   - the level/fee a partner sees            (components/PartnerPortal)
//   - the SQL that keeps profiles.partner_level / partner_fee in sync
//     (supabase/migrations/20260701_partner_level_from_downloads.sql)
//
// If you change a threshold or a fee here, update partner_level_for_downloads /
// partner_fee_for_level in that migration to match.

export interface PartnerTierSpec {
    /** 1-9. Also the value stored in profiles.partner_level. */
    level: number;
    /** Display name (matches the marketing tiers). */
    name: string;
    /** Minimum total_downloads to reach this level. */
    minDownloads: number;
    /** Seller fee at this level, as a percent (e.g. 4.5 means 4.5%). */
    feePercent: number;
}

// Non-partner sellers pay the standard rate; partners start at level 1.
export const NON_PARTNER_FEE_PERCENT = 9.0;
export const NON_PARTNER_FEE_FRACTION = NON_PARTNER_FEE_PERCENT / 100;

// CardStreet Pro perk: subscribers sell at the Bronze partner rate without
// needing partner status. Applied as a FLOOR -- a partner whose ladder already
// beats 5% keeps the better rate.
export const PRO_SELLER_FEE_PERCENT = 5.0;
export const PRO_SELLER_FEE_FRACTION = PRO_SELLER_FEE_PERCENT / 100;

/** The fee fraction a seller actually pays once Pro membership is considered. */
export function applyProSellerRate(feeFraction: number, isPro: boolean): number {
    return isPro ? Math.min(feeFraction, PRO_SELLER_FEE_FRACTION) : feeFraction;
}

export const MIN_PARTNER_LEVEL = 1;
export const MAX_PARTNER_LEVEL = 9;

export const PARTNER_TIERS: readonly PartnerTierSpec[] = [
    { level: 1, name: 'Bronze Rare', minDownloads: 0, feePercent: 5.0 },
    { level: 2, name: 'Silver Rare', minDownloads: 100, feePercent: 4.5 },
    { level: 3, name: 'Gold Rare', minDownloads: 500, feePercent: 4.0 },
    { level: 4, name: 'Platinum Rare', minDownloads: 1000, feePercent: 3.5 },
    { level: 5, name: 'Sapphire Rare', minDownloads: 2500, feePercent: 3.0 },
    { level: 6, name: 'Ruby Rare', minDownloads: 3500, feePercent: 2.75 },
    { level: 7, name: 'Emerald Rare', minDownloads: 5000, feePercent: 2.5 },
    { level: 8, name: 'Diamond Rare', minDownloads: 7500, feePercent: 2.25 },
    { level: 9, name: 'Black Opal Rare', minDownloads: 10000, feePercent: 2.0 },
];

// Legacy tier-name aliases -> level, for any pre-INTEGER partner_level rows.
const NAME_TO_LEVEL: Record<string, number> = {
    bronze: 1, silver: 2, gold: 3, platinum: 4, sapphire: 5,
    ruby: 6, emerald: 7, diamond: 8,
    black_opal: 9, opal: 9, pink_diamond: 9, heart: 9,
};

const clampLevel = (n: number): number =>
    Math.min(MAX_PARTNER_LEVEL, Math.max(MIN_PARTNER_LEVEL, Math.round(n)));

/** Coerce a partner_level value (INTEGER, numeric string, or legacy tier name) to 1-9. */
export function coerceLevel(raw: unknown): number {
    if (raw == null) return MIN_PARTNER_LEVEL;
    if (typeof raw === 'number' && Number.isFinite(raw)) return clampLevel(raw);
    const s = String(raw).trim().toLowerCase().replace(/ /g, '_');
    if (/^\d+$/.test(s)) return clampLevel(parseInt(s, 10));
    return NAME_TO_LEVEL[s] ?? MIN_PARTNER_LEVEL;
}

/** Highest level a partner qualifies for at a given download count. */
export function levelForDownloads(downloads: number): number {
    const d = Number.isFinite(downloads) ? downloads : 0;
    let level = MIN_PARTNER_LEVEL;
    for (const tier of PARTNER_TIERS) {
        if (d >= tier.minDownloads) level = tier.level;
    }
    return level;
}

/** Seller fee for a level, as a percent (5.0 means 5%). */
export function feePercentForLevel(level: number): number {
    return PARTNER_TIERS[clampLevel(level) - 1].feePercent;
}

/** Seller fee for a level, as a fraction (0.05 means 5%). */
export function feeFractionForLevel(level: number): number {
    return feePercentForLevel(level) / 100;
}

export function tierForLevel(level: number): PartnerTierSpec {
    return PARTNER_TIERS[clampLevel(level) - 1];
}

/**
 * A partner's effective level: the higher of an admin-granted level (a courtesy
 * floor) and what their downloads have earned. Downloads auto-promote and nobody
 * is demoted below what they earned. Mirrors GREATEST(...) in the SQL trigger,
 * so the fee is correct even if that migration has not been applied yet.
 */
export function effectivePartnerLevel(adminLevel: unknown, downloads: number): number {
    return Math.max(coerceLevel(adminLevel), levelForDownloads(downloads));
}
