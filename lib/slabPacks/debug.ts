'use client';

/**
 * Slab Packs — development-only switches for looking at the opening without
 * playing it by hand. Every branch is behind NODE_ENV === 'development',
 * which the production build replaces with `false`, so none of this ships.
 *
 *   /packs?demo=opal:ss          open one Galaxy Opal pack that is an SS pull
 *   /packs?demo=silver:d,b,a     open three slabs of those classes in a row
 *   &auto=1                      tear the pack without a finger
 *   &still=1                     no animation: every pose jumps to its end
 *                                state (for tools whose tab never gets an
 *                                animation frame, where a tween would stall)
 *
 * A demo opening is built from the slab pool directly. It never touches the
 * wallet or the vault, and its proof is a placeholder (the slab sheet skips
 * verification for demo pulls).
 */

import { commitFor } from './engine';
import { poolForGame } from './pool';
import { HIT_ORDER, TIER_ORDER, TIERS, classify } from './tiers';
import type { HitClass, Pull, TierKey } from './types';

export interface SlabPacksDebug {
    still: boolean;
    auto: boolean;
    demo: { tierKey: TierKey; pulls: Pull[] } | null;
}

const OFF: SlabPacksDebug = { still: false, auto: false, demo: null };

export function readDebug(): SlabPacksDebug {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return OFF;
    const q = new URLSearchParams(window.location.search);
    const out: SlabPacksDebug = { still: q.has('still'), auto: q.has('auto'), demo: null };

    const [tierRaw, classesRaw] = (q.get('demo') ?? '').split(':');
    const tierKey = TIER_ORDER.find((k) => k === tierRaw);
    if (tierKey && classesRaw) {
        const tier = TIERS[tierKey];
        const pulls: Pull[] = [];
        classesRaw.split(',').forEach((raw, i) => {
            const cls = HIT_ORDER.find((c) => c === raw) as HitClass | undefined;
            if (!cls) return;
            // The priciest slab of the class: the reveal at its most dressed.
            const slab = poolForGame('pokemon').filter((s) => classify(s.valueThb, tier.priceThb) === cls).pop();
            if (!slab) return;
            const seed = `demo-seed-${i}`;
            pulls.push({
                id: `demo-${i}`, slabKey: slab.key, tier: tierKey, cls,
                pricePaidThb: tier.priceThb, at: Date.now(), status: 'unrevealed',
                proof: { commit: commitFor(seed), seed, clientSeed: 'demo' },
            });
        });
        if (pulls.length) out.demo = { tierKey, pulls };
    }
    return out;
}
