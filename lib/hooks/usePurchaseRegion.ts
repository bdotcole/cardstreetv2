'use client';

import { useEffect, useState } from 'react';

/**
 * Client-side mirror of the purchase country gate (see lib/geo.ts).
 *
 * Shipping is Thailand-only for now, so checkout is restricted to TH buyers.
 * This drives the "available in Thailand only" popup; the server gate in
 * /api/orders/checkout is the authoritative block. Because it's only UX, it
 * fails open: any fetch/parse problem leaves `purchaseAllowed` true and lets
 * the server have the final say.
 */
export interface PurchaseRegion {
    country: string | null;
    purchaseAllowed: boolean;
}

// Resolve /api/geo at most once per session and share the result across the
// mobile shell and the desktop cart. `inflight` dedupes concurrent callers.
let cached: PurchaseRegion | null = null;
let inflight: Promise<PurchaseRegion> | null = null;

async function fetchRegion(): Promise<PurchaseRegion> {
    try {
        const res = await fetch('/api/geo');
        if (!res.ok) throw new Error('geo lookup failed');
        const data = await res.json();
        return {
            country: typeof data?.country === 'string' ? data.country : null,
            // Treat anything but an explicit `false` as allowed so an
            // unexpected response shape never strands a buyer at checkout.
            purchaseAllowed: data?.purchaseAllowed !== false,
        };
    } catch {
        return { country: null, purchaseAllowed: true };
    }
}

/**
 * Imperative resolver for click handlers: returns the cached region, the
 * in-flight lookup, or kicks off a fresh one. Use this at checkout time so the
 * decision doesn't depend on render timing.
 */
export function ensurePurchaseRegion(): Promise<PurchaseRegion> {
    if (cached) return Promise.resolve(cached);
    if (!inflight) {
        inflight = fetchRegion().then((r) => {
            cached = r;
            return r;
        });
    }
    return inflight;
}

/** Warms the cache on mount and exposes the region reactively (null = loading). */
export function usePurchaseRegion(): PurchaseRegion | null {
    const [region, setRegion] = useState<PurchaseRegion | null>(cached);

    useEffect(() => {
        if (cached) {
            setRegion(cached);
            return;
        }
        let active = true;
        ensurePurchaseRegion().then((r) => {
            if (active) setRegion(r);
        });
        return () => {
            active = false;
        };
    }, []);

    return region;
}
