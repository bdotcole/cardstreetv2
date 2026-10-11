'use client';

/**
 * GA4 `search` event for the catalog and marketplace search boxes.
 *
 * WHY: smart search (lib/search/*) changed what a query can find — Magikarp
 * typed as คอยคิง, コイキング or Koiking, misspellings, "pikachu ex" — and
 * without an event there is no way to tell whether people now find what they
 * type, or which box they type it into. `search` with `search_term` is GA4's
 * recommended event, so the built-in search-term reports fill in on their own.
 *
 * One event per thing the user actually searched for, never per keystroke:
 * - trackSearch sends now. For deliberate acts: picking a dropdown row, a
 *   /?q= page (reached by Enter or a link).
 * - trackSettledSearch is for as-you-type boxes. Their 400 ms fetch debounce
 *   is about the gap between keystrokes on a phone, so each settled term
 *   waits SETTLE_MS more; a term the next one extends or backs up from ("pik"
 *   then "pikachu") is replaced without being sent. It also goes out when the
 *   box unmounts (flushSettledSearch) or the page is hidden.
 *
 * Parameters:
 * - search_term     the query as typed (trimmed, capped at GA4's 100-char limit)
 * - results_count   what the box showed for it; omitted when unknown (a
 *                   failed fetch shows an empty box but is not a zero-result
 *                   search)
 * - search_surface  which box: explore | desktop_nav (a dropdown pick) |
 *                   marketplace | desktop_marketplace (a /?q= page, which is
 *                   where Enter in the desktop nav lands)
 * - resolved        whether the query names a Pokémon by an exact dictionary
 *                   name: 'exact' (any language, e.g. คอยคิง), 'loose' (a
 *                   romaji/European name, e.g. Koiking), 'none' (no exact name —
 *                   a typo, a set, a non-Pokémon card). Omitted until the
 *                   dictionary has loaded. Typo matches deliberately read as
 *                   'none': telling them apart would mean building the typo
 *                   index here, on the main thread, for analytics.
 * - surface         native_app | web, the same shell tag every other helper
 *                   sends (lib/engagementEvents.ts). The search box rides in
 *                   search_surface instead so the two never mix in one dimension.
 *
 * Rides the GA tag mounted in app/layout.tsx (env-gated on
 * NEXT_PUBLIC_GA_MEASUREMENT_ID); sendGAEvent is inert when the tag isn't
 * loaded. Analytics must never break the search being measured: everything is
 * swallowed.
 */

import { Capacitor } from '@capacitor/core';
import { sendGAEvent } from '@next/third-parties/google';
import { getLoadedSearchDictionary } from '@/lib/search/dictionary';
import { resolveForFilter } from '@/lib/search/resolve';

export type SearchSurface = 'explore' | 'desktop_nav' | 'marketplace' | 'desktop_marketplace';

interface SearchEvent {
    term: string;
    /** null when the caller cannot say what the box showed for this exact term. */
    resultsCount: number | null;
    surface: SearchSurface;
}

/** Same shell tag as lib/engagementEvents.ts / lib/commerceEvents.ts. */
function shell(): 'native_app' | 'web' {
    try {
        return Capacitor.isNativePlatform() ? 'native_app' : 'web';
    } catch {
        return 'web';
    }
}

function resolvedKind(term: string): 'exact' | 'loose' | 'none' | null {
    // Never triggers a download: an event fired before the chunk arrives just
    // goes without the parameter.
    const dict = getLoadedSearchDictionary();
    if (!dict) return null;
    const groups = resolveForFilter(dict, term).groups;
    if (groups.length === 0) return 'none';
    return groups.some((g) => g.kind === 'exact') ? 'exact' : 'loose';
}

const cleanTerm = (term: string) => Array.from((term || '').trim()).slice(0, 100).join('');

export function trackSearch({ term, resultsCount, surface }: SearchEvent): void {
    if (typeof window === 'undefined') return;
    try {
        const searchTerm = cleanTerm(term);
        if (!searchTerm) return;
        const params: Record<string, string | number> = {
            search_term: searchTerm,
            search_surface: surface,
            surface: shell(),
        };
        if (typeof resultsCount === 'number' && Number.isFinite(resultsCount)) params.results_count = resultsCount;
        const resolved = resolvedKind(searchTerm);
        if (resolved) params.resolved = resolved;
        sendGAEvent('event', 'search', params);
    } catch {
        // GA not loaded (env var unset) — nothing to report to.
    }
}

// ── Settled searches (as-you-type boxes) ──

const SETTLE_MS = 1800;
// Shorter Latin text is still being typed; one or two kana or Thai characters
// can already be a name (ピィ, ปี).
const NON_LATIN = /[^\u0000-\u024f]/;

const pending = new Map<SearchSurface, { event: SearchEvent; timer: ReturnType<typeof setTimeout> }>();
let pageHideHooked = false;

/** Send the surface's pending search now (or every surface's, with none given). */
export function flushSettledSearch(surface?: SearchSurface): void {
    for (const [s, p] of [...pending]) {
        if (surface && s !== surface) continue;
        clearTimeout(p.timer);
        pending.delete(s);
        trackSearch(p.event);
    }
}

export function trackSettledSearch(event: SearchEvent): void {
    if (typeof window === 'undefined') return;
    const term = cleanTerm(event.term);
    if (Array.from(term).length < (NON_LATIN.test(term) ? 2 : 3)) return;
    if (!pageHideHooked) {
        pageHideHooked = true;
        try {
            window.addEventListener('pagehide', () => flushSettledSearch());
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') flushSettledSearch();
            });
        } catch {
            // No listeners: pending terms still go out on their timers.
        }
    }
    const prev = pending.get(event.surface);
    if (prev) {
        clearTimeout(prev.timer);
        const a = prev.event.term.toLowerCase();
        const b = term.toLowerCase();
        // Still typing (or backspacing) the same search: replace it.
        if (!a.startsWith(b) && !b.startsWith(a)) trackSearch(prev.event);
    }
    const next = { ...event, term };
    pending.set(event.surface, {
        event: next,
        timer: setTimeout(() => {
            pending.delete(event.surface);
            trackSearch(next);
        }, SETTLE_MS),
    });
}
