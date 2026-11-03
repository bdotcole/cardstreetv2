'use client';

import { useEffect, useState } from 'react';

/**
 * Parcels the signed-in seller still has to label, for the badges that lead
 * to them: the Profile tab, the Seller Dashboard row and its To ship segment.
 *
 * Motivation (2026-11-03): a seller got the "sold" push, opened the app and
 * found nothing pointing at the order. The Profile tab showed no count, the
 * order sat two taps deep behind a row with no indicator, and the only way
 * to find it was to know where to look. Offers and chats already badge the
 * tab; a sale waiting for a label is the third thing a seller must act on.
 *
 * Counts checkouts (parcels to pack), not order rows, from
 * /api/profile/shipments/count. It clears on its own once the label exists
 * (the order leaves `paid`), so no "seen" state is kept. Several mounts
 * share one lookup, like useChatUnread: re-checked every minute while the
 * page is visible and whenever the shipments list reloads. Fails silent to 0.
 */
export const SHIPMENTS_CHANGED_EVENT = 'cs-shipments-changed';

const TTL_MS = 30_000;
const POLL_MS = 60_000;
let cached: { at: number; count: number } | null = null;
let inflight: Promise<number> | null = null;

async function fetchCount(): Promise<number> {
    try {
        const res = await fetch('/api/profile/shipments/count', { cache: 'no-store', credentials: 'include' });
        if (!res.ok) return 0; // 401 signed out: no badge either way.
        const data = await res.json();
        return typeof data?.toShip === 'number' ? data.toShip : 0;
    } catch {
        return 0;
    }
}

function load(force: boolean): Promise<number> {
    if (!force && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.count);
    if (inflight) return inflight;
    inflight = fetchCount()
        .then((count) => {
            cached = { at: Date.now(), count };
            return count;
        })
        .finally(() => { inflight = null; });
    return inflight;
}

/**
 * `enabled` carries the caller's gates (signed in, not a guest). When false
 * the hook never fetches and reports 0.
 */
export function useToShipBadge(enabled: boolean): { count: number; refresh: () => void } {
    const [count, setCount] = useState<number>(() => (enabled && cached ? cached.count : 0));

    useEffect(() => {
        // Signed out: drop the cache too, or the next account to sign in on
        // this device would see the previous one's count for a moment.
        if (!enabled) { cached = null; setCount(0); return; }
        let cancelled = false;
        const refresh = (force: boolean) => {
            void load(force).then((c) => { if (!cancelled) setCount(c); });
        };
        refresh(false);
        const onChanged = () => refresh(true);
        window.addEventListener(SHIPMENTS_CHANGED_EVENT, onChanged);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') refresh(true);
        }, POLL_MS);
        return () => {
            cancelled = true;
            window.removeEventListener(SHIPMENTS_CHANGED_EVENT, onChanged);
            window.clearInterval(timer);
        };
    }, [enabled]);

    return { count, refresh: () => { void load(true).then(setCount); } };
}

/**
 * Fire after anything that can change what is waiting for a label (the
 * shipments list reloaded, a "sold" push arrived in the foreground) so every
 * mounted badge re-reads without a page reload.
 */
export function notifyShipmentsChanged() {
    cached = null;
    try { window.dispatchEvent(new CustomEvent(SHIPMENTS_CHANGED_EVENT)); } catch { /* SSR */ }
}
