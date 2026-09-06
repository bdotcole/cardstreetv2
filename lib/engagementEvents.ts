'use client';

/**
 * Engagement funnel events — the five actions that mean a user is actually
 * using CardStreet rather than just visiting it.
 *
 * WHY THESE FIVE, AND WHY THESE NAMES: the rewards ledger already records
 * exactly this set (scan_confirm, vault_add, wishlist_add, listing_publish and
 * the offer flow — see lib/rewardTiers.ts QUESTS_BY_WEEKDAY and the triggers in
 * 20260828_collector_pass_foundation.sql), because they are the actions the
 * product decided are worth paying XP for. GA4 knew about none of them: the
 * property could report sessions and sign_up, and then nothing at all until a
 * purchase — which, with 9 buyers ever, is a funnel with no middle. Reusing the
 * ledger's own rule keys as the event names means the two data sets answer the
 * same question in the same vocabulary, and a GA count that diverges from a
 * ledger count is a bug you can see.
 *
 * Rides the GA tag already mounted in app/layout.tsx (env-gated on
 * NEXT_PUBLIC_GA_MEASUREMENT_ID), like lib/signupEvents.ts and
 * lib/breakerEvents.ts. sendGAEvent pushes onto window.dataLayer, which is
 * inert when the tag isn't loaded, so every call here is safe in dev and in
 * preview builds.
 *
 * Fired at the shared choke point for each action (the hook, the service, the
 * modal) rather than at each component call site, so a new surface that reuses
 * the same code path is instrumented by construction — the same reasoning that
 * puts the Meta CompleteRegistration event inside trackSignUp.
 *
 * Analytics must never break the action being measured: everything is swallowed.
 */

import { Capacitor } from '@capacitor/core';
import { sendGAEvent } from '@next/third-parties/google';

export type EngagementEvent =
    | 'scan_confirm'
    | 'scan_reject'
    | 'vault_add'
    | 'wishlist_add'
    | 'listing_publish'
    | 'offer_made';

/**
 * Which shell the action happened in. The Capacitor app loads cardstreet.app in
 * a WebView, so its events reach GA4 through the same web tag as a desktop
 * browser's; without this every app action is indistinguishable from a web one.
 * Same parameter (and same reasoning) as lib/signupEvents.ts.
 */
function surface(): 'native_app' | 'web' {
    try {
        return Capacitor.isNativePlatform() ? 'native_app' : 'web';
    } catch {
        return 'web';
    }
}

export function trackEngagement(
    name: EngagementEvent,
    params: Record<string, string | number | boolean> = {},
): void {
    if (typeof window === 'undefined') return;
    try {
        sendGAEvent('event', name, { ...params, surface: surface() });
    } catch {
        // GA not loaded (env var unset) — nothing to report to.
    }
}
