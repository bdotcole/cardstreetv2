/**
 * Slab Packs — the single source of truth for the pack ladder and the hit
 * classes. Everything that prices, rolls or displays a pack reads this
 * module (the engine, the preview store, the UI), so a number changed here
 * changes everywhere. Pure, like lib/partnerTiers.ts.
 *
 * All prices and odds are WORKING DEFAULTS for the admin-wall prototype —
 * nothing here has been through pricing or legal review.
 */

import type { HitClass, PackTier, TierKey } from './types';

export interface HitClassDef {
    /** 0 (lowest) to 5. Drives how hard the reveal goes. */
    rank: number;
    letter: string;
    /** Value band as a multiple of the pack price: min <= value/price < max. */
    min: number;
    max: number;
    color: string;
    /** Second stop for gradients and glows. */
    color2: string;
}

export const HIT_ORDER: readonly HitClass[] = ['d', 'c', 'b', 'a', 's', 'ss'];

/**
 * Bands are half-open and contiguous from D's floor to SS's ceiling. A slab
 * worth less than D's floor or more than SS's ceiling is never put in that
 * tier's packs, so the floor is a real guarantee: the worst pull in a pack is
 * worth at least 45% of what the pack cost.
 */
export const HIT_CLASSES: Record<HitClass, HitClassDef> = {
    d: { rank: 0, letter: 'D', min: 0.45, max: 0.62, color: '#94A3B8', color2: '#64748B' },
    c: { rank: 1, letter: 'C', min: 0.62, max: 0.9, color: '#34D399', color2: '#059669' },
    b: { rank: 2, letter: 'B', min: 0.9, max: 1.5, color: '#38BDF8', color2: '#2563EB' },
    a: { rank: 3, letter: 'A', min: 1.5, max: 3.5, color: '#C084FC', color2: '#7C3AED' },
    s: { rank: 4, letter: 'S', min: 3.5, max: 8, color: '#FBBF24', color2: '#F97316' },
    ss: { rank: 5, letter: 'SS', min: 8, max: 30, color: '#FF5FA2', color2: '#7DF9FF' },
};

/** Classes shown on the lobby's top-pulls strip. */
export const CHASE_CLASSES: readonly HitClass[] = ['s', 'ss'];

/**
 * Mean pack value as a share of the pack price. The table builder leans the
 * within-class card weights toward this; the real figure is computed from
 * the table and shown to the buyer, never assumed.
 */
export const TARGET_EV = 0.9;

export const TIER_ORDER: readonly TierKey[] = ['spark', 'surge', 'nova', 'eclipse', 'apex'];

/**
 * Odds are fixed per tier and published as they are. The shape follows what
 * the big digital-pack operators run: roughly four pulls in five land below
 * the pack price, one in seven is a hit at or above it, and a grail sits
 * under one percent. They sum to exactly 1 (checked by the engine).
 */
export const TIERS: Record<TierKey, PackTier> = {
    spark: {
        key: 'spark',
        name: 'Spark',
        priceThb: 1490,
        odds: { d: 0.465, c: 0.32, b: 0.14, a: 0.05, s: 0.018, ss: 0.007 },
        sellBackRate: 0.85,
        theme: { a: '#FFE9A8', b: '#FFA41B', c: '#B93A04', glow: '#FFB703', ink: '#2A1200' },
    },
    surge: {
        key: 'surge',
        name: 'Surge',
        priceThb: 3490,
        odds: { d: 0.47, c: 0.32, b: 0.14, a: 0.04, s: 0.02, ss: 0.01 },
        sellBackRate: 0.85,
        theme: { a: '#A5F7FF', b: '#06B6D4', c: '#1338BE', glow: '#22D3EE', ink: '#021526' },
    },
    nova: {
        key: 'nova',
        name: 'Nova',
        priceThb: 6990,
        odds: { d: 0.475, c: 0.325, b: 0.138, a: 0.037, s: 0.013, ss: 0.012 },
        sellBackRate: 0.85,
        theme: { a: '#F8C8FF', b: '#C026D3', c: '#4C1D95', glow: '#E879F9', ink: '#1B0530' },
    },
    eclipse: {
        key: 'eclipse',
        name: 'Eclipse',
        priceThb: 14900,
        odds: { d: 0.5, c: 0.3, b: 0.134, a: 0.032, s: 0.017, ss: 0.017 },
        sellBackRate: 0.85,
        theme: { a: '#FFB3BE', b: '#F43F5E', c: '#3F0514', glow: '#FB7185', ink: '#22030B' },
    },
    apex: {
        key: 'apex',
        name: 'Apex',
        priceThb: 34900,
        odds: { d: 0.5, c: 0.32, b: 0.12, a: 0.02, s: 0.02, ss: 0.02 },
        sellBackRate: 0.85,
        theme: { a: '#FFFFFF', b: '#B9C6FF', c: '#1A1740', glow: '#E0E7FF', ink: '#0B0B1A' },
    },
};

export function getTier(key: TierKey): PackTier {
    return TIERS[key];
}

/**
 * Which class a slab of this value is inside a pack of this price, or null
 * when it falls outside the tier's bands and must not go in the pack at all.
 */
export function classify(valueThb: number, priceThb: number): HitClass | null {
    const m = valueThb / priceThb;
    for (const cls of HIT_ORDER) {
        const def = HIT_CLASSES[cls];
        if (m >= def.min && m < def.max) return cls;
    }
    return null;
}

/** Wallet credit paid for an instant sell-back, whole baht, rounded in the house's favour. */
export function sellBackThb(valueThb: number, tier: PackTier): number {
    return Math.floor(valueThb * tier.sellBackRate);
}
