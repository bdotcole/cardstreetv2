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
 *   - identity / address / bank verification are flags the mock KYC sheet
 *     flips after a short "review"
 *   - "other collectors" are simulated so the feed moves; they are labelled
 *     as simulated in the UI and switch off in the preview menu
 *
 * The seam for the real build: `buy` becomes one server call that charges
 * the card, draws with a server-held seed and returns the pulls with their
 * commits; `sell`, `list`, `requestShipping` and `requestCashout` become
 * wallet / listing / fulfilment / payout rows. The components read this
 * module's state shape and nothing else.
 */

import { useSyncExternalStore } from 'react';
import { buildTable, commitFor, draw } from './engine';
import {
    CASHOUT_BUSINESS_DAYS, CASHOUT_HOLD_DAYS, CASHOUT_MIN_THB, CASHOUT_MONTHLY_CAP_THB, CASHOUT_REQUIRES,
    COINS_EARNED_PER_THB, DAY_MS, NO_VERIFICATION, SHIP_FEE_THB, SHIP_REQUIRES,
    addBusinessDays, cashoutFeeThb, coinsForThb, missingVerification,
    type Verification, type VerificationKind,
} from './policy';
import { PREVIEW_POOL, getSlab } from './pool';
import { TIER_ORDER, TIERS, sellBackThb } from './tiers';
import type { FeedEvent, PackTable, Pull, TierKey } from './types';

const STORAGE_KEY = 'cs_slab_packs_preview_v3';
const FEED_CAP = 40;
const PULL_CAP = 400;
const LEDGER_CAP = 300;

/** Demo coin balance standing in for rewards.coin_balance (1 coin = 1 satang). */
export const START_COINS = 5000;
export const ME = 'you';

export type PaymentMethod = 'card' | 'wallet' | 'coins';

export interface PreviewSettings {
    sound: boolean;
    haptics: boolean;
    /** Skip the build-up and go straight to the reveal. */
    fast: boolean;
    /** Simulated other collectors pulling from the same packs. */
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
}

const DEFAULT_SETTINGS: PreviewSettings = { sound: true, haptics: true, fast: false, activity: true };

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
};

let state: PreviewState = SERVER_STATE;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// The published tables, one per tier, built once from the preview pool.
let tables: Record<TierKey, PackTable> | null = null;
export function getTable(tier: TierKey): PackTable {
    if (!tables) {
        tables = {} as Record<TierKey, PackTable>;
        for (const key of TIER_ORDER) tables[key] = buildTable(TIERS[key], PREVIEW_POOL);
    }
    return tables[tier];
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
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 3, ...rest }));
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

// Cheaper packs move faster, as they would.
const BOT_TIER_WEIGHTS: [TierKey, number][] = [
    ['silver', 6], ['gold', 4], ['platinum', 3], ['emerald', 2], ['diamond', 1], ['opal', 0.5],
];

function pick<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function pickBotTier(): TierKey {
    const total = BOT_TIER_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [key, w] of BOT_TIER_WEIGHTS) {
        r -= w;
        if (r <= 0) return key;
    }
    return 'silver';
}

/** A simulated collector's pull: a real draw from the table, straight to the feed. */
function botEvent(tierKey: TierKey, who: string, at: number): FeedEvent {
    const d = draw(getTable(tierKey), newSeed(), who);
    return { id: `bot-${tierKey}-${at}-${Math.floor(Math.random() * 1e6)}`, who, me: false, slabKey: d.slabKey, tier: tierKey, cls: d.cls, at };
}

function freshState(now: number): PreviewState {
    const feed: FeedEvent[] = [];
    // The feed opens already moving, spread over the last hour.
    for (let i = 0; i < 14; i++) feed.push(botEvent(pickBotTier(), pick(BOT_NAMES), now - Math.floor(Math.random() * 3_600_000)));
    feed.sort((a, b) => b.at - a.at);
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
        settings: DEFAULT_SETTINGS,
        stats: { packs: 0, spentThb: 0, pulledThb: 0, soldBackThb: 0 },
    };
}

function load(now: number): PreviewState {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return freshState(now);
        const saved = JSON.parse(raw);
        if (!saved || saved.v !== 3 || typeof saved.walletThb !== 'number' || typeof saved.clientSeed !== 'string') return freshState(now);
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

export type BuyResult =
    | { ok: true; pulls: Pull[] }
    | { ok: false; reason: 'loading' | 'wallet' | 'coins' };

export const previewActions = {
    /** Read saved state (or seed a fresh preview). Call once, after mount. */
    hydrate() {
        if (state.hydrated || typeof window === 'undefined') return;
        set(load(Date.now()));
    },

    /**
     * Buy `count` packs of a tier. Atomic: the payment, the draws and the new
     * pulls all land together or not at all. The pulls come back unrevealed
     * and are already owned — closing the app mid-reveal loses nothing.
     * A card payment is simulated as instant.
     */
    buy(tierKey: TierKey, count: number, method: PaymentMethod): BuyResult {
        const s = state;
        if (!s.hydrated) return { ok: false, reason: 'loading' };
        const tier = TIERS[tierKey];
        const n = Math.max(1, Math.floor(count));
        const cost = n * tier.priceThb;
        const now = Date.now();

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

        const table = getTable(tierKey);
        const pulls: Pull[] = [];
        for (let i = 0; i < n; i++) {
            const seed = newSeed();
            const d = draw(table, seed, s.clientSeed);
            pulls.push({
                id: `${tierKey}-${now}-${i}`,
                slabKey: d.slabKey, tier: tierKey, cls: d.cls,
                pricePaidThb: tier.priceThb, at: now, status: 'unrevealed',
                proof: { commit: commitFor(seed), seed, clientSeed: s.clientSeed },
            });
        }
        set({
            ...s,
            walletThb,
            coins,
            ledger,
            pulls: [...pulls, ...s.pulls].slice(0, PULL_CAP),
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

    /** Instant sell-back to wallet credit. Returns the baht credited. */
    sell(pullIds: readonly string[]): number {
        const now = Date.now();
        let credited = 0;
        let ledger = state.ledger;
        const pulls = state.pulls.map((p) => {
            if (!pullIds.includes(p.id) || (p.status !== 'vault' && p.status !== 'unrevealed' && p.status !== 'listed')) return p;
            const paid = sellBackThb(getSlab(p.slabKey)?.valueThb ?? 0, TIERS[p.tier]);
            credited += paid;
            ledger = [entry('sellback', paid, now, p.id), ...ledger].slice(0, LEDGER_CAP);
            return { ...p, status: 'sold' as const, soldForThb: paid, listPriceThb: undefined, listedAt: undefined };
        });
        if (credited === 0) return 0;
        set({
            ...state,
            pulls,
            ledger,
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

    /** What a shipment still needs before it can be requested. */
    shippingBlockers(): VerificationKind[] {
        return missingVerification(state.verification, SHIP_REQUIRES);
    },

    /**
     * Ask for a vaulted slab to be shipped. The flat fee is paid from the
     * wallet when it covers it, otherwise by (simulated) card.
     */
    requestShipping(pullId: string, method: 'wallet' | 'card'): boolean {
        const s = state;
        if (missingVerification(s.verification, SHIP_REQUIRES).length) return false;
        const pull = s.pulls.find((p) => p.id === pullId);
        if (!pull || pull.status !== 'vault') return false;
        const now = Date.now();
        let walletThb = s.walletThb;
        let ledger = s.ledger;
        if (method === 'wallet') {
            if (walletThb < SHIP_FEE_THB) return false;
            walletThb -= SHIP_FEE_THB;
            ledger = withLedger(s, entry('ship_fee', -SHIP_FEE_THB, now, pullId));
        }
        set({
            ...s,
            walletThb,
            ledger,
            pulls: s.pulls.map((p) => (p.id === pullId ? { ...p, status: 'shipping' as const, shipRequestedAt: now, shipFeeThb: SHIP_FEE_THB } : p)),
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

    /** Wipe the preview and start again with an empty wallet and vault. */
    reset() {
        const settings = state.settings;
        set({ ...freshState(Date.now()), settings });
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
        const tierKey = pickBotTier();
        const events: FeedEvent[] = [];
        for (let i = 0; i < n; i++) events.push(botEvent(tierKey, who, now - i));
        set({ ...state, feed: [...events, ...state.feed].slice(0, FEED_CAP) });
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
