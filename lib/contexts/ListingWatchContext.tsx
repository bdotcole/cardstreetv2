'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { fetchWatchedListingIds, setListingWatch } from '@/lib/listingWatches';

// Watch state for every listing tile on the page: which listings the viewer
// watches and the watcher count each tile shows. One provider under the root
// layout, so the marketplace grid, a listing sheet opened from it and the
// card page all agree the moment a tap lands.
//
// The viewer's own taps are kept as overrides on top of the server's list
// for the whole session: the watchlist is read once per sign-in, and a tap
// that races that read (the sign-in resume, a fast first tap) must not be
// undone when the read lands.

/** The parts of a listing the watch state needs. Grouped tiles pass their sibling ids. */
export interface WatchableListing {
    id: string;
    seller_id?: string;
    watch_count?: number;
    siblingIds?: string[];
    card_data?: { name?: string };
}

export type ToggleWatchResult = 'ok' | 'unauthorized' | 'failed';

interface ListingWatchContextValue {
    /** Signed-in Supabase user id, or null (guests included). */
    viewerId: string | null;
    isWatching: (listing: WatchableListing) => boolean;
    /** Watchers shown on the tile: the row's count, or the total the viewer's own tap came back with. */
    watchers: (listing: WatchableListing) => number;
    /**
     * Optimistic toggle. Signed-out callers get `unauthorized` and should open
     * the sign-in wall. `force` sets the direction outright, for a surface
     * that knows the row is watched (the Watching list) regardless of whether
     * the shared watchlist read has landed.
     */
    toggle: (listing: WatchableListing, force?: boolean) => Promise<ToggleWatchResult>;
}

const ListingWatchContext = createContext<ListingWatchContextValue | null>(null);

const idsOf = (listing: WatchableListing): string[] =>
    listing.siblingIds?.length ? listing.siblingIds : [listing.id];

export function ListingWatchProvider({ children }: { children: React.ReactNode }) {
    const { showToast } = useToast();
    const { t } = useTranslation();
    const [viewerId, setViewerId] = useState<string | null>(null);
    // What the server said the viewer watches (one read per sign-in).
    const [serverIds, setServerIds] = useState<Set<string>>(() => new Set());
    // The viewer's own taps this session, by listing id. Wins over serverIds.
    const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
    // Totals the viewer's own writes came back with; win over the row's
    // watch_count, which may predate the tap (the grid is not refetched).
    const [exact, setExact] = useState<Map<string, number>>(() => new Map());
    // Optimistic +1 / -1 while a write is in flight.
    const [pending, setPending] = useState<Map<string, number>>(() => new Map());
    const inFlight = useRef<Set<string>>(new Set());

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setViewerId(session?.user?.id ?? null);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    // A new account (or signing out) starts from a clean slate: the previous
    // viewer's taps are theirs, not this one's.
    useEffect(() => {
        setServerIds(new Set());
        setOverrides(new Map());
        setExact(new Map());
        if (!viewerId) return;
        const controller = new AbortController();
        void fetchWatchedListingIds(controller.signal).then((ids) => {
            if (!controller.signal.aborted && ids) setServerIds(new Set(ids));
        });
        return () => controller.abort();
    }, [viewerId]);

    const watchedIds = useCallback((listing: WatchableListing): string[] =>
        idsOf(listing).filter((id) => overrides.get(id) ?? serverIds.has(id)),
    [overrides, serverIds]);

    const isWatching = useCallback((listing: WatchableListing) => watchedIds(listing).length > 0, [watchedIds]);

    const watchers = useCallback((listing: WatchableListing): number => {
        const base = exact.get(listing.id) ?? listing.watch_count ?? 0;
        return Math.max(0, base + (pending.get(listing.id) ?? 0));
    }, [exact, pending]);

    const toggle = useCallback(async (listing: WatchableListing, force?: boolean): Promise<ToggleWatchResult> => {
        if (!viewerId) return 'unauthorized';
        if (inFlight.current.has(listing.id)) return 'ok';
        const name = listing.card_data?.name ?? '';
        const currently = watchedIds(listing);
        const next = force ?? currently.length === 0;
        // Watching targets the tile's own id; unwatching clears every sibling
        // the viewer happens to watch (a different copy may have been the
        // representative when they tapped). A forced unwatch of a row the
        // shared state never saw still clears that row's own id.
        const targets = next ? [listing.id] : (currently.length ? currently : [listing.id]);
        const delta = next ? 1 : -1;

        const before = new Map(overrides);
        setOverrides((prev) => {
            const m = new Map(prev);
            for (const id of targets) m.set(id, next);
            return m;
        });
        setPending((prev) => new Map(prev).set(listing.id, delta));

        inFlight.current.add(listing.id);
        let failure: 'unauthorized' | 'unavailable' | 'own' | 'failed' | null = null;
        let total: number | null = null;
        for (const id of targets) {
            const result = await setListingWatch(id, next);
            if (!result.ok) {
                failure = result.code === 'UNAUTHORIZED' ? 'unauthorized'
                    : result.code === 'NOT_AVAILABLE' ? 'unavailable'
                        : result.code === 'OWN_LISTING' ? 'own'
                            : 'failed';
                break;
            }
            if (id === listing.id) total = result.watchers;
        }
        inFlight.current.delete(listing.id);
        setPending((prev) => {
            const m = new Map(prev);
            m.delete(listing.id);
            return m;
        });

        if (failure) {
            setOverrides(before);
            if (failure === 'unauthorized') return 'unauthorized';
            showToast(
                t(failure === 'unavailable' ? 'watch.unavailable' : failure === 'own' ? 'watch.ownListing' : 'watch.failed'),
                'error',
            );
            return 'failed';
        }
        if (total !== null) {
            const fresh = total;
            setExact((prev) => new Map(prev).set(listing.id, fresh));
        } else {
            // The write succeeded but came back without a total (pre-RPC):
            // keep the optimistic step so the tile still moves.
            setExact((prev) => new Map(prev).set(listing.id, (prev.get(listing.id) ?? listing.watch_count ?? 0) + delta));
        }
        showToast(t(next ? 'watch.watchedToast' : 'watch.unwatchedToast').replace('{name}', name), 'success');
        return 'ok';
    }, [viewerId, watchedIds, overrides, showToast, t]);

    const value = useMemo(() => ({ viewerId, isWatching, watchers, toggle }), [viewerId, isWatching, watchers, toggle]);

    return <ListingWatchContext.Provider value={value}>{children}</ListingWatchContext.Provider>;
}

const FALLBACK: ListingWatchContextValue = {
    viewerId: null,
    isWatching: () => false,
    watchers: (listing) => listing.watch_count ?? 0,
    toggle: async () => 'failed',
};

/** Null-safe: a surface rendered outside the provider shows counts only. */
export function useListingWatch(): ListingWatchContextValue {
    return useContext(ListingWatchContext) ?? FALLBACK;
}
