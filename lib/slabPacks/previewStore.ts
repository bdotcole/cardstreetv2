'use client';

/**
 * Slab Packs — PREVIEW state for the admin-wall prototype.
 *
 * There is no backend yet: no inventory, no wallet ledger, no payment, no
 * KYC. This store stands in for all of them so the mechanics and the design
 * can be played end to end. Everything lives in this browser's localStorage:
 *
 *   - a card payment is simulated as instant and always successful
 *   - the wallet holds only what sell-backs have paid into it (no top-ups,
 *     exactly as the real one will), and cash-out requests sit as pending
 *   - coins are a demo balance standing in for rewards.coin_balance
 *   - identity / bank verification are flags the mock KYC sheet flips after
 *     a short "review"
 *   - a shipment records where it goes, its fee and insurance, as paid
 *   - stock is this browser's copy of the inventory count: a pulled card
 *     leaves it, a sold-back card returns to it, and the tables are built
 *     from what is left (a pack pauses when its floor class runs dry)
 *   - "other collectors" are simulated so the feed moves; they are labelled
 *     as simulated in the UI, take nothing out of stock, and are off by
 *     default now that the pool is real stock
 *
 * The seam for the real build: `buy` becomes one server call that charges
 * the card, draws with a server-held seed and returns the pulls with their
 * commits; `sell`, `list`, `requestShipping` and `requestCashout` become
 * wallet / listing / fulfilment / payout rows. The components read this
 * module's state shape and nothing else.
 */

import { useSyncExternalStore } from 'react';
import { buildTable, commitFor, draw, poolWithoutRepeats } from './engine';
import {
    CASHOUT_BUSINESS_DAYS, CASHOUT_HOLD_DAYS, CASHOUT_MIN_THB, CASHOUT_MONTHLY_CAP_THB, CASHOUT_REQUIRES,
    COINS_EARNED_PER_THB, DAY_MS, NO_VERIFICATION, SHIP_FEE_THB,
    addBusinessDays, cashoutFeeThb, coinsForThb, insuranceThb, missingVerification,
    type Verification, type VerificationKind,
} from './policy';
import { getSlab, poolFingerprint, poolForGame } from './pool';
import { PACK_GAMES, TIERS, TIER_ORDER, sellBackThb } from './tiers';
import type { FeedEvent, GameKey, PackTable, Pull, ShipTo, Slab, TierKey } from './types';

const STORAGE_KEY = 'cs_slab_packs_preview_v6';
const STORAGE_VERSION = 6;
const FEED_CAP = 40;
const PULL_CAP = 400;
const LEDGER_CAP = 300;
/** Stock snapshots kept for re-verifying old pulls; the oldest fall away. */
const SNAPSHOT_CAP = 120;

/** Demo coin balance standing in for rewards.coin_balance (1 coin = 1 satang). */
export const START_COINS = 5000;
export const ME = 'you';

export type PaymentMethod = 'card' | 'wallet' | 'coins';

export interface PreviewSettings {
    sound: boolean;
    haptics: boolean;
    /** Skip the build-up and go straight to the reveal. */
    fast: boolean;
    /** Simulated other collectors pulling from the same packs. They take nothing out of stock. */
    activity: boolean;
}

export type LedgerKind = 'sellback' | 'pack' | 'ship_fee' | 'cashout';

/** One movement of wallet credit, signed. */
export interface LedgerEntry {
    id: string;
    at: number;
    kind: LedgerKind;
    thb: number;
    /** Pull id, or the cash-out request id. */
    ref?: string;
}

export interface CashoutRequest {
    id: string;
    at: number;
    amountThb: number;
    feeThb: number;
    netThb: number;
    status: 'pending' | 'paid';
    /** When the bank transfer is expected to land. */
    expectedAt: number;
}

export interface PreviewStats {
    packs: number;
    spentThb: number;
    pulledThb: number;
    soldBackThb: number;
}

export interface PreviewState {
    hydrated: boolean;
    /** Credit from sell-backs, in whole baht. Never topped up. */
    walletThb: number;
    coins: number;
    verification: Verification;
    /** The buyer's half of every pull's seed; made once per browser. */
    clientSeed: string;
    ledger: LedgerEntry[];
    cashouts: CashoutRequest[];
    pulls: Pull[];
    feed: FeedEvent[];
    settings: PreviewSettings;
    stats: PreviewStats;
    /** Copies of each card type left, by slab key. A pull takes one; a sell-back returns one. */
    stock: Record<string, number>;
    /**
     * The in-stock keys of a game at the moment of a draw, by fingerprint, so
     * a pull can be re-verified against the exact table it was drawn from
     * after stock has moved. Bounded by SNAPSHOT_CAP.
     */
    stockSnapshots: Record<string, string[]>;
}

// Simulated activity is off by default: the pool is real stock, and a bot
// "pulling" a one-copy card would read as that card being gone.
const DEFAULT_SETTINGS: PreviewSettings = { sound: true, haptics: true, fast: false, activity: false };

const SERVER_STATE: PreviewState = {
    hydrated: false,
    walletThb: 0,
    coins: 0,
    verification: NO_VERIFICATION,
    clientSeed: '',
    ledger: [],
    cashouts: [],
    pulls: [],
    feed: [],
    settings: DEFAULT_SETTINGS,
    stats: { packs: 0, spentThb: 0, pulledThb: 0, soldBackThb: 0 },
    stock: {},
    stockSnapshots: {},
};

let state: PreviewState = SERVER_STATE;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ── The published tables, one per game and tier, for the stock in hand ──────

// Keyed by game, tier and the fingerprint of the pool they were built from.
// Stock moves one card at a time, so the cache stays small; capped anyway.
const tables = new Map<string, PackTable | null>();
const TABLE_CACHE_CAP = 64;

/** Full stock, the way the inventory file lists it. */
function fullStock(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const game of PACK_GAMES) for (const s of poolForGame(game)) out[s.key] = s.stock;
    return out;
}

/** The card types of a game with at least one copy left. Before hydration, the whole inventory. */
export function stockPool(game: GameKey, stock: Record<string, number> = state.stock): readonly Slab[] {
    const pool = poolForGame(game);
    if (!state.hydrated) return pool;
    return pool.filter((s) => (stock[s.key] ?? 0) > 0);
}

function tableFor(game: GameKey, tierKey: TierKey, pool: readonly Slab[]): PackTable | null {
    // A sold-out pack is not sold, so it has no table, whatever the pool holds.
    if (TIERS[tierKey].status !== 'live') return null;
    const key = `${game}:${tierKey}:${poolFingerprint(pool)}`;
    if (!tables.has(key)) {
        try {
            tables.set(key, buildTable(game, TIERS[tierKey], pool));
        } catch {
            // The floor class is empty: paused until restocked.
            tables.set(key, null);
        }
        if (tables.size > TABLE_CACHE_CAP) {
            const oldest = tables.keys().next();
            if (!oldest.done) tables.delete(oldest.value);
        }
    }
    return tables.get(key) ?? null;
}

/**
 * The table for a game's tier from the stock in hand, or null when the pack
 * is not on sale: a sold-out tier, or a live tier whose floor class has no
 * cards left (paused until restocked).
 */
export function tryTable(game: GameKey, tier: TierKey): PackTable | null {
    return tableFor(game, tier, stockPool(game));
}

export function getTable(game: GameKey, tier: TierKey): PackTable {
    const table = tryTable(game, tier);
    if (!table) throw new Error(`[slabPacks] no ${tier} table for ${game}`);
    return table;
}

/**
 * The table a pull was drawn from, rebuilt from the stock snapshot its
 * fingerprint names, so the fairness check still runs after stock has
 * moved. Null when the snapshot has aged out or the pull predates them.
 */
export function tableForPull(pull: Pull): PackTable | null {
    const game = getSlab(pull.slabKey)?.game;
    if (!game || !pull.stockHash) return null;
    const keys = state.stockSnapshots[pull.stockHash];
    if (!keys) return null;
    const pool = keys.map((k) => getSlab(k)).filter((s): s is Slab => !!s);
    return tableFor(game, pull.tier, pool);
}

/** The tiers a game sells right now, cheapest first. */
export function availableTiers(game: GameKey): TierKey[] {
    return TIER_ORDER.filter((tier) => tryTable(game, tier) !== null);
}

const ALL_TIERS: TierKey[] = [...TIER_ORDER];

/**
 * Every pack the lobby shows, cheapest first: the ones on sale and, greyed
 * out as sold out, the rest (a tier with no stock behind it, or a live tier
 * paused until its floor is restocked). One stable array, so it can sit in
 * effect dependencies.
 */
export function offeredTiers(): TierKey[] {
    return ALL_TIERS;
}

/** Games that sell at least one tier right now. */
export function availableGames(): GameKey[] {
    return PACK_GAMES.filter((g) => availableTiers(g).length > 0);
}

function emit() {
    for (const l of listeners) l();
}

function persist() {
    if (typeof window === 'undefined' || !state.hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const rest: Partial<PreviewState> = { ...state };
            delete rest.hydrated;
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, ...rest }));
        } catch {
            // Storage full or blocked: the preview still plays, it just will
            // not survive a reload.
        }
    }, 150);
}

function set(next: PreviewState) {
    state = next;
    persist();
    emit();
}

function newSeed(): string {
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Handles for the simulated collectors. Invented, not real accounts.
const BOT_NAMES = [
    'mookie_bkk', 'TonKla', 'slabhunter', 'Nong_Earth', 'BKK_Slabs', 'cnx.cards', 'kai_tcg', 'PlaPulls',
    'Ohm168', 'fah.collects', 'SiamRips', 'mint_10', 'Boss_PSA', 'aomsin', 'gemmint_th', 'Tee9',
    'pikaboy', 'NamTan', 'ripcity66', 'JJ_market', 'beam.tcg', 'Pond_Pokemon', 'Guitar_GX', 'holo.hero',
];

// Cheaper packs move faster, as they would; Pokemon moves most. Only packs
// that are on sale: nobody pulls a sold-out pack.
const BOT_TIER_WEIGHTS: [TierKey, number][] = [
    ['bronze', 8], ['silver', 5], ['gold', 3],
];
const BOT_GAME_WEIGHTS: [GameKey, number][] = [['pokemon', 5], ['onepiece', 2], ['lorcana', 2]];

function pick<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function weighted<T>(pairs: readonly [T, number][]): T {
    const total = pairs.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [key, w] of pairs) {
        r -= w;
        if (r <= 0) return key;
    }
    return pairs[0][0];
}

/**
 * A simulated collector's pull: a real draw from the current table, straight
 * to the feed. It takes nothing out of stock. Null when that pack is not sold.
 */
function botEvent(who: string, at: number): FeedEvent | null {
    const game = weighted(BOT_GAME_WEIGHTS);
    const tierKey = weighted(BOT_TIER_WEIGHTS);
    const table = tryTable(game, tierKey);
    if (!table) return null;
    const d = draw(table, newSeed(), who);
    return { id: `bot-${game}-${tierKey}-${at}-${Math.floor(Math.random() * 1e6)}`, who, me: false, slabKey: d.slabKey, tier: tierKey, cls: d.cls, at };
}

function freshState(now: number, settings: PreviewSettings = DEFAULT_SETTINGS): PreviewState {
    const feed: FeedEvent[] = [];
    // With simulated collectors on, the feed opens already moving, spread over the last hour.
    if (settings.activity) {
        for (let i = 0; i < 14; i++) {
            const e = botEvent(pick(BOT_NAMES), now - Math.floor(Math.random() * 3_600_000));
            if (e) feed.push(e);
        }
        feed.sort((a, b) => b.at - a.at);
    }
    return {
        hydrated: true,
        walletThb: 0,
        coins: START_COINS,
        verification: NO_VERIFICATION,
        clientSeed: newSeed(),
        ledger: [],
        cashouts: [],
        pulls: [],
        feed,
        settings,
        stats: { packs: 0, spentThb: 0, pulledThb: 0, soldBackThb: 0 },
        stock: fullStock(),
        stockSnapshots: {},
    };
}

/** Saved counts for the cards still in the inventory; a card added since starts at its full count. */
function mergeStock(saved: unknown): Record<string, number> {
    const stock = fullStock();
    if (!saved || typeof saved !== 'object') return stock;
    const prev = saved as Record<string, unknown>;
    for (const key of Object.keys(stock)) {
        const n = prev[key];
        if (typeof n === 'number' && Number.isFinite(n)) stock[key] = Math.max(0, Math.min(stock[key], Math.floor(n)));
    }
    return stock;
}

function loadSnapshots(saved: unknown): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    if (!saved || typeof saved !== 'object') return out;
    for (const [hash, keys] of Object.entries(saved as Record<string, unknown>)) {
        if (Array.isArray(keys) && keys.every((k) => typeof k === 'string')) out[hash] = keys as string[];
    }
    return out;
}

function load(now: number): PreviewState {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return freshState(now);
        const saved = JSON.parse(raw);
        if (!saved || saved.v !== STORAGE_VERSION || typeof saved.walletThb !== 'number' || typeof saved.clientSeed !== 'string') return freshState(now);
        return {
            hydrated: true,
            walletThb: saved.walletThb,
            coins: typeof saved.coins === 'number' ? saved.coins : START_COINS,
            verification: { ...NO_VERIFICATION, ...(saved.verification ?? {}) },
            clientSeed: saved.clientSeed,
            ledger: Array.isArray(saved.ledger) ? saved.ledger : [],
            cashouts: Array.isArray(saved.cashouts) ? saved.cashouts : [],
            // A pool refresh can drop slabs a saved pull still names.
            pulls: (Array.isArray(saved.pulls) ? saved.pulls : []).filter((p: Pull) => !!getSlab(p.slabKey) && !!p.proof),
            feed: (Array.isArray(saved.feed) ? saved.feed : []).filter((e: FeedEvent) => !!getSlab(e.slabKey)),
            settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
            stats: { ...SERVER_STATE.stats, ...(saved.stats ?? {}) },
            stock: mergeStock(saved.stock),
            stockSnapshots: loadSnapshots(saved.stockSnapshots),
        };
    } catch {
        return freshState(now);
    }
}

function entry(kind: LedgerKind, thb: number, at: number, ref?: string): LedgerEntry {
    return { id: `${kind}-${at}-${Math.floor(Math.random() * 1e6)}`, at, kind, thb, ref };
}

function withLedger(s: PreviewState, e: LedgerEntry): LedgerEntry[] {
    return [e, ...s.ledger].slice(0, LEDGER_CAP);
}

// ── Derived money rules ─────────────────────────────────────────────────────

/**
 * Credit that may be withdrawn now: sell-back credit older than the holding
 * period, less what has already been requested, and never more than the
 * wallet holds.
 */
export function withdrawableThb(s: PreviewState, now: number): number {
    const cutoff = now - CASHOUT_HOLD_DAYS * DAY_MS;
    let aged = 0;
    for (const e of s.ledger) if (e.kind === 'sellback' && e.at <= cutoff) aged += e.thb;
    let requested = 0;
    for (const c of s.cashouts) requested += c.amountThb;
    return Math.max(0, Math.min(s.walletThb, aged - requested));
}

/** Cash requested in the rolling 30 days, against the monthly cap. */
export function cashedOutThisMonthThb(s: PreviewState, now: number): number {
    const since = now - 30 * DAY_MS;
    let sum = 0;
    for (const c of s.cashouts) if (c.at >= since) sum += c.amountThb;
    return sum;
}

export type CashoutBlock = 'verification' | 'min' | 'hold' | 'cap';

/** Why a withdrawal of `amount` cannot go ahead, or null when it can. */
export function cashoutBlocker(s: PreviewState, amountThb: number, now: number): CashoutBlock | null {
    if (missingVerification(s.verification, CASHOUT_REQUIRES).length) return 'verification';
    if (amountThb < CASHOUT_MIN_THB) return 'min';
    if (amountThb > withdrawableThb(s, now)) return 'hold';
    if (cashedOutThisMonthThb(s, now) + amountThb > CASHOUT_MONTHLY_CAP_THB) return 'cap';
    return null;
}

/** What shipping a vaulted slab costs: the flat fee, plus insurance when chosen. */
export function shippingQuote(pull: Pull, insure: boolean): { feeThb: number; insuranceThb: number; totalThb: number } {
    const value = getSlab(pull.slabKey)?.valueThb ?? 0;
    const ins = insure ? insuranceThb(value) : 0;
    return { feeThb: SHIP_FEE_THB, insuranceThb: ins, totalThb: SHIP_FEE_THB + ins };
}

/**
 * The card the buyer pulled most recently: the last pack of their newest
 * order. Pulls are kept newest order first, each order in the sequence it
 * was drawn, and an order's pulls share one timestamp.
 */
function lastPulledKey(pulls: readonly Pull[]): string | null {
    if (!pulls.length) return null;
    let k = 0;
    while (k + 1 < pulls.length && pulls[k + 1].at === pulls[0].at) k += 1;
    return pulls[k].slabKey;
}

export type BuyResult =
    | { ok: true; pulls: Pull[] }
    | { ok: false; reason: 'loading' | 'wallet' | 'coins' | 'unavailable' };

export const previewActions = {
    /** Read saved state (or seed a fresh preview). Call once, after mount. */
    hydrate() {
        if (state.hydrated || typeof window === 'undefined') return;
        set(load(Date.now()));
    },

    /**
     * Buy `count` packs of a game's tier. Atomic: the payment, the draws, the
     * stock taken and the new pulls all land together or not at all. The
     * pulls come back unrevealed and are already owned — closing the app
     * mid-reveal loses nothing. A card payment is simulated as instant.
     *
     * Packs are drawn one at a time from the stock that is left, with the
     * buyer's own repeats left out (nothing already pulled in this order,
     * and not the card they pulled last: engine.ts poolWithoutRepeats). Each
     * pull records the fingerprint of the pool its table was built from. If
     * the floor runs dry mid-order, the buyer gets (and pays for) the packs
     * that could be drawn.
     */
    buy(game: GameKey, tierKey: TierKey, count: number, method: PaymentMethod): BuyResult {
        const s = state;
        if (!s.hydrated) return { ok: false, reason: 'loading' };
        if (!tryTable(game, tierKey)) return { ok: false, reason: 'unavailable' };
        const tier = TIERS[tierKey];
        const asked = Math.max(1, Math.floor(count));
        const now = Date.now();

        const stock = { ...s.stock };
        const snapshots = { ...s.stockSnapshots };
        const pulls: Pull[] = [];
        const drawn: string[] = [];
        let previous = lastPulledKey(s.pulls);
        for (let i = 0; i < asked; i++) {
            const pool = poolWithoutRepeats(stockPool(game, stock), tier, drawn, previous);
            const table = tableFor(game, tierKey, pool);
            if (!table) break;
            const hash = poolFingerprint(pool);
            if (!snapshots[hash]) {
                snapshots[hash] = pool.map((x) => x.key);
                const hashes = Object.keys(snapshots);
                for (const old of hashes.slice(0, Math.max(0, hashes.length - SNAPSHOT_CAP))) delete snapshots[old];
            }
            const seed = newSeed();
            const d = draw(table, seed, s.clientSeed);
            stock[d.slabKey] = Math.max(0, (stock[d.slabKey] ?? 0) - 1);
            drawn.push(d.slabKey);
            previous = d.slabKey;
            pulls.push({
                id: `${game}-${tierKey}-${now}-${i}`,
                slabKey: d.slabKey, tier: tierKey, cls: d.cls,
                pricePaidThb: tier.priceThb, at: now, status: 'unrevealed',
                proof: { commit: commitFor(seed), seed, clientSeed: s.clientSeed },
                stockHash: hash,
            });
        }
        if (!pulls.length) return { ok: false, reason: 'unavailable' };
        const n = pulls.length;
        const cost = n * tier.priceThb;

        let walletThb = s.walletThb;
        let coins = s.coins;
        let ledger = s.ledger;
        if (method === 'wallet') {
            if (walletThb < cost) return { ok: false, reason: 'wallet' };
            walletThb -= cost;
            ledger = withLedger(s, entry('pack', -cost, now));
        } else if (method === 'coins') {
            const need = coinsForThb(cost);
            if (coins < need) return { ok: false, reason: 'coins' };
            coins -= need;
        } else {
            // Card: the purchase earns coins, like any marketplace order.
            coins += Math.floor(cost * COINS_EARNED_PER_THB);
        }

        set({
            ...s,
            walletThb,
            coins,
            ledger,
            pulls: [...pulls, ...s.pulls].slice(0, PULL_CAP),
            stock,
            stockSnapshots: snapshots,
            stats: { ...s.stats, packs: s.stats.packs + n, spentThb: s.stats.spentThb + cost },
        });
        return { ok: true, pulls };
    },

    /** Flip a pull face-up: it joins the vault, the collection and the public feed. */
    reveal(pullId: string) {
        const pull = state.pulls.find((p) => p.id === pullId);
        if (!pull || pull.status !== 'unrevealed') return;
        const value = getSlab(pull.slabKey)?.valueThb ?? 0;
        const event: FeedEvent = { id: pull.id, who: ME, me: true, slabKey: pull.slabKey, tier: pull.tier, cls: pull.cls, at: Date.now() };
        set({
            ...state,
            pulls: state.pulls.map((p) => (p.id === pullId ? { ...p, status: 'vault' as const } : p)),
            feed: [event, ...state.feed].slice(0, FEED_CAP),
            stats: { ...state.stats, pulledThb: state.stats.pulledThb + value },
        });
    },

    /** Instant sell-back to wallet credit. The card is the house's again and goes back into stock. Returns the baht credited. */
    sell(pullIds: readonly string[]): number {
        const now = Date.now();
        let credited = 0;
        let ledger = state.ledger;
        const stock = { ...state.stock };
        const pulls = state.pulls.map((p) => {
            if (!pullIds.includes(p.id) || (p.status !== 'vault' && p.status !== 'unrevealed' && p.status !== 'listed')) return p;
            const paid = sellBackThb(getSlab(p.slabKey)?.valueThb ?? 0, TIERS[p.tier]);
            credited += paid;
            ledger = [entry('sellback', paid, now, p.id), ...ledger].slice(0, LEDGER_CAP);
            if (p.slabKey in stock) stock[p.slabKey] += 1;
            return { ...p, status: 'sold' as const, soldForThb: paid, listPriceThb: undefined, listedAt: undefined };
        });
        if (credited === 0) return 0;
        set({
            ...state,
            pulls,
            ledger,
            stock,
            walletThb: state.walletThb + credited,
            stats: { ...state.stats, soldBackThb: state.stats.soldBackThb + credited },
        });
        return credited;
    },

    /** Put a vaulted slab on the Cardstreet marketplace at `priceThb`. Cardstreet ships from the vault when it sells. */
    list(pullId: string, priceThb: number) {
        const price = Math.max(1, Math.floor(priceThb));
        set({
            ...state,
            pulls: state.pulls.map((p) => (p.id === pullId && p.status === 'vault' ? { ...p, status: 'listed' as const, listPriceThb: price, listedAt: Date.now() } : p)),
        });
    },

    unlist(pullId: string) {
        set({
            ...state,
            pulls: state.pulls.map((p) => (p.id === pullId && p.status === 'listed' ? { ...p, status: 'vault' as const, listPriceThb: undefined, listedAt: undefined } : p)),
        });
    },

    /**
     * Book a shipment for a vaulted slab, paid up front: the flat fee plus
     * insurance when chosen, from the wallet when it covers the total,
     * otherwise by (simulated) card. Records where it goes.
     */
    requestShipping(pullId: string, opts: { method: 'wallet' | 'card'; shipTo: ShipTo; insure: boolean }): boolean {
        const s = state;
        const pull = s.pulls.find((p) => p.id === pullId);
        if (!pull || pull.status !== 'vault') return false;
        const quote = shippingQuote(pull, opts.insure);
        const now = Date.now();
        let walletThb = s.walletThb;
        let ledger = s.ledger;
        if (opts.method === 'wallet') {
            if (walletThb < quote.totalThb) return false;
            walletThb -= quote.totalThb;
            ledger = withLedger(s, entry('ship_fee', -quote.totalThb, now, pullId));
        }
        set({
            ...s,
            walletThb,
            ledger,
            pulls: s.pulls.map((p) =>
                p.id === pullId
                    ? { ...p, status: 'shipping' as const, shipRequestedAt: now, shipFeeThb: quote.totalThb, shipInsuredThb: opts.insure ? quote.insuranceThb : 0, shipTo: opts.shipTo }
                    : p,
            ),
        });
        return true;
    },

    /** Turn wallet credit into a bank transfer request. Returns the blocker, or null when it went through. */
    requestCashout(amountThb: number): CashoutBlock | null {
        const s = state;
        const now = Date.now();
        const amount = Math.floor(amountThb);
        const block = cashoutBlocker(s, amount, now);
        if (block) return block;
        const fee = cashoutFeeThb(amount);
        const req: CashoutRequest = {
            id: `co-${now}`,
            at: now,
            amountThb: amount,
            feeThb: fee,
            netThb: amount - fee,
            status: 'pending',
            expectedAt: addBusinessDays(now, CASHOUT_BUSINESS_DAYS[1]),
        };
        set({
            ...s,
            walletThb: s.walletThb - amount,
            ledger: withLedger(s, entry('cashout', -amount, now, req.id)),
            cashouts: [req, ...s.cashouts],
        });
        return null;
    },

    /** The mock KYC sheet's outcome: the real one is a vendor review. */
    verify(kind: VerificationKind) {
        set({ ...state, verification: { ...state.verification, [kind]: true } });
    },

    setSetting<K extends keyof PreviewSettings>(key: K, value: PreviewSettings[K]) {
        set({ ...state, settings: { ...state.settings, [key]: value } });
    },

    /** Wipe the preview and start again with an empty wallet and vault, and every card back in stock. */
    reset() {
        set(freshState(Date.now(), state.settings));
    },

    /**
     * One beat of simulated activity. Called on an interval while the lobby is
     * open; most beats do nothing, so pulls arrive in uneven bursts.
     */
    tick() {
        if (!state.hydrated || !state.settings.activity) return;
        if (Math.random() > 0.4) return;
        const now = Date.now();
        const n = pick([1, 1, 1, 1, 2, 3]);
        const who = pick(BOT_NAMES);
        const events: FeedEvent[] = [];
        for (let i = 0; i < n; i++) {
            const e = botEvent(who, now - i);
            if (e) events.push(e);
        }
        if (events.length) set({ ...state, feed: [...events, ...state.feed].slice(0, FEED_CAP) });
    },
};

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function usePreviewState(): PreviewState {
    return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Current state outside React (event handlers, timers). */
export function getPreviewState(): PreviewState {
    return state;
}
