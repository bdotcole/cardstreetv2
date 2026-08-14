'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Offer } from '@/types';

/**
 * Count of offers that need the signed-in user to DO something, for the nav
 * badges that surface the Offers inbox.
 *
 * Motivation (QC 2026-08-14): 12 offers were accepted and none was ever paid.
 * The inbox sits three taps deep under Profile with no indicator anywhere, so
 * a buyer whose offer was accepted had no in-app signal at all — one buyer was
 * demonstrably in the inbox two hours after acceptance, with the Pay button on
 * screen, and still didn't pay. Email is the only other channel and it bounces
 * outright for Apple Private Relay addresses (~14% of accounts).
 *
 * Two kinds of actionable:
 *   - `awaitingPayment` — you are the buyer on an ACCEPTED offer: pay it.
 *   - `needsResponse`   — a PENDING offer the other side made: accept/counter/decline.
 * A pending offer you made yourself is not actionable (you're waiting on them).
 *
 * Purely additive UX. It fails silent: any error leaves the counts at 0 rather
 * than painting a badge nobody can explain.
 */
export interface OfferBadgeCounts {
    awaitingPayment: number;
    needsResponse: number;
    /** Sum — what a single-number badge should show. */
    actionable: number;
}

const EMPTY: OfferBadgeCounts = { awaitingPayment: 0, needsResponse: 0, actionable: 0 };

// Several mounts ask at once (nav tab + profile menu row + orders tab). Share
// one lookup across them and re-use it for a short window, the same
// cached+deduped shape as lib/hooks/usePurchaseRegion.ts.
const TTL_MS = 60_000;
let cached: { at: number; counts: OfferBadgeCounts } | null = null;
let inflight: Promise<OfferBadgeCounts> | null = null;

function countActionable(offers: Offer[]): OfferBadgeCounts {
    let awaitingPayment = 0;
    let needsResponse = 0;
    for (const o of offers) {
        if (o.status === 'accepted' && o.viewerRole === 'buyer') awaitingPayment++;
        // The counterparty of a pending row is whoever did NOT make it.
        else if (o.status === 'pending' && o.viewerRole !== o.actor_role) needsResponse++;
    }
    return { awaitingPayment, needsResponse, actionable: awaitingPayment + needsResponse };
}

async function fetchCounts(): Promise<OfferBadgeCounts> {
    try {
        const res = await fetch('/api/offers?state=active', { cache: 'no-store' });
        if (!res.ok) return EMPTY; // 401 signed-out / 404 flag off — no badge either way.
        const data = await res.json();
        return Array.isArray(data?.offers) ? countActionable(data.offers) : EMPTY;
    } catch {
        return EMPTY;
    }
}

/** Drop the cache so the next read re-fetches (call after acting on an offer). */
export function invalidateOfferBadge() {
    cached = null;
    inflight = null;
}

export function ensureOfferBadge(force = false): Promise<OfferBadgeCounts> {
    if (force) invalidateOfferBadge();
    if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.counts);
    if (!inflight) {
        inflight = fetchCounts().then((counts) => {
            cached = { at: Date.now(), counts };
            inflight = null;
            return counts;
        });
    }
    return inflight;
}

/**
 * `enabled` should carry the caller's own gates (offers flag on, user signed
 * in). When false the hook never fetches and reports zeroes.
 */
export function useOfferBadge(enabled: boolean): OfferBadgeCounts & { refresh: () => void } {
    const [counts, setCounts] = useState<OfferBadgeCounts>(EMPTY);

    const load = useCallback((force: boolean) => {
        if (!enabled) { setCounts(EMPTY); return; }
        let alive = true;
        void ensureOfferBadge(force).then((c) => { if (alive) setCounts(c); });
        return () => { alive = false; };
    }, [enabled]);

    useEffect(() => load(false), [load]);

    // Any offer action anywhere re-broadcasts; every mounted badge re-reads.
    useEffect(() => {
        if (!enabled) return;
        const onChanged = () => load(true);
        window.addEventListener('cs-offers-changed', onChanged);
        return () => window.removeEventListener('cs-offers-changed', onChanged);
    }, [enabled, load]);

    return { ...counts, refresh: () => load(true) };
}

/** Fire after any offer mutation so mounted badges refresh without a reload. */
export function notifyOffersChanged() {
    invalidateOfferBadge();
    try { window.dispatchEvent(new CustomEvent('cs-offers-changed')); } catch { /* SSR */ }
}
