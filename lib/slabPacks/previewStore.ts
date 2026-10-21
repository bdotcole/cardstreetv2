'use client';

/**
 * Slab Packs — PREVIEW state for the admin-wall prototype.
 *
 * There is no backend yet: no inventory, no wallet, no payment. This store
 * stands in for all three so the mechanics and the design can be played end
 * to end. Everything lives in this browser's localStorage:
 *
 *   - credits are play money (topped up for free in the preview menu)
 *   - each tier's sealed series is built by the real engine from the preview
 *     slab pool, and runs out exactly the way a real one would
 *   - "other collectors" are simulated so the finite-pool behaviour (packs
 *     left, a chase slab getting claimed by someone else) is visible; they
 *     are labelled as simulated in the UI and switch off in the preview menu
 *
 * The seam for the real build: `buy` becomes one server call that moves the
 * series pointer under a row lock and returns the pulls; `sell` becomes a
 * wallet credit. The components read this module's state shape and nothing
 * else, so they do not change.
 */

import { useSyncExternalStore } from 'react';
import { buildSeries, drawNext } from './engine';
import { PREVIEW_POOL, getSlab, poolIndex } from './pool';
import { TIER_ORDER, TIERS, classify, sellBackThb } from './tiers';
import type { FeedEvent, HitClass, Pull, SeriesState, TierKey } from './types';

const STORAGE_KEY = 'cs_slab_packs_preview_v1';
const FEED_CAP = 40;
const PULL_CAP = 400;
const SEALED_CAP = 6;

export const START_CREDITS = 150_000;
export const TOP_UP_THB = 100_000;
export const ME = 'you';

export interface PreviewSettings {
    sound: boolean;
    haptics: boolean;
    /** Skip the build-up and go straight to the reveal. */
    fast: boolean;
    /** Simulated other collectors buying from the same series. */
    activity: boolean;
}

/** A finished series, with the seed now public so its commit can be checked. */
export interface SealedRecord {
    tier: TierKey;
    number: number;
    seed: string;
    commit: string;
    manifest: string[];
    bonusKey: string | null;
    soldOutAt: number;
}

export interface PreviewStats {
    packs: number;
    spentThb: number;
    pulledThb: number;
    soldBackThb: number;
}

export interface PreviewState {
    hydrated: boolean;
    credits: number;
    series: Record<TierKey, SeriesState> | null;
    sealed: SealedRecord[];
    pulls: Pull[];
    feed: FeedEvent[];
    settings: PreviewSettings;
    stats: PreviewStats;
}

const DEFAULT_SETTINGS: PreviewSettings = { sound: true, haptics: true, fast: false, activity: true };

const SERVER_STATE: PreviewState = {
    hydrated: false,
    credits: 0,
    series: null,
    sealed: [],
    pulls: [],
    feed: [],
    settings: DEFAULT_SETTINGS,
    stats: { packs: 0, spentThb: 0, pulledThb: 0, soldBackThb: 0 },
};

let state: PreviewState = SERVER_STATE;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
    for (const l of listeners) l();
}

function persist() {
    if (typeof window === 'undefined' || !state.hydrated) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const { credits, series, sealed, pulls, feed, settings, stats } = state;
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, credits, series, sealed, pulls, feed, settings, stats }));
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
    ['spark', 5], ['surge', 3], ['nova', 2], ['eclipse', 1], ['apex', 0.5],
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
    return 'spark';
}

interface DrawOutcome {
    state: PreviewState;
    drawn: { index: number; slabKey: string; cls: HitClass }[];
    bonusKey: string | null;
    seriesNumber: number;
}

/**
 * Move a series forward by `count` packs for one buyer, rolling to a freshly
 * sealed series when it sells out. A simulated collector's pulls go straight
 * to the feed; the admin's own do not (they join the feed at reveal, so the
 * ticker cannot spoil a slab that has not been flipped yet).
 */
function applyDraw(s: PreviewState, tierKey: TierKey, count: number, who: string, me: boolean, now: number): DrawOutcome {
    const tier = TIERS[tierKey];
    const current = s.series![tierKey];
    const res = drawNext(current, tier, poolIndex(), count, who, me, now);

    let series = { ...s.series!, [tierKey]: res.series };
    let sealed = s.sealed;
    if (res.soldOut) {
        sealed = [
            { tier: tierKey, number: current.number, seed: current.seed, commit: current.commit, manifest: current.manifest, bonusKey: current.bonusKey, soldOutAt: now },
            ...s.sealed,
        ].slice(0, SEALED_CAP);
        series = { ...series, [tierKey]: buildSeries(tier, PREVIEW_POOL, newSeed(), current.number + 1, now) };
    }

    let feed = s.feed;
    if (!me) {
        const events: FeedEvent[] = res.drawn.map((d) => ({
            id: `${tierKey}-${current.number}-${d.index}`,
            who, me, slabKey: d.slabKey, tier: tierKey, cls: d.cls, at: now,
        }));
        if (res.bonusKey) {
            events.push({
                id: `${tierKey}-${current.number}-bonus`,
                who, me, slabKey: res.bonusKey, tier: tierKey,
                cls: classify(getSlab(res.bonusKey)?.valueThb ?? 0, tier.priceThb) ?? 'a',
                at: now, bonus: true,
            });
        }
        feed = [...events.reverse(), ...s.feed].slice(0, FEED_CAP);
    }

    return { state: { ...s, series, sealed, feed }, drawn: res.drawn, bonusKey: res.bonusKey, seriesNumber: current.number };
}

function freshState(now: number): PreviewState {
    const series = {} as Record<TierKey, SeriesState>;
    for (const key of TIER_ORDER) series[key] = buildSeries(TIERS[key], PREVIEW_POOL, newSeed(), 1, now);
    let s: PreviewState = {
        hydrated: true,
        credits: START_CREDITS,
        series,
        sealed: [],
        pulls: [],
        feed: [],
        settings: DEFAULT_SETTINGS,
        stats: { packs: 0, spentThb: 0, pulledThb: 0, soldBackThb: 0 },
    };
    // Open each series part-sold, with the buying spread over the last hour,
    // so the pool reads as one already in play rather than untouched.
    for (const key of TIER_ORDER) {
        const size = TIERS[key].seriesSize;
        let toSell = Math.floor(size * (0.12 + Math.random() * 0.3));
        while (toSell > 0) {
            const n = Math.min(toSell, pick([1, 1, 1, 3, 5]));
            s = applyDraw(s, key, n, pick(BOT_NAMES), false, now - Math.floor(Math.random() * 3_600_000)).state;
            toSell -= n;
        }
    }
    s.feed = [...s.feed].sort((a, b) => b.at - a.at).slice(0, FEED_CAP);
    return s;
}

function isSeriesUsable(series: unknown, tier: TierKey): series is SeriesState {
    const x = series as SeriesState | undefined;
    if (!x || x.tier !== tier || !Array.isArray(x.manifest) || typeof x.next !== 'number') return false;
    if (x.manifest.length !== TIERS[tier].seriesSize) return false;
    // A pool refresh can drop slabs a saved manifest still names.
    return x.manifest.every((key) => !!getSlab(key));
}

function load(now: number): PreviewState {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return freshState(now);
        const saved = JSON.parse(raw);
        if (!saved || saved.v !== 1 || typeof saved.credits !== 'number' || !saved.series) return freshState(now);

        const series = {} as Record<TierKey, SeriesState>;
        for (const key of TIER_ORDER) {
            series[key] = isSeriesUsable(saved.series[key], key)
                ? saved.series[key]
                : buildSeries(TIERS[key], PREVIEW_POOL, newSeed(), 1, now);
        }
        return {
            hydrated: true,
            credits: saved.credits,
            series,
            sealed: (Array.isArray(saved.sealed) ? saved.sealed : []).filter((r: SealedRecord) => Array.isArray(r?.manifest)),
            pulls: (Array.isArray(saved.pulls) ? saved.pulls : []).filter((p: Pull) => !!getSlab(p.slabKey)),
            feed: (Array.isArray(saved.feed) ? saved.feed : []).filter((e: FeedEvent) => !!getSlab(e.slabKey)),
            settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
            stats: { ...SERVER_STATE.stats, ...(saved.stats ?? {}) },
        };
    } catch {
        return freshState(now);
    }
}

export type BuyResult =
    | { ok: true; pulls: Pull[] }
    | { ok: false; reason: 'loading' | 'soldout' | 'credits' };

export const previewActions = {
    /** Read saved state (or seed a fresh preview). Call once, after mount. */
    hydrate() {
        if (state.hydrated || typeof window === 'undefined') return;
        set(load(Date.now()));
    },

    /**
     * Buy `count` packs of a tier. Atomic: credits, the series pointer and the
     * new pulls all move together or not at all. The pulls come back
     * unrevealed and are already owned — closing the app mid-reveal loses
     * nothing.
     */
    buy(tierKey: TierKey, count: number): BuyResult {
        const s = state;
        if (!s.hydrated || !s.series) return { ok: false, reason: 'loading' };
        const tier = TIERS[tierKey];
        const left = s.series[tierKey].manifest.length - s.series[tierKey].next;
        const n = Math.min(Math.max(1, Math.floor(count)), left);
        if (n <= 0) return { ok: false, reason: 'soldout' };
        const cost = n * tier.priceThb;
        if (s.credits < cost) return { ok: false, reason: 'credits' };

        const now = Date.now();
        const out = applyDraw(s, tierKey, n, ME, true, now);
        const pulls: Pull[] = out.drawn.map((d) => ({
            id: `${tierKey}-${out.seriesNumber}-${d.index}`,
            slabKey: d.slabKey, tier: tierKey, series: out.seriesNumber, index: d.index, cls: d.cls,
            pricePaidThb: tier.priceThb, at: now, status: 'unrevealed',
        }));
        if (out.bonusKey) {
            pulls.push({
                id: `${tierKey}-${out.seriesNumber}-bonus`,
                slabKey: out.bonusKey, tier: tierKey, series: out.seriesNumber, index: -1,
                cls: classify(getSlab(out.bonusKey)?.valueThb ?? 0, tier.priceThb) ?? 'a',
                pricePaidThb: 0, at: now, status: 'unrevealed', bonus: true,
            });
        }
        set({
            ...out.state,
            credits: s.credits - cost,
            pulls: [...pulls, ...out.state.pulls].slice(0, PULL_CAP),
            stats: { ...s.stats, packs: s.stats.packs + n, spentThb: s.stats.spentThb + cost },
        });
        return { ok: true, pulls };
    },

    /** Flip a pull face-up: it joins the vault and the public feed. */
    reveal(pullId: string) {
        const pull = state.pulls.find((p) => p.id === pullId);
        if (!pull || pull.status !== 'unrevealed') return;
        const value = getSlab(pull.slabKey)?.valueThb ?? 0;
        const event: FeedEvent = {
            id: pull.id, who: ME, me: true, slabKey: pull.slabKey, tier: pull.tier, cls: pull.cls, at: Date.now(), bonus: pull.bonus,
        };
        set({
            ...state,
            pulls: state.pulls.map((p) => (p.id === pullId ? { ...p, status: 'vault' as const } : p)),
            feed: [event, ...state.feed].slice(0, FEED_CAP),
            stats: { ...state.stats, pulledThb: state.stats.pulledThb + value },
        });
    },

    /** Instant sell-back to credit. Returns the baht credited. */
    sell(pullIds: readonly string[]): number {
        let credited = 0;
        const pulls = state.pulls.map((p) => {
            if (!pullIds.includes(p.id) || (p.status !== 'vault' && p.status !== 'unrevealed')) return p;
            const paid = sellBackThb(getSlab(p.slabKey)?.valueThb ?? 0, TIERS[p.tier]);
            credited += paid;
            return { ...p, status: 'sold' as const, soldForThb: paid };
        });
        if (credited === 0) return 0;
        set({
            ...state,
            pulls,
            credits: state.credits + credited,
            stats: { ...state.stats, soldBackThb: state.stats.soldBackThb + credited },
        });
        return credited;
    },

    requestShipping(pullId: string) {
        set({
            ...state,
            pulls: state.pulls.map((p) => (p.id === pullId && p.status === 'vault' ? { ...p, status: 'shipping' as const } : p)),
        });
    },

    addCredits(thb: number) {
        set({ ...state, credits: state.credits + Math.max(0, Math.floor(thb)) });
    },

    setSetting<K extends keyof PreviewSettings>(key: K, value: PreviewSettings[K]) {
        set({ ...state, settings: { ...state.settings, [key]: value } });
    },

    /** Wipe the preview and start again with fresh series and credits. */
    reset() {
        const settings = state.settings;
        set({ ...freshState(Date.now()), settings });
    },

    /**
     * One beat of simulated activity. Called on an interval while the lobby is
     * open; most beats do nothing, so buying arrives in uneven bursts.
     */
    tick() {
        if (!state.hydrated || !state.series || !state.settings.activity) return;
        if (Math.random() > 0.4) return;
        const tierKey = pickBotTier();
        const left = state.series[tierKey].manifest.length - state.series[tierKey].next;
        if (left <= 0) return;
        const n = Math.min(left, pick([1, 1, 1, 1, 3, 3, 5]));
        set(applyDraw(state, tierKey, n, pick(BOT_NAMES), false, Date.now()).state);
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
