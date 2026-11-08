/**
 * Slab Packs — the card pool the tables are built from, and the card-art
 * URLs for a slab.
 *
 * The pool is the inventory file (inventory.ts): the cards Cardstreet holds,
 * with the copies of each. The engine only ever sees `Slab[]`, so the
 * preview store filters this pool down to what is still in stock, and a
 * server will read the same shape from an inventory table.
 */

import { sha256Hex } from './engine';
import { INVENTORY } from './inventory';
import type { GameKey, Slab } from './types';

// The mirrored card-art bucket (see CLAUDE.md "Card images"). Served directly,
// never through the render endpoint. The literal fallback keeps the module
// usable from a script, where NEXT_PUBLIC_* is not inlined.
const STORAGE_BASE = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://fdxgzddvywtmnqsaqysx.supabase.co').replace(/\/$/, '')}/storage/v1/object/public/card-images/`;

/** Every card type in the inventory, at the copies the file lists. */
export const INVENTORY_POOL: readonly Slab[] = INVENTORY.map((item) => ({
    key: `${item.cardId}:${item.grade}`,
    cardId: item.cardId,
    game: item.game,
    grader: item.grade === 'raw' ? ('none' as const) : ('PSA' as const),
    grade: item.grade,
    name: item.name,
    localName: item.localName ?? undefined,
    setName: item.setName,
    number: item.number,
    year: item.year,
    lang: item.lang,
    rarity: item.rarity,
    valueThb: item.valueThb,
    stock: item.qty,
    image: item.image,
}));

/** `small` (~245w) for grids and tickers, `large` (~734w) for the reveal. */
export function slabImage(slab: Pick<Slab, 'cardId' | 'image'>, size: 'small' | 'large'): string {
    if (slab.image) return slab.image[size];
    return `${STORAGE_BASE}${encodeURIComponent(slab.cardId)}/${size}.webp`;
}

/** PSA's own word for each grade the pool carries; a raw single is simply near mint. */
export function gradeDescriptor(grade: Slab['grade']): string {
    if (grade === 'raw') return 'NEAR MINT';
    return grade >= 10 ? 'GEM MT' : 'MINT';
}

/** "PSA 10" / "PSA 9" / "Raw NM": the grade the way the UI prints it after a set name. */
export function gradeLabel(slab: Pick<Slab, 'grade'>): string {
    return slab.grade === 'raw' ? 'Raw NM' : `PSA ${slab.grade}`;
}

/**
 * A fingerprint of which card types a pool holds, order-independent: the
 * same pool builds the same table, so a pull that records this can be
 * re-verified against the table it was drawn from after stock has moved.
 */
export function poolFingerprint(pool: readonly Slab[]): string {
    return sha256Hex(pool.map((s) => s.key).sort().join('\n')).slice(0, 16);
}

const POOL_INDEX = new Map<string, Slab>(INVENTORY_POOL.map((slab) => [slab.key, slab]));
const BY_GAME = new Map<GameKey, readonly Slab[]>();

/** The card types of one game, in stock or not: each game's packs draw only from its own cards. */
export function poolForGame(game: GameKey): readonly Slab[] {
    let pool = BY_GAME.get(game);
    if (!pool) {
        pool = INVENTORY_POOL.filter((s) => s.game === game);
        BY_GAME.set(game, pool);
    }
    return pool;
}

/** Slabs by key. Shared so callers do not each rebuild the map. */
export function poolIndex(): Map<string, Slab> {
    return POOL_INDEX;
}

export function getSlab(key: string): Slab | undefined {
    return POOL_INDEX.get(key);
}
