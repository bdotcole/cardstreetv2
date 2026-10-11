'use client';

import { useEffect, useState } from 'react';

/**
 * Wishlist-demand counts for a set of cards, from /api/wishlist-demand.
 *
 * Module-level cache, shared across every component that asks. The vault, the
 * card detail and the sell surfaces all want counts for overlapping card sets,
 * and without this each mount would re-fetch the same numbers — for a value
 * that changes a few times a day.
 *
 * Fails silent: an empty map renders no badges, which is the correct degraded
 * state for a decoration.
 */

const cache = new Map<string, number>();
/** Ids already requested, so a second component asking for the same card does
 *  not queue a duplicate round trip while the first is still in flight. */
const requested = new Set<string>();

/** Matches MAX_IDS in the route. */
const MAX_IDS_PER_REQUEST = 200;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pending = new Set<string>();
const listeners = new Set<() => void>();

async function flush() {
    flushTimer = null;
    const batch = [...pending].slice(0, MAX_IDS_PER_REQUEST);
    const rest = [...pending].slice(MAX_IDS_PER_REQUEST);
    pending = new Set(rest);
    if (batch.length === 0) return;
    try {
        const res = await fetch(`/api/wishlist-demand?cardIds=${encodeURIComponent(batch.join(','))}`);
        const data = res.ok ? await res.json() : null;
        for (const id of batch) {
            // Absent from the response means zero wishlisters — cache that too,
            // or every render re-asks about every card nobody wants.
            cache.set(id, Number(data?.counts?.[id] ?? 0));
        }
    } catch {
        for (const id of batch) cache.set(id, 0);
    }
    for (const fn of listeners) fn();
    if (pending.size > 0) schedule();
}

function schedule() {
    if (flushTimer) return;
    // One frame of coalescing: a vault list mounts dozens of tiles in the same
    // tick, and they should produce one request, not one each.
    flushTimer = setTimeout(flush, 50);
}

export function useWishlistDemand(cardIds: readonly string[]): Record<string, number> {
    const [, forceRender] = useState(0);
    const key = cardIds.join(',');

    useEffect(() => {
        const listener = () => forceRender((n) => n + 1);
        listeners.add(listener);
        let queued = false;
        for (const id of cardIds) {
            if (!id || cache.has(id) || requested.has(id)) continue;
            requested.add(id);
            pending.add(id);
            queued = true;
        }
        if (queued) schedule();
        return () => { listeners.delete(listener); };
        // key, not the array: a new array identity every render would re-run
        // this on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    const out: Record<string, number> = {};
    for (const id of cardIds) {
        const n = cache.get(id);
        if (n !== undefined && n > 0) out[id] = n;
    }
    return out;
}

/** Single-card convenience for the card detail. */
export function useCardWishlistDemand(cardId: string | undefined | null): number {
    const ids = cardId ? [cardId] : [];
    const counts = useWishlistDemand(ids);
    return cardId ? (counts[cardId] ?? 0) : 0;
}
