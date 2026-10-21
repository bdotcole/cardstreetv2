/**
 * Slab Packs — shared types. Pure module (no React / Supabase / Next imports)
 * so the mechanics run identically in the browser preview, in a route handler
 * and under a plain `tsx` script.
 */

export type TierKey = 'spark' | 'surge' | 'nova' | 'eclipse' | 'apex';

/**
 * Hit class of a pull, lowest to highest. A class is a band of slab value
 * relative to the pack price (see HIT_CLASSES in tiers.ts), so the same slab
 * is an SS in a cheap pack and a D in an expensive one.
 */
export type HitClass = 'd' | 'c' | 'b' | 'a' | 's' | 'ss';

export interface Slab {
    /** `${cardId}:${grade}` — one slab type. A series may hold several copies. */
    key: string;
    cardId: string;
    grader: 'PSA';
    grade: 9 | 10;
    name: string;
    setName: string;
    number: string;
    year: number;
    lang: 'EN' | 'JP';
    rarity: string;
    valueThb: number;
}

export interface TierTheme {
    /** Foil gradient, light to dark. */
    a: string;
    b: string;
    c: string;
    /** Accent used for text, borders and the stage light. */
    glow: string;
    /** Ink colour that stays readable on the foil. */
    ink: string;
}

export interface PackTier {
    key: TierKey;
    name: string;
    priceThb: number;
    /** Packs in one sealed series. */
    seriesSize: number;
    /** Slabs of each hit class in one series. Must sum to seriesSize. */
    composition: Record<HitClass, number>;
    /** Share of a slab's market value paid as credit on an instant sell-back. */
    sellBackRate: number;
    theme: TierTheme;
}

export interface SeriesClaim {
    index: number;
    slabKey: string;
    cls: HitClass;
    who: string;
    me: boolean;
    at: number;
}

/**
 * One sealed series: a fixed, pre-shuffled manifest of slabs. `next` is the
 * number of packs already sold, so manifest[next] is the slab inside the next
 * pack. Nothing about a pull is decided at purchase time.
 */
export interface SeriesState {
    tier: TierKey;
    number: number;
    /** Secret until the series sells out, then published for verification. */
    seed: string;
    /** sha256 over seed + manifest + bonus, published when the series opens. */
    commit: string;
    manifest: string[];
    next: number;
    /** Extra slab awarded to whoever buys the last pack of the series. */
    bonusKey: string | null;
    /** Who pulled what, for S and SS slabs only (the chase board). */
    claims: SeriesClaim[];
    startedAt: number;
}

export type PullStatus = 'unrevealed' | 'vault' | 'sold' | 'shipping';

export interface Pull {
    id: string;
    slabKey: string;
    tier: TierKey;
    series: number;
    /** Position in the series manifest; -1 for a last-pack bonus slab. */
    index: number;
    cls: HitClass;
    pricePaidThb: number;
    at: number;
    status: PullStatus;
    soldForThb?: number;
    bonus?: boolean;
}

export interface FeedEvent {
    id: string;
    who: string;
    me: boolean;
    slabKey: string;
    tier: TierKey;
    cls: HitClass;
    at: number;
    /** A last-pack bonus slab rather than a pack pull. */
    bonus?: boolean;
}

export interface SeriesSummary {
    total: number;
    left: number;
    byClass: Record<HitClass, { total: number; left: number }>;
    /** Chance the NEXT pack is each class, from what is still sealed. */
    oddsNext: Record<HitClass, number>;
    /** Mean slab value of the whole series / of the sealed remainder, in THB. */
    evAllThb: number;
    evLeftThb: number;
    floorThb: number;
    topThb: number;
}
