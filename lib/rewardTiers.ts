// Single source of truth for the Collector Pass rewards system: the XP level
// ladder, rarity bands, check-in calendar, quest schedule, first-time award
// chain, and per-rule earn values.
//
// The SQL mirror lives in supabase/migrations/20260828_collector_pass_foundation.sql
// (reward_level_for_xp / reward_band_for_level / claim_daily_checkin's calendar
// array / the trigger award values). Change both together — the
// lib/partnerTiers.ts convention. This module is imported by client components
// AND server routes, so it must stay free of server-only imports.

// ---------------------------------------------------------------------------
// Levels & rarity bands
// ---------------------------------------------------------------------------

/** Cumulative XP required to REACH level index+1 (LEVEL_THRESHOLDS[0] = L1). */
export const LEVEL_THRESHOLDS: readonly number[] = [
    0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7500,
    10500, 14500, 20000, 27000, 36000, 48000, 63000, 82000, 105000, 135000,
];

export const MAX_REWARD_LEVEL = LEVEL_THRESHOLDS.length; // 20

export interface RarityBand {
    /** 1..8, ascending prestige. Matches reward_band_for_level in SQL. */
    band: number;
    key: 'c' | 'u' | 'r' | 'rr' | 'ur' | 'ir' | 'sar' | 'cr';
    name: string;
    nameTh: string;
    minLevel: number;
    /** Tailwind classes for the rank chip (bg + text). */
    chipClass: string;
}

export const RARITY_BANDS: readonly RarityBand[] = [
    { band: 1, key: 'c', name: 'Common', nameTh: 'คอมมอน', minLevel: 1, chipClass: 'bg-slate-500/30 text-slate-300' },
    { band: 2, key: 'u', name: 'Uncommon', nameTh: 'อันคอมมอน', minLevel: 4, chipClass: 'bg-emerald-500/25 text-emerald-300' },
    { band: 3, key: 'r', name: 'Rare', nameTh: 'แรร์', minLevel: 7, chipClass: 'bg-blue-500/25 text-blue-300' },
    { band: 4, key: 'rr', name: 'Double Rare', nameTh: 'ดับเบิลแรร์', minLevel: 10, chipClass: 'bg-purple-500/25 text-purple-300' },
    { band: 5, key: 'ur', name: 'Ultra Rare', nameTh: 'อัลตร้าแรร์', minLevel: 13, chipClass: 'bg-rose-500/25 text-rose-300' },
    { band: 6, key: 'ir', name: 'Illustration Rare', nameTh: 'อิลลัสเตรชันแรร์', minLevel: 16, chipClass: 'bg-amber-500/25 text-amber-300' },
    { band: 7, key: 'sar', name: 'Special Illustration Rare', nameTh: 'สเปเชียลอาร์ตแรร์', minLevel: 19, chipClass: 'bg-fuchsia-500/25 text-fuchsia-300' },
    { band: 8, key: 'cr', name: 'Crown Rare', nameTh: 'คราวน์แรร์', minLevel: 20, chipClass: 'bg-yellow-400/30 text-yellow-200' },
];

export function levelForXp(xp: number): number {
    const x = Number.isFinite(xp) ? xp : 0;
    let level = 1;
    for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
        if (x >= LEVEL_THRESHOLDS[i]) level = i + 1;
    }
    return level;
}

export function bandForLevel(level: number): RarityBand {
    let band = RARITY_BANDS[0];
    for (const b of RARITY_BANDS) {
        if (level >= b.minLevel) band = b;
    }
    return band;
}

export interface LevelProgress {
    level: number;
    band: RarityBand;
    /** XP earned inside the current level. */
    intoLevel: number;
    /** XP span of the current level, or null at the cap. */
    levelSpan: number | null;
    /** 0..1 progress toward the next level (1 at the cap). */
    pct: number;
    nextLevelXp: number | null;
}

export function levelProgress(xp: number): LevelProgress {
    const x = Math.max(0, Number.isFinite(xp) ? xp : 0);
    const level = levelForXp(x);
    const floor = LEVEL_THRESHOLDS[level - 1];
    const next = level < MAX_REWARD_LEVEL ? LEVEL_THRESHOLDS[level] : null;
    const span = next === null ? null : next - floor;
    return {
        level,
        band: bandForLevel(level),
        intoLevel: x - floor,
        levelSpan: span,
        pct: span === null ? 1 : Math.min(1, (x - floor) / span),
        nextLevelXp: next,
    };
}

// ---------------------------------------------------------------------------
// Daily loop
// ---------------------------------------------------------------------------

/** 7-day check-in coin calendar. MUST match claim_daily_checkin's array. */
export const CHECKIN_CALENDAR: readonly number[] = [5, 5, 10, 10, 15, 15, 40];
export const CHECKIN_XP = 5;

export const STREAK_MILESTONES: Record<number, number> = { 7: 50, 30: 100, 100: 300, 365: 1000 };

export const QUEST_XP = 10;
export const QUEST_COINS = 5;
export const QUEST_BONUS_COINS = 10;

export interface QuestDef {
    /** The ledger rule whose Bangkok-day earn rows measure progress. */
    rule: 'vault_add' | 'wishlist_add' | 'chat_stream' | 'listing_publish' | 'scan_confirm';
    target: number;
}

/**
 * Fixed, deterministic quest schedule keyed by Bangkok weekday (0 = Sunday,
 * matching Date#getDay). Identical for every user — deliberately no per-user
 * randomization (Thai gambling-law posture: nothing chance-based, ever).
 * scan_confirm counts only candidate-validated confirms of cards the user has
 * never confirmed before (ledger ref = card id), so quest scans can't be
 * farmed by rescanning one card — the COGS-attack fix from the design review.
 */
export const QUESTS_BY_WEEKDAY: readonly (readonly QuestDef[])[] = [
    /* Sun */[{ rule: 'vault_add', target: 3 }, { rule: 'wishlist_add', target: 1 }, { rule: 'chat_stream', target: 1 }],
    /* Mon */[{ rule: 'vault_add', target: 2 }, { rule: 'wishlist_add', target: 1 }, { rule: 'chat_stream', target: 1 }],
    /* Tue */[{ rule: 'scan_confirm', target: 1 }, { rule: 'vault_add', target: 1 }, { rule: 'chat_stream', target: 1 }],
    /* Wed */[{ rule: 'vault_add', target: 2 }, { rule: 'wishlist_add', target: 1 }, { rule: 'chat_stream', target: 1 }],
    /* Thu */[{ rule: 'scan_confirm', target: 1 }, { rule: 'wishlist_add', target: 1 }, { rule: 'chat_stream', target: 1 }],
    /* Fri */[{ rule: 'vault_add', target: 2 }, { rule: 'wishlist_add', target: 1 }, { rule: 'chat_stream', target: 1 }],
    /* Sat */[{ rule: 'listing_publish', target: 1 }, { rule: 'vault_add', target: 2 }, { rule: 'chat_stream', target: 1 }],
];

// ---------------------------------------------------------------------------
// Earn rules awarded from route/server code (trigger-awarded rules carry their
// values inside the migration; listed here only where code needs them)
// ---------------------------------------------------------------------------

export const EARN = {
    /** First chat message per stream per day-capped stream count. */
    CHAT_STREAM: { rule: 'chat_stream', xp: 5, coins: 0, dailyCap: 3 },
    /** Candidate-validated scan confirm; ref = card id (once per card, ever). */
    SCAN_CONFIRM: { rule: 'scan_confirm', xp: 5, coins: 0, dailyCap: 10 },
    /** 10+ minutes watched in one stream (LiveKit-webhook-verified); ref =
     *  stream id (once per stream). XP only — never coins. */
    WATCH_10M: { rule: 'watch_10m', xp: 10, coins: 0, dailyCap: 2 },
    /** Seller's offer got accepted (counterparty action — never on creation). */
    OFFER_ACCEPTED: { rule: 'offer_accepted', xp: 10, coins: 0, dailyCap: 5 },
    /** Referrer credit at attributed signup; coins release at conversion. */
    REFERRAL_SIGNUP: { rule: 'referral_signup', xp: 100, coins: 0, dailyCap: null },
    /** Referred user's first settled order — the deferred coin half. */
    REFERRAL_CONVERTED: { rule: 'referral_converted', xp: 0, coins: 100, monthlyCap: 10 },
    /** Seller settlement bonus XP (coins computed via settlementCoins). */
    ORDER_SETTLED_SELLER_XP: 25,
} as const;

/** GMV-scaled order XP: 1 XP per ฿10, capped 300/order, ฿100 minimum order. */
export function orderXp(totalTHB: number): number {
    const t = Number.isFinite(totalTHB) ? totalTHB : 0;
    if (t < 100) return 0;
    return Math.min(300, Math.floor(t / 10));
}

/**
 * Transaction coin-back at settlement, in coins (1 coin = 1 satang of
 * redemption value): buyer 1% of item total (= round(totalTHB) coins), seller
 * 0.5%, capped per order — then the suppression invariants from the design's
 * adversarial review: nothing mints under a ฿100 order, and combined
 * buyer+seller coins never exceed 50% of the order's ACTUAL platform fee (so
 * self-dealing stays money-losing at every partner tier and under vouchers).
 */
export function settlementCoins(totalTHB: number, platformFeeTHB: number): { buyer: number; seller: number } {
    const total = Number.isFinite(totalTHB) ? totalTHB : 0;
    const feeSatang = Math.max(0, Math.round((Number.isFinite(platformFeeTHB) ? platformFeeTHB : 0) * 100));
    if (total < 100 || feeSatang <= 0) return { buyer: 0, seller: 0 };

    let buyer = Math.min(500, Math.round(total));
    let seller = Math.min(300, Math.round(total / 2));

    const maxCombined = Math.floor(feeSatang / 2);
    const combined = buyer + seller;
    if (combined > maxCombined) {
        const scale = maxCombined / combined;
        buyer = Math.floor(buyer * scale);
        seller = Math.floor(seller * scale);
    }
    return { buyer, seller };
}

// ---------------------------------------------------------------------------
// First-time awards — the Collector's Journey (ordered as displayed)
// ---------------------------------------------------------------------------

export interface FirstAwardDef {
    key: string;
    xp: number;
    coins: number;
    /** Whether the Rewards Hub shows it in the checklist (all true for now). */
    journey: boolean;
}

export const FIRST_AWARDS: readonly FirstAwardDef[] = [
    { key: 'first_account', xp: 25, coins: 20, journey: true },
    { key: 'first_profile_complete', xp: 25, coins: 20, journey: true },
    { key: 'first_push', xp: 25, coins: 20, journey: true },
    { key: 'first_scan', xp: 30, coins: 20, journey: true },
    { key: 'first_vault', xp: 20, coins: 10, journey: true },
    { key: 'first_wishlist', xp: 10, coins: 10, journey: true },
    { key: 'first_watch', xp: 20, coins: 10, journey: true },
    { key: 'first_chat', xp: 10, coins: 10, journey: true },
    { key: 'first_purchase', xp: 100, coins: 100, journey: true },
    { key: 'first_review', xp: 20, coins: 20, journey: true },
    { key: 'first_stripe_complete', xp: 75, coins: 100, journey: true },
    { key: 'first_listing', xp: 100, coins: 50, journey: true },
    { key: 'first_sale_settled', xp: 150, coins: 100, journey: true },
    { key: 'first_spot', xp: 50, coins: 50, journey: true },
    { key: 'first_referral', xp: 50, coins: 50, journey: true },
];

export const FIRST_AWARD_BY_KEY: Record<string, FirstAwardDef> =
    Object.fromEntries(FIRST_AWARDS.map((a) => [a.key, a]));

// ---------------------------------------------------------------------------
// Coin store catalog. Pricing law: coin price >= 100 x max real THB cost —
// face value is the ceiling, never exceeded. realCostSatang is the amount the
// monthly reward_budget breaker reserves at redemption (0 = never gated).
// Effects and gates here MUST match redeem_reward_item + the redeem route.
// ---------------------------------------------------------------------------

export interface CatalogVoucherDef {
    /** 'order'/'shipping' discount the BUYER picks at checkout;
     *  'seller_fee' auto-applies to the SELLER's next sale's platform fee. */
    type: 'order' | 'shipping' | 'seller_fee';
    amountSatang: number;
    minOrderSatang: number;
    /** Days from redemption until the voucher expires unused. */
    validDays: number;
}

export interface CatalogItemDef {
    key: string;
    coins: number;
    kind: 'cosmetic' | 'perk' | 'voucher';
    /** false = shown as "Soon" (deferred SKUs). */
    redeemable: boolean;
    minLevel?: number;
    oncePerAccount?: boolean;
    /** Reserved from the monthly THB budget at redemption. */
    realCostSatang?: number;
    /** Hidden in the iOS build (App Store 3.1.1 — digital-goods unlock outside IAP). */
    iosHidden?: boolean;
    voucher?: CatalogVoucherDef;
}

export const CATALOG: readonly CatalogItemDef[] = [
    // ---- Cosmetics: zero marginal cost, so they carry the low/mid range and
    // give every balance something to aim at without touching the budget.
    { key: 'streak_freeze', coins: 150, kind: 'cosmetic', redeemable: true },
    { key: 'chat_color_cyan', coins: 250, kind: 'cosmetic', redeemable: true, minLevel: 4, oncePerAccount: true },
    { key: 'chat_color_mint', coins: 250, kind: 'cosmetic', redeemable: true, minLevel: 4, oncePerAccount: true },
    { key: 'chat_color_sky', coins: 250, kind: 'cosmetic', redeemable: true, minLevel: 4, oncePerAccount: true },
    { key: 'frame_neon', coins: 350, kind: 'cosmetic', redeemable: true, minLevel: 2, oncePerAccount: true },
    { key: 'chat_color_crimson', coins: 350, kind: 'cosmetic', redeemable: true, minLevel: 6, oncePerAccount: true },
    { key: 'chat_color_amber', coins: 350, kind: 'cosmetic', redeemable: true, minLevel: 6, oncePerAccount: true },
    { key: 'frame_sakura', coins: 400, kind: 'cosmetic', redeemable: true, minLevel: 2, oncePerAccount: true },
    { key: 'frame_forest', coins: 400, kind: 'cosmetic', redeemable: true, minLevel: 2, oncePerAccount: true },
    { key: 'emote_early_unlock', coins: 400, kind: 'cosmetic', redeemable: true },
    { key: 'chat_color_ice', coins: 500, kind: 'cosmetic', redeemable: true, minLevel: 9, oncePerAccount: true },
    { key: 'chat_color_toxic', coins: 500, kind: 'cosmetic', redeemable: true, minLevel: 9, oncePerAccount: true },
    { key: 'frame_holo', coins: 500, kind: 'cosmetic', redeemable: true, minLevel: 3, oncePerAccount: true },
    { key: 'frame_sunset', coins: 650, kind: 'cosmetic', redeemable: true, minLevel: 4, oncePerAccount: true },
    { key: 'frame_rainbow', coins: 800, kind: 'cosmetic', redeemable: true, minLevel: 5, oncePerAccount: true },
    { key: 'frame_abyss', coins: 1000, kind: 'cosmetic', redeemable: true, minLevel: 6, oncePerAccount: true },
    { key: 'frame_ember', coins: 1300, kind: 'cosmetic', redeemable: true, minLevel: 8, oncePerAccount: true },
    { key: 'frame_glacier', coins: 1300, kind: 'cosmetic', redeemable: true, minLevel: 8, oncePerAccount: true },
    { key: 'frame_gold', coins: 1800, kind: 'cosmetic', redeemable: true, minLevel: 10, oncePerAccount: true },
    // Unlocks every chat colour incl. rainbow, which no single-colour SKU sells.
    { key: 'chat_name_color', coins: 2200, kind: 'cosmetic', redeemable: true, minLevel: 13, oncePerAccount: true },
    { key: 'frame_prism', coins: 2600, kind: 'cosmetic', redeemable: true, minLevel: 13, oncePerAccount: true },
    { key: 'frame_void', coins: 4000, kind: 'cosmetic', redeemable: true, minLevel: 16, oncePerAccount: true },
    { key: 'frame_crown', coins: 8000, kind: 'cosmetic', redeemable: true, minLevel: 20, oncePerAccount: true },

    // ---- Perks
    // Deferred: needs the marketplace-ranking surface (own beta pass).
    { key: 'listing_boost', coins: 250, kind: 'perk', redeemable: false },
    { key: 'pro_trial_7d', coins: 2500, kind: 'perk', redeemable: true, oncePerAccount: true, iosHidden: true },

    // ---- Vouchers: the only SKUs that cost real money, so they sit far up the
    // ladder. Value per coin RISES with the tier (0.83 -> 1.00 satang) so
    // saving is rewarded, while never breaching the 1 coin = 1 satang ceiling.
    { key: 'voucher_25', coins: 3000, kind: 'voucher', redeemable: true, realCostSatang: 2500, voucher: { type: 'order', amountSatang: 2500, minOrderSatang: 30000, validDays: 60 } },
    { key: 'voucher_ship_40', coins: 4500, kind: 'voucher', redeemable: true, realCostSatang: 4000, voucher: { type: 'shipping', amountSatang: 4000, minOrderSatang: 50000, validDays: 60 } },
    { key: 'seller_fee_50', coins: 6000, kind: 'voucher', redeemable: true, minLevel: 7, realCostSatang: 5000, voucher: { type: 'seller_fee', amountSatang: 5000, minOrderSatang: 0, validDays: 90 } },
    { key: 'voucher_60', coins: 7000, kind: 'voucher', redeemable: true, realCostSatang: 6000, voucher: { type: 'order', amountSatang: 6000, minOrderSatang: 60000, validDays: 60 } },
    { key: 'voucher_ship_100', coins: 11000, kind: 'voucher', redeemable: true, realCostSatang: 10000, voucher: { type: 'shipping', amountSatang: 10000, minOrderSatang: 100000, validDays: 90 } },
    { key: 'voucher_150', coins: 16000, kind: 'voucher', redeemable: true, realCostSatang: 15000, voucher: { type: 'order', amountSatang: 15000, minOrderSatang: 120000, validDays: 90 } },
    { key: 'seller_fee_150', coins: 16000, kind: 'voucher', redeemable: true, minLevel: 10, realCostSatang: 15000, voucher: { type: 'seller_fee', amountSatang: 15000, minOrderSatang: 0, validDays: 120 } },
    { key: 'voucher_400', coins: 40000, kind: 'voucher', redeemable: true, realCostSatang: 40000, voucher: { type: 'order', amountSatang: 40000, minOrderSatang: 250000, validDays: 90 } },
];

export const CATALOG_BY_KEY: Record<string, CatalogItemDef> =
    Object.fromEntries(CATALOG.map((i) => [i.key, i]));

/** Frame item keys -> avatar-ring gradient classes (rendered as the ring
 *  behind the avatar on profile + seller pages). */
export const FRAME_STYLES: Record<string, string> = {
    // Entry tier
    frame_neon: 'bg-gradient-to-br from-cyan-400 via-teal-300 to-emerald-400',
    frame_sakura: 'bg-gradient-to-br from-pink-200 via-rose-300 to-fuchsia-400',
    frame_forest: 'bg-gradient-to-br from-lime-300 via-emerald-400 to-teal-600',
    // Mid tier
    frame_holo: 'bg-gradient-to-br from-cyan-300 via-sky-400 to-blue-600',
    frame_sunset: 'bg-gradient-to-br from-orange-300 via-rose-400 to-purple-500',
    frame_rainbow: 'bg-gradient-to-br from-rose-400 via-amber-300 to-indigo-400',
    frame_abyss: 'bg-gradient-to-br from-indigo-400 via-violet-600 to-slate-900',
    // High tier
    frame_ember: 'bg-gradient-to-br from-amber-300 via-orange-500 to-red-600',
    frame_glacier: 'bg-gradient-to-br from-slate-100 via-cyan-200 to-sky-500',
    frame_gold: 'bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-600',
    // Prestige - deep level gates, the long-haul chase
    frame_prism: 'bg-gradient-to-br from-fuchsia-400 via-cyan-300 to-amber-300',
    frame_void: 'bg-gradient-to-br from-slate-900 via-purple-800 to-slate-950',
    frame_crown: 'bg-gradient-to-br from-yellow-200 via-amber-400 to-rose-500',
};

/** Chat name colors (chat_name_color owners pick one; validated server-side
 *  at equip). 'rainbow' is a gradient-text class stack. */
export const CHAT_COLORS: Record<string, string> = {
    gold: 'text-amber-300',
    pink: 'text-pink-400',
    lime: 'text-lime-300',
    violet: 'text-violet-300',
    cyan: 'text-cyan-300',
    mint: 'text-emerald-300',
    sky: 'text-sky-300',
    crimson: 'text-red-400',
    amber: 'text-amber-400',
    ice: 'text-slate-200',
    toxic: 'text-lime-400',
    // Bundle-only: never sold as a single colour, so it stays the tell of a
    // full unlock.
    rainbow: 'bg-gradient-to-r from-rose-400 via-amber-300 to-cyan-300 bg-clip-text text-transparent',
};

// ---------------------------------------------------------------------------
// Milestone badges — mirrors grant_reward_milestones() in the 20260829
// migration (thresholds + coins MUST stay identical). Counters are ledger
// earn-row counts; streak badges read rewards.streak_best.
// ---------------------------------------------------------------------------

export interface MilestoneDef {
    rule: string;
    threshold: number;
    badge: string;
    coins: number;
}

export const MILESTONES: readonly MilestoneDef[] = [
    { rule: 'order_settled_buyer', threshold: 5, badge: 'buyer_5', coins: 100 },
    { rule: 'order_settled_buyer', threshold: 25, badge: 'buyer_25', coins: 300 },
    { rule: 'order_settled_buyer', threshold: 100, badge: 'buyer_100', coins: 1000 },
    { rule: 'order_settled_seller', threshold: 1, badge: 'seller_1', coins: 100 },
    { rule: 'order_settled_seller', threshold: 10, badge: 'seller_10', coins: 300 },
    { rule: 'order_settled_seller', threshold: 50, badge: 'seller_50', coins: 1000 },
    { rule: 'order_settled_seller', threshold: 250, badge: 'seller_250', coins: 3000 },
    { rule: 'review', threshold: 10, badge: 'reviews_10', coins: 100 },
    { rule: 'review', threshold: 50, badge: 'reviews_50', coins: 300 },
    { rule: 'vault_add', threshold: 50, badge: 'vault_50', coins: 0 },
    { rule: 'vault_add', threshold: 250, badge: 'vault_250', coins: 0 },
    { rule: 'vault_add', threshold: 1000, badge: 'vault_1000', coins: 0 },
    { rule: 'chat_stream', threshold: 25, badge: 'chat_25', coins: 0 },
    { rule: 'streak_best', threshold: 30, badge: 'streak_30', coins: 0 },
    { rule: 'streak_best', threshold: 100, badge: 'streak_100', coins: 0 },
    { rule: 'streak_best', threshold: 365, badge: 'streak_365', coins: 0 },
];

// ---------------------------------------------------------------------------
// Voucher checkout math (server-side; unit-tested in the local harness)
// ---------------------------------------------------------------------------

/** A buyer voucher is funded entirely from the platform fee: the discount can
 *  never exceed the cart's total fee, so the platform's take floors at zero
 *  and the seller's proceeds are untouched (TH direct charges). */
export function voucherDiscountSatang(faceSatang: number, totalFeeSatang: number): number {
    return Math.max(0, Math.min(Math.round(faceSatang), Math.round(totalFeeSatang)));
}

/**
 * Split a voucher discount across a cart's orders proportionally to each
 * order's platform fee (a per-order slice can never exceed that order's fee,
 * so every order's fee stays >= 0). Remainder satang go to the largest-fee
 * order. Returns per-order discounts in satang, same order as `feesSatang`.
 */
export function distributeVoucherDiscount(feesSatang: number[], discountSatang: number): number[] {
    const totalFee = feesSatang.reduce((s, f) => s + Math.max(0, f), 0);
    const discount = voucherDiscountSatang(discountSatang, totalFee);
    if (discount <= 0 || totalFee <= 0) return feesSatang.map(() => 0);

    const shares = feesSatang.map((f) => Math.floor((Math.max(0, f) / totalFee) * discount));
    let remainder = discount - shares.reduce((s, x) => s + x, 0);
    // Hand out the leftover satang to the largest-fee orders first, never
    // pushing a share past its order's fee.
    const order = feesSatang
        .map((f, i) => ({ f: Math.max(0, f), i }))
        .sort((a, b) => b.f - a.f);
    for (const { f, i } of order) {
        if (remainder <= 0) break;
        const room = f - shares[i];
        const take = Math.min(room, remainder);
        shares[i] += take;
        remainder -= take;
    }
    return shares;
}
