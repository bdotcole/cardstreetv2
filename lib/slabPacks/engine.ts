/**
 * Slab Packs — the mechanics, as pure functions over plain data.
 *
 * The model is FIXED, PUBLISHED ODDS, the way the large digital-pack
 * operators run it. Each tier has a table: every card the pack can contain,
 * each with its own chance, and the chances never move. A pull is one
 * independent draw from that table. Nothing is counted down, nothing is
 * marked as gone, and a buyer sees exactly the same odds before and after
 * anyone else's pull.
 *
 * Fairness is per pull, commit-then-reveal: before the pack is ripped the
 * buyer is shown a hash of a secret seed; after the reveal the seed itself
 * is shown. The draw is a pure function of (seed, the buyer's own client
 * seed, the table), so hashing the seed checks the commit and re-running
 * the draw checks the result. The house cannot pick the result once the
 * commit is out, and cannot pick the seed alone because the client seed is
 * mixed in.
 *
 * Everything here is deterministic given its inputs, so the same code runs
 * in the browser preview today and inside a route handler later, where the
 * seed is generated and kept server-side until the pull is revealed.
 */

import { HIT_CLASSES, HIT_ORDER, TARGET_EV, classify } from './tiers';
import type { CardOdds, GameKey, HitClass, PackTable, PackTier, Slab } from './types';

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

// ── The table ───────────────────────────────────────────────────────────────

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
 * Relative weights of the cards in one class, cheapest first. `bias` leans
 * the draw toward the cheap end of the band (0 = every card in the class is
 * equally likely). The small constant keeps the dearest card reachable.
 */
function classWeights(n: number, bias: number): number[] {
    const span = Math.max(1, n - 1);
    const w: number[] = [];
    for (let i = 0; i < n; i++) w.push(Math.pow(1 - i / span, bias) + 0.04);
    return w;
}

/** How hard to lean cheap, tried in turn; the table nearest TARGET_EV wins. */
const BIASES = [0, 0.5, 1, 1.6, 2.4, 3.5, 5, 8];

function tableWithBias(game: GameKey, tier: PackTier, byClass: Record<HitClass, Slab[]>, bias: number): PackTable {
    const cards: CardOdds[] = [];
    const summary = {} as PackTable['byClass'];
    let ev = 0;
    let floor = Infinity;
    let top = 0;

    for (const cls of HIT_ORDER) {
        const cands = byClass[cls];
        const clsOdds = tier.odds[cls];
        const w = classWeights(cands.length, bias);
        const total = w.reduce((s, x) => s + x, 0);
        let mean = 0;
        cands.forEach((slab, i) => {
            const odds = clsOdds * (w[i] / total);
            cards.push({ slab, cls, odds });
            mean += slab.valueThb * (w[i] / total);
            ev += slab.valueThb * odds;
            if (clsOdds > 0) {
                floor = Math.min(floor, slab.valueThb);
                top = Math.max(top, slab.valueThb);
            }
        });
        summary[cls] = {
            odds: clsOdds,
            cards: cands.length,
            minThb: cands.length ? cands[0].valueThb : 0,
            maxThb: cands.length ? cands[cands.length - 1].valueThb : 0,
            meanThb: mean,
        };
    }

    cards.sort((x, y) => y.slab.valueThb - x.slab.valueThb || x.slab.key.localeCompare(y.slab.key));
    return {
        game,
        tier: tier.key,
        byClass: summary,
        cards,
        evThb: ev,
        floorThb: Number.isFinite(floor) ? floor : 0,
        topThb: top,
    };
}

/**
 * The published table for a game's tier: every card the pool can put in this
 * pack, each with its exact chance. Deterministic in (tier, pool), so the
 * client and the server compute the same table from the same inputs. Throws
 * when the pool cannot fill a class the odds need, so a tier is never sold
 * with a hole in its table.
 */
export function buildTable(game: GameKey, tier: PackTier, pool: readonly Slab[]): PackTable {
    const sum = HIT_ORDER.reduce((s, cls) => s + tier.odds[cls], 0);
    if (Math.abs(sum - 1) > 1e-6) throw new Error(`[slabPacks] ${tier.key} odds sum to ${sum}, not 1`);

    const byClass = poolByClass(pool, tier);
    for (const cls of HIT_ORDER) {
        if (tier.odds[cls] > 0 && byClass[cls].length === 0) {
            throw new Error(`[slabPacks] ${game} pool has no ${HIT_CLASSES[cls].letter} slabs for ${tier.key}`);
        }
    }

    let best: PackTable | null = null;
    for (const bias of BIASES) {
        const table = tableWithBias(game, tier, byClass, bias);
        const gap = Math.abs(table.evThb / tier.priceThb - TARGET_EV);
        if (!best || gap < Math.abs(best.evThb / tier.priceThb - TARGET_EV)) best = table;
    }
    return best!;
}

/** The dearest cards of a table, best first: the lobby's top-pulls strip. */
export function topPulls(table: PackTable, limit: number): CardOdds[] {
    return table.cards.slice(0, limit);
}

// ── Pulling ─────────────────────────────────────────────────────────────────

export interface Draw {
    slabKey: string;
    cls: HitClass;
    /** The uniform number in [0, 1) the card was read off the table at. */
    roll: number;
}

/**
 * The number the draw actually uses: the secret seed and the buyer's client
 * seed, hashed together. Neither side can steer it alone.
 */
export function drawSeed(seed: string, clientSeed: string): string {
    return sha256Hex(`${seed}|${clientSeed}`);
}

export function commitFor(seed: string): string {
    return sha256Hex(`commit|${seed}`);
}

/**
 * Read one card off the table at a uniform roll: walk the cumulative odds.
 * Pure in (table, roll), so a verifier can repeat it.
 */
export function cardAt(table: PackTable, roll: number): CardOdds {
    let acc = 0;
    for (const c of table.cards) {
        acc += c.odds;
        if (roll < acc) return c;
    }
    // Rounding at the very end of the walk: the last card.
    return table.cards[table.cards.length - 1];
}

/** One pull from a tier's table, decided entirely by the two seeds. */
export function draw(table: PackTable, seed: string, clientSeed: string): Draw {
    const roll = makeRng(drawSeed(seed, clientSeed))();
    const c = cardAt(table, roll);
    return { slabKey: c.slab.key, cls: c.cls, roll };
}

/**
 * The check a buyer can run after a reveal: the published seed hashes to the
 * commit they were shown before the rip, and re-running the draw with it
 * lands on the card they got.
 */
export function verifyDraw(table: PackTable, seed: string, clientSeed: string, commit: string, slabKey: string): boolean {
    return commitFor(seed) === commit && draw(table, seed, clientSeed).slabKey === slabKey;
}
