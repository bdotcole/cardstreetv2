/**
 * Slab Packs — the mechanics, as pure functions over plain data.
 *
 * The model is a SEALED SERIES, not a per-pull roll. A series is a fixed list
 * of real slabs, shuffled once when it opens. Buying a pack takes the next
 * slab off that list. Three things follow, and they are the reason for the
 * design:
 *
 *  1. Nothing is decided at purchase time. The slab in pack #37 was fixed
 *     when the series was sealed, and the commit hash published at that
 *     moment lets anyone check it afterwards (verifySeries).
 *  2. The odds shown are a count of what is still sealed, so they can never
 *     drift from the truth the way a published percentage does once a chase
 *     card has been pulled.
 *  3. The house's result on a series is known when it is built: packs sold
 *     x price, against the cost of exactly these slabs. No pull variance.
 *
 * Everything here is deterministic given its inputs, so the same code can
 * run in the browser preview today and inside a route handler later, where
 * the manifest lives in a table and `next` moves under a row lock.
 */

import { CHASE_CLASSES, HIT_CLASSES, HIT_ORDER, LAST_PACK_BONUS_CLASS, TARGET_EV, classify } from './tiers';
import type { HitClass, PackTier, SeriesClaim, SeriesState, SeriesSummary, Slab } from './types';

// ── Hashing + seeded randomness ─────────────────────────────────────────────

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/**
 * Synchronous SHA-256. Web Crypto's digest is async and unavailable outside a
 * secure context; a sync one keeps the engine pure and usable from a script.
 */
export function sha256Hex(message: string): string {
    const data = new TextEncoder().encode(message);
    const padLen = ((data.length + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padLen);
    buf.set(data);
    buf[data.length] = 0x80;
    const view = new DataView(buf.buffer);
    const bitLen = data.length * 8;
    view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));
    view.setUint32(padLen - 4, bitLen >>> 0);

    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const w = new Uint32Array(64);
    for (let off = 0; off < padLen; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) >>> 0;
            hh = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

function xmur3(str: string): () => number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    };
}

/** Deterministic PRNG in [0, 1) from a string seed (mulberry32 over an xmur3 hash). */
export function makeRng(seed: string): () => number {
    let a = xmur3(seed)();
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Building a series ───────────────────────────────────────────────────────

export function indexPool(pool: readonly Slab[]): Map<string, Slab> {
    const map = new Map<string, Slab>();
    for (const slab of pool) map.set(slab.key, slab);
    return map;
}

/** The pool split by the class each slab would be in THIS tier, cheapest first. */
export function poolByClass(pool: readonly Slab[], tier: PackTier): Record<HitClass, Slab[]> {
    const out: Record<HitClass, Slab[]> = { d: [], c: [], b: [], a: [], s: [], ss: [] };
    for (const slab of pool) {
        const cls = classify(slab.valueThb, tier.priceThb);
        if (cls) out[cls].push(slab);
    }
    for (const cls of HIT_ORDER) out[cls].sort((x, y) => x.valueThb - y.valueThb || x.key.localeCompare(y.key));
    return out;
}

/**
 * Take `n` slabs from one class. `bias` leans the draw toward the cheap end
 * of the band (0 = uniform). Copies of a slab only repeat once every distinct
 * candidate has been used, which is how real inventory behaves: several
 * PSA 10 copies of a common card, one of the chase.
 */
function sample(cands: readonly Slab[], n: number, bias: number, rng: () => number): Slab[] {
    const out: Slab[] = [];
    let bag: { slab: Slab; w: number }[] = [];
    const span = Math.max(1, cands.length - 1);
    while (out.length < n) {
        if (bag.length === 0) {
            bag = cands.map((slab, i) => ({ slab, w: Math.pow(1 - i / span, bias) + 0.04 }));
        }
        let total = 0;
        for (const b of bag) total += b.w;
        let r = rng() * total;
        let idx = 0;
        for (; idx < bag.length - 1; idx++) {
            r -= bag[idx].w;
            if (r <= 0) break;
        }
        out.push(bag[idx].slab);
        bag.splice(idx, 1);
    }
    return out;
}

/** How hard to lean cheap, tried in turn; the manifest nearest TARGET_EV wins. */
const BIASES = [0, 0.5, 1, 1.6, 2.4, 3.5, 5, 8];

function commitPayload(seed: string, manifest: readonly string[], bonusKey: string | null): string {
    return `${seed}|${manifest.join(',')}|${bonusKey ?? ''}`;
}

/**
 * Seal a new series for a tier. Deterministic in (tier, pool, seed): the same
 * three inputs always produce the same manifest, in the same order, with the
 * same commit — which is what makes the commit checkable.
 */
export function buildSeries(
    tier: PackTier,
    pool: readonly Slab[],
    seed: string,
    number: number,
    now: number,
): SeriesState {
    const byClass = poolByClass(pool, tier);
    for (const cls of HIT_ORDER) {
        if (tier.composition[cls] > 0 && byClass[cls].length === 0) {
            throw new Error(`[slabPacks] pool has no ${HIT_CLASSES[cls].letter} slabs for ${tier.key}`);
        }
    }

    let best: { picked: Slab[]; gap: number } | null = null;
    for (const bias of BIASES) {
        const rng = makeRng(`${seed}|pick|${bias}`);
        const picked: Slab[] = [];
        for (const cls of HIT_ORDER) picked.push(...sample(byClass[cls], tier.composition[cls], bias, rng));
        const ev = picked.reduce((sum, s) => sum + s.valueThb, 0) / picked.length / tier.priceThb;
        const gap = Math.abs(ev - TARGET_EV);
        if (!best || gap < best.gap) best = { picked, gap };
    }

    // Fisher-Yates with its own stream, so the order is independent of which
    // bias won.
    const manifest = best!.picked.map((s) => s.key);
    const order = makeRng(`${seed}|order`);
    for (let i = manifest.length - 1; i > 0; i--) {
        const j = Math.floor(order() * (i + 1));
        [manifest[i], manifest[j]] = [manifest[j], manifest[i]];
    }

    // The last-pack bonus comes from the cheaper half of its band: a real
    // reason to finish a picked-over series without moving the series EV much.
    const bonusCands = byClass[LAST_PACK_BONUS_CLASS];
    const bonusRng = makeRng(`${seed}|bonus`);
    const bonusKey = bonusCands.length
        ? bonusCands[Math.floor(bonusRng() * Math.max(1, Math.ceil(bonusCands.length / 2)))].key
        : null;

    return {
        tier: tier.key,
        number,
        seed,
        commit: sha256Hex(commitPayload(seed, manifest, bonusKey)),
        manifest,
        next: 0,
        bonusKey,
        claims: [],
        startedAt: now,
    };
}

/** Does a published commit match this seed, manifest and bonus? */
export function verifyCommit(seed: string, manifest: readonly string[], bonusKey: string | null, commit: string): boolean {
    return sha256Hex(commitPayload(seed, manifest, bonusKey)) === commit;
}

export function verifySeries(series: SeriesState): boolean {
    return verifyCommit(series.seed, series.manifest, series.bonusKey, series.commit);
}

// ── Reading a series ────────────────────────────────────────────────────────

export function summarizeSeries(series: SeriesState, tier: PackTier, index: Map<string, Slab>): SeriesSummary {
    const byClass = {} as SeriesSummary['byClass'];
    for (const cls of HIT_ORDER) byClass[cls] = { total: 0, left: 0 };

    let sumAll = 0;
    let sumLeft = 0;
    let floor = Infinity;
    let top = 0;
    series.manifest.forEach((key, i) => {
        const slab = index.get(key);
        if (!slab) return;
        const cls = classify(slab.valueThb, tier.priceThb) ?? 'd';
        byClass[cls].total += 1;
        sumAll += slab.valueThb;
        floor = Math.min(floor, slab.valueThb);
        top = Math.max(top, slab.valueThb);
        if (i >= series.next) {
            byClass[cls].left += 1;
            sumLeft += slab.valueThb;
        }
    });

    const total = series.manifest.length;
    const left = total - series.next;
    const oddsNext = {} as SeriesSummary['oddsNext'];
    for (const cls of HIT_ORDER) oddsNext[cls] = left > 0 ? byClass[cls].left / left : 0;

    return {
        total,
        left,
        byClass,
        oddsNext,
        evAllThb: total > 0 ? sumAll / total : 0,
        evLeftThb: left > 0 ? sumLeft / left : 0,
        floorThb: Number.isFinite(floor) ? floor : 0,
        topThb: top,
    };
}

export interface ChaseEntry {
    slab: Slab;
    cls: HitClass;
    index: number;
    claimed: boolean;
    claim: SeriesClaim | null;
}

/** The most valuable slabs of a series with their status, best first. */
export function chaseBoard(
    series: SeriesState,
    tier: PackTier,
    index: Map<string, Slab>,
    limit: number,
): ChaseEntry[] {
    const entries: ChaseEntry[] = [];
    series.manifest.forEach((key, i) => {
        const slab = index.get(key);
        if (!slab) return;
        entries.push({
            slab,
            cls: classify(slab.valueThb, tier.priceThb) ?? 'd',
            index: i,
            claimed: i < series.next,
            claim: series.claims.find((c) => c.index === i) ?? null,
        });
    });
    entries.sort((x, y) => y.slab.valueThb - x.slab.valueThb || x.index - y.index);
    return entries.slice(0, limit);
}

// ── Opening packs ───────────────────────────────────────────────────────────

export interface DrawnSlab {
    index: number;
    slabKey: string;
    cls: HitClass;
}

export interface DrawResult {
    series: SeriesState;
    drawn: DrawnSlab[];
    /** Set when this draw took the last pack and the series carries a bonus. */
    bonusKey: string | null;
    soldOut: boolean;
}

/**
 * Sell the next `count` packs of a series to one buyer. Never over-draws: a
 * request for more packs than are left returns what is left. Returns a new
 * series object; the input is not mutated.
 */
export function drawNext(
    series: SeriesState,
    tier: PackTier,
    index: Map<string, Slab>,
    count: number,
    who: string,
    me: boolean,
    now: number,
): DrawResult {
    const left = series.manifest.length - series.next;
    const take = Math.max(0, Math.min(Math.floor(count), left));
    const drawn: DrawnSlab[] = [];
    const claims = series.claims.slice();

    for (let i = 0; i < take; i++) {
        const idx = series.next + i;
        const slabKey = series.manifest[idx];
        const slab = index.get(slabKey);
        const cls = (slab && classify(slab.valueThb, tier.priceThb)) || 'd';
        drawn.push({ index: idx, slabKey, cls });
        if (CHASE_CLASSES.includes(cls)) claims.push({ index: idx, slabKey, cls, who, me, at: now });
    }

    const next = series.next + take;
    const soldOut = next >= series.manifest.length;
    return {
        series: { ...series, next, claims },
        drawn,
        bonusKey: take > 0 && soldOut ? series.bonusKey : null,
        soldOut,
    };
}
