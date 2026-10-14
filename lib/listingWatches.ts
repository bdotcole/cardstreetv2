// Watching a listing (20261015_listing_watches.sql).
//
// Two halves. `attachWatchCounts` runs wherever listings are loaded for
// display (the marketplace service in the browser, the card and seller page
// loaders on the server) and sets `watch_count` on each row from one RPC
// call. The fetch helpers below go through /api/listings/watch so the rules
// (signed in, not your own listing) live in one place; they all fail soft, so
// a network error or a pre-migration database reads as "nothing to show".

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * Per-listing watcher totals for a set of ids. Absent ids have no watchers.
 * Empty on any error (the RPC does not exist yet, or a network failure): a
 * tile without a count is the correct degraded state, never a broken grid.
 */
export async function fetchWatchCounts(supabase: RpcClient, listingIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const unique = [...new Set(listingIds.filter(Boolean))];
    if (unique.length === 0) return counts;
    try {
        const { data, error } = await supabase.rpc('listing_watch_counts', { p_listing_ids: unique });
        if (error || !Array.isArray(data)) return counts;
        for (const row of data as Array<{ listing_id: string; watchers: number | string }>) {
            counts.set(row.listing_id, Number(row.watchers) || 0);
        }
    } catch {
        // Counts are decoration; the listings still render.
    }
    return counts;
}

/** Sets `watch_count` on every row. Mutates and returns the same array. */
export async function attachWatchCounts<T extends { id: string; watch_count?: number }>(
    supabase: RpcClient,
    rows: T[],
): Promise<T[]> {
    if (!rows || rows.length === 0) return rows;
    const counts = await fetchWatchCounts(supabase, rows.map((r) => r.id));
    for (const row of rows) row.watch_count = counts.get(row.id) ?? 0;
    return rows;
}

/** Ids of the listings the signed-in user watches; empty when signed out, null on failure. */
export async function fetchWatchedListingIds(signal?: AbortSignal): Promise<string[] | null> {
    try {
        const res = await fetch('/api/listings/watch', { credentials: 'include', cache: 'no-store', signal });
        if (!res.ok) return null;
        const data = (await res.json()) as { listingIds?: unknown };
        return Array.isArray(data.listingIds) ? data.listingIds.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return null;
    }
}

/** A row of the Watching list: the listing as the grid renders it, plus when and at what price the watch began. */
export type WatchedListing = import('@/services/marketplaceService').MarketplaceListing & {
    watched_at: string;
    price_at_watch: number | null;
};

export async function fetchWatchList(signal?: AbortSignal): Promise<{ available: boolean; items: WatchedListing[] } | null> {
    try {
        const res = await fetch('/api/listings/watch/list', { credentials: 'include', cache: 'no-store', signal });
        // Signed out: an empty list with the "tap the eye" hint, not an error.
        if (res.status === 401) return { available: true, items: [] };
        if (!res.ok) return null;
        return (await res.json()) as { available: boolean; items: WatchedListing[] };
    } catch {
        return null;
    }
}

export type SetWatchResult =
    | { ok: true; isWatching: boolean; watchers: number | null }
    | { ok: false; code: 'UNAUTHORIZED' | 'NOT_AVAILABLE' | 'OWN_LISTING' | 'FAILED' };

export async function setListingWatch(listingId: string, watch: boolean): Promise<SetWatchResult> {
    try {
        const res = await fetch(
            watch ? '/api/listings/watch' : `/api/listings/watch?listing_id=${encodeURIComponent(listingId)}`,
            {
                method: watch ? 'POST' : 'DELETE',
                credentials: 'include',
                headers: watch ? { 'Content-Type': 'application/json' } : undefined,
                body: watch ? JSON.stringify({ listing_id: listingId }) : undefined,
            },
        );
        if (res.status === 401) return { ok: false, code: 'UNAUTHORIZED' };
        if (res.status === 503) return { ok: false, code: 'NOT_AVAILABLE' };
        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { code?: string };
            return { ok: false, code: body.code === 'OWN_LISTING' ? 'OWN_LISTING' : 'FAILED' };
        }
        const data = await res.json();
        return { ok: true, isWatching: !!data.isWatching, watchers: typeof data.watchers === 'number' ? data.watchers : null };
    } catch {
        return { ok: false, code: 'FAILED' };
    }
}
