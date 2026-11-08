/**
 * Slab Packs — shared types. Pure module (no React / Supabase / Next imports)
 * so the mechanics run identically in the browser preview, in a route handler
 * and under a plain `tsx` script.
 */

/** The ladder, cheapest first. The names follow the NBA 2K card tiers. */
export type TierKey = 'bronze' | 'silver' | 'gold' | 'platinum' | 'emerald' | 'diamond' | 'opal';

/**
 * `live` packs are on sale. A `sold_out` pack is shown in the lobby at its
 * price, greyed out under a Sold out ribbon: not buyable, no table, never
 * pulled by the simulated collectors. A live pack whose floor class has no
 * cards left is shown the same way until it is restocked.
 */
export type TierStatus = 'live' | 'sold_out';

/** The games packs are sold for. Each game has its own pool and its own tables. */
export type GameKey = 'pokemon' | 'onepiece' | 'lorcana';

/**
 * Hit class of a pull, lowest to highest. A class is a band of slab value
 * relative to the pack price (see HIT_CLASSES in tiers.ts), so the same slab
 * is an SS in a cheap pack and a D in an expensive one.
 */
export type HitClass = 'd' | 'c' | 'b' | 'a' | 's' | 'ss';

export interface Slab {
    /** `${cardId}:${grade}` — one card type: a raw single, or one grade of a slab. Stock may hold several copies. */
    key: string;
    cardId: string;
    game: GameKey;
    /** `none` for a raw single. */
    grader: 'PSA' | 'none';
    /** The PSA grade, or `raw` for an ungraded near-mint single (most of the low-price packs). */
    grade: 9 | 10 | 'raw';
    /** English name, for the label and the lists. */
    name: string;
    /** The name printed on a Thai or Japanese card, when it differs from `name`. */
    localName?: string;
    setName: string;
    number: string;
    year: number;
    lang: 'EN' | 'JP' | 'TH';
    rarity: string;
    valueThb: number;
    /** Copies held when the pool was built. The preview store counts the live figure down as cards are pulled. */
    stock: number;
    /** Mirrored card art. When absent the URL is derived from the card id. */
    image?: { small: string; large: string };
}

/**
 * What the pack is made of. Drives the foil, the pack emblem and the stage
 * effects: brushed metal for the metal tiers, cut facets for the gem tiers,
 * and a nebula with a star field for Galaxy Opal.
 */
export type TierMaterial = 'metal' | 'gem' | 'galaxy';

export interface TierTheme {
    /** Foil gradient, light to dark. */
    a: string;
    b: string;
    c: string;
    /** Accent used for text, borders and the stage light. */
    glow: string;
    /** Ink colour that stays readable on the foil. */
    ink: string;
    material: TierMaterial;
}

export interface PackTier {
    key: TierKey;
    name: string;
    status: TierStatus;
    priceThb: number;
    /**
     * Published chance that a pack of this tier is each hit class. Sums to 1
     * and is the same for every buyer. The table folds a sold-out class into
     * the one below it (engine.ts effectiveOdds); that is the only way the
     * published figure ever differs from this one.
     */
    odds: Record<HitClass, number>;
    /** Share of a slab's market value paid as wallet credit on an instant sell-back. */
    sellBackRate: number;
    theme: TierTheme;
}

/** One card that a pack can contain, with its exact chance. */
export interface CardOdds {
    slab: Slab;
    cls: HitClass;
    /** Chance that a pack is this exact card. Sums to 1 over the whole table. */
    odds: number;
}

/**
 * Everything a buyer is shown about a tier's packs: the class odds, every
 * card the pack can contain with its own chance, and the numbers derived
 * from those (average value, floor, top prize). Built from the tier and the
 * pool; it only changes when the pool does.
 */
export interface PackTable {
    game: GameKey;
    tier: TierKey;
    byClass: Record<HitClass, {
        odds: number;
        cards: number;
        minThb: number;
        maxThb: number;
        /** Odds-weighted mean value of the class. */
        meanThb: number;
    }>;
    /** Every card the pack can contain, most valuable first. */
    cards: CardOdds[];
    /** Mean value of a pack: sum of odds x value. */
    evThb: number;
    floorThb: number;
    topThb: number;
}

/**
 * The fairness record of one pull. The commit (a hash of the secret seed) is
 * shown before the pack is ripped; the seed itself is shown after. Anyone
 * can hash the seed to check the commit and re-run the draw to check the
 * result.
 */
export interface PullProof {
    commit: string;
    /** Secret until the pull is revealed, then published. */
    seed: string;
    /** A value the buyer contributed, so the house cannot pick the seed alone. */
    clientSeed: string;
}

export type PullStatus = 'unrevealed' | 'vault' | 'listed' | 'sold' | 'shipping';

/** Where a shipped slab goes. Typed in by the collector at request time, never prefilled. */
export interface ShipTo {
    name: string;
    phone: string;
    address: string;
}

export interface Pull {
    id: string;
    slabKey: string;
    tier: TierKey;
    cls: HitClass;
    pricePaidThb: number;
    at: number;
    status: PullStatus;
    proof: PullProof;
    /**
     * Fingerprint of the stock the draw's table was built from (pool.ts
     * poolFingerprint), so the draw can be re-run against that exact table
     * after stock has moved.
     */
    stockHash?: string;
    /** Wallet credit received on sell-back. */
    soldForThb?: number;
    /** Marketplace listing, while `status` is 'listed'. */
    listPriceThb?: number;
    listedAt?: number;
    /** Shipping request, while `status` is 'shipping'. */
    shipRequestedAt?: number;
    /** Shipping fee plus insurance, as paid. */
    shipFeeThb?: number;
    shipInsuredThb?: number;
    shipTo?: ShipTo;
}

export interface FeedEvent {
    id: string;
    who: string;
    me: boolean;
    slabKey: string;
    tier: TierKey;
    cls: HitClass;
    at: number;
}
