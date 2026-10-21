/**
 * Slab Packs — the slab pool the prototype builds its series from, and the
 * card-art URLs for a slab.
 *
 * Today the pool is the static snapshot in demoPool.ts. The engine only ever
 * sees `Slab[]`, so swapping this for a query over real inventory changes
 * nothing downstream.
 */

import { DEMO_POOL } from './demoPool';
import type { Slab } from './types';

// The mirrored card-art bucket (see CLAUDE.md "Card images"). Served directly,
// never through the render endpoint. The literal fallback keeps the module
// usable from a script, where NEXT_PUBLIC_* is not inlined.
const STORAGE_BASE = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://fdxgzddvywtmnqsaqysx.supabase.co').replace(/\/$/, '')}/storage/v1/object/public/card-images/`;

export const PREVIEW_POOL: readonly Slab[] = DEMO_POOL.map(
    ([cardId, grade, name, setName, number, year, lang, rarity, valueThb]) => ({
        key: `${cardId}:${grade}`,
        cardId,
        grader: 'PSA' as const,
        grade,
        name,
        setName,
        number,
        year,
        lang,
        rarity,
        valueThb,
    }),
);

/** `small` (~245w) for grids and tickers, `large` (~734w) for the reveal. */
export function slabImage(slab: Pick<Slab, 'cardId'>, size: 'small' | 'large'): string {
    return `${STORAGE_BASE}${encodeURIComponent(slab.cardId)}/${size}.webp`;
}

/** PSA's own word for each grade the pool carries. */
export function gradeDescriptor(grade: number): string {
    return grade >= 10 ? 'GEM MT' : 'MINT';
}

const POOL_INDEX = new Map<string, Slab>(PREVIEW_POOL.map((slab) => [slab.key, slab]));

/** Slabs by key. Shared so callers do not each rebuild the map. */
export function poolIndex(): Map<string, Slab> {
    return POOL_INDEX;
}

export function getSlab(key: string): Slab | undefined {
    return POOL_INDEX.get(key);
}
