'use client';

/**
 * Funnel events for the breaker application landing page.
 *
 * Rides the analytics the app already has — Google Analytics via
 * @next/third-parties (mounted in app/layout.tsx, env-gated on
 * NEXT_PUBLIC_GA_MEASUREMENT_ID). No new provider, no new script tag.
 *
 * sendGAEvent pushes onto window.dataLayer, which is inert when the GA tag
 * isn't loaded, so every call here is safe in dev and in preview builds.
 * Analytics must never break the form: all dispatch errors are swallowed.
 */

import { sendGAEvent } from '@next/third-parties/google';

export type BreakerEvent =
    | 'breaker_apply_click'
    | 'breaker_application_start'
    | 'breaker_application_submit'
    | 'breaker_application_success'
    | 'breaker_application_error';

export function trackBreakerEvent(
    name: BreakerEvent,
    params: Record<string, string | number | boolean> = {},
): void {
    if (typeof window === 'undefined') return;
    try {
        sendGAEvent('event', name, params);
    } catch {
        // GA not loaded (env var unset) — nothing to report to.
    }
}

/**
 * UTM + referral params from the current URL, for attribution on the submitted
 * application. Returns only the keys actually present, so an organic visit
 * stores `{}` rather than a row of empty strings.
 */
export function readAttributionParams(keys: readonly string[]): Record<string, string> {
    if (typeof window === 'undefined') return {};
    const out: Record<string, string> = {};
    try {
        const params = new URLSearchParams(window.location.search);
        for (const key of keys) {
            const value = params.get(key);
            if (value) out[key] = value.slice(0, 200);
        }
    } catch {
        // Malformed query string — attribution is best-effort.
    }
    return out;
}
