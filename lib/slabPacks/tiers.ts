/**
 * Slab Packs — the single source of truth for the pack ladder and the hit
 * classes. Everything that prices, rolls or displays a pack reads this
 * module (the engine, the preview store, the UI), so a number changed here
 * changes everywhere. Pure, like lib/partnerTiers.ts.
 *
 * The ladder is named after the NBA 2K card tiers (Silver, Gold, Platinum,
 * Emerald, Diamond, Galaxy Opal) and priced in steps of 775 baht. Prices and
 * odds are the founder's 2026-10-24 figures; the odds have not been through
 * pricing or legal review.
 */

import type { GameKey, HitClass, PackTier, TierKey } from './types';

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
 * Bands are half-open and contiguous from D's floor to SS's ceiling, cut the
 * way Courtyard's pull data falls: two bands under the price (half to 0.7x,
 * then up to the price), "paid for itself" at 1-2x, a good hit at 2-5x, a
 * monster at 5-10x and a grail at 10x and up. A slab worth less than half the
 * pack price or more than 30x it is never put in that tier's packs, so the
 * floor is a real guarantee.
 */
export const HIT_CLASSES: Record<HitClass, HitClassDef> = {
    d: { rank: 0, letter: 'D', min: 0.5, max: 0.7, color: '#94A3B8', color2: '#64748B' },
    c: { rank: 1, letter: 'C', min: 0.7, max: 1, color: '#34D399', color2: '#059669' },
    b: { rank: 2, letter: 'B', min: 1, max: 2, color: '#38BDF8', color2: '#2563EB' },
    a: { rank: 3, letter: 'A', min: 2, max: 5, color: '#C084FC', color2: '#7C3AED' },
    s: { rank: 4, letter: 'S', min: 5, max: 10, color: '#FBBF24', color2: '#F97316' },
    ss: { rank: 5, letter: 'SS', min: 10, max: 30, color: '#FF5FA2', color2: '#7DF9FF' },
};

/** The games packs are sold for, in the order the switch shows them. */
export const PACK_GAMES: readonly GameKey[] = ['pokemon', 'onepiece', 'lorcana'];

/** Classes shown on the lobby's top-pulls strip. */
export const CHASE_CLASSES: readonly HitClass[] = ['s', 'ss'];

/**
 * Mean pack value as a share of the pack price. The table builder leans the
 * within-class card weights toward this; the real figure is computed from
 * the table and shown to the buyer, never assumed. 0.95 is where Courtyard's
 * pulls measure out (PackSpy counts 95-97% value back), with the margin
 * taken in the sell-back spread rather than the pull. Lower it and the
 * builder leans harder on the cheap end of every class.
 */
export const TARGET_EV = 0.95;

export const TIER_ORDER: readonly TierKey[] = ['silver', 'gold', 'platinum', 'emerald', 'diamond', 'opal'];

/**
 * Odds are fixed per tier and published as they are. The shape follows what
 * Courtyard's pulls measure out to: about three in four land under the pack
 * price, one in five pays for itself, a few percent are a good hit, and a
 * grail is under one percent. They sum to exactly 1 (checked by the engine).
 *
 * Themes: a / b / c are the foil gradient light to dark, glow lights the
 * stage, ink is the print colour on the foil, material picks the surface
 * treatment and the opening effects (see slabPacks.css [data-material]).
 */
export const TIERS: Record<TierKey, PackTier> = {
    silver: {
        key: 'silver',
        name: 'Silver',
        priceThb: 775,
        odds: { d: 0.44, c: 0.3, b: 0.2, a: 0.04, s: 0.014, ss: 0.006 },
        sellBackRate: 0.85,
        theme: { a: '#FFFFFF', b: '#C9D1DB', c: '#525C6B', glow: '#E6EDF5', ink: '#1B2430', material: 'metal' },
    },
    gold: {
        key: 'gold',
        name: 'Gold',
        priceThb: 1550,
        odds: { d: 0.45, c: 0.3, b: 0.19, a: 0.04, s: 0.014, ss: 0.006 },
        sellBackRate: 0.85,
        theme: { a: '#FFF3C4', b: '#F2B705', c: '#7A4A00', glow: '#FFD24D', ink: '#2B1A00', material: 'metal' },
    },
    platinum: {
        key: 'platinum',
        name: 'Platinum',
        priceThb: 2325,
        odds: { d: 0.45, c: 0.3, b: 0.19, a: 0.04, s: 0.013, ss: 0.007 },
        sellBackRate: 0.85,
        theme: { a: '#FFFFFF', b: '#D9E6F2', c: '#6F869E', glow: '#CFE8FF', ink: '#10283E', material: 'metal' },
    },
    emerald: {
        key: 'emerald',
        name: 'Emerald',
        priceThb: 3875,
        odds: { d: 0.46, c: 0.3, b: 0.18, a: 0.04, s: 0.012, ss: 0.008 },
        sellBackRate: 0.85,
        theme: { a: '#C8FFE3', b: '#12B981', c: '#04543F', glow: '#3EE8A4', ink: '#03251B', material: 'gem' },
    },
    diamond: {
        key: 'diamond',
        name: 'Diamond',
        priceThb: 7750,
        odds: { d: 0.47, c: 0.3, b: 0.17, a: 0.04, s: 0.012, ss: 0.008 },
        sellBackRate: 0.85,
        theme: { a: '#FFFFFF', b: '#A6E6FF', c: '#1E55C9', glow: '#8FDCFF', ink: '#0A2448', material: 'gem' },
    },
    opal: {
        key: 'opal',
        name: 'Galaxy Opal',
        priceThb: 15500,
        odds: { d: 0.48, c: 0.3, b: 0.16, a: 0.04, s: 0.012, ss: 0.008 },
        sellBackRate: 0.85,
        theme: { a: '#FFD9F6', b: '#8B5CF6', c: '#1A1446', glow: '#F472B6', ink: '#0A0520', material: 'galaxy' },
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
