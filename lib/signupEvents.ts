'use client';

/**
 * Account-creation funnel events.
 *
 * WHY THIS EXISTS: GA4 recorded traffic but had never recorded a signup, so
 * "how many accounts came from organic search" had no answer — and none that
 * could be recovered later, since nothing was writing it down. Measured
 * 2026-08-24: the only custom events the property had ever seen were the five
 * `breaker_application_*` ones.
 *
 * Rides the GA tag already mounted in app/layout.tsx (env-gated on
 * NEXT_PUBLIC_GA_MEASUREMENT_ID) — no new provider and no new script tag, the
 * same approach as lib/breakerEvents.ts. sendGAEvent pushes onto
 * window.dataLayer, which is inert when the tag isn't loaded, so every call
 * here is safe in dev and in preview builds.
 *
 * Analytics must never break a signup: all dispatch errors are swallowed.
 */

import { Capacitor } from '@capacitor/core';
import { sendGAEvent } from '@next/third-parties/google';
import { trackMetaEvent } from '@/lib/metaEvents';

export type SignUpMethod = 'email' | 'google' | 'apple' | 'oauth';

/**
 * Which shell the account was created in.
 *
 * The Capacitor app loads cardstreet.app in a WebView, so its signups reach GA4
 * through the same web tag as a desktop browser's. Without this parameter every
 * app signup is indistinguishable from a web signup — which is precisely the
 * split this instrumentation exists to measure.
 */
function surface(): 'native_app' | 'web' {
    try {
        return Capacitor.isNativePlatform() ? 'native_app' : 'web';
    } catch {
        // Bridge missing (plain web build) — not native.
        return 'web';
    }
}

/**
 * Fire once per account created.
 *
 * Deliberately fired at account creation, NOT at email verification. The
 * verification link is opened from a mail client, routinely in a different
 * browser session and sometimes on a different device, by which point GA4's
 * channel attribution for the original visit is gone. Firing here keeps the
 * signup inside the session Google can still attribute to organic search.
 *
 * The cost is that unverified accounts are counted. If a verified-only number
 * is ever needed, add a separate event rather than moving this one — the two
 * questions (where did they come from / did they stick) need two events.
 */
export function trackSignUp(method: SignUpMethod): void {
    if (typeof window === 'undefined') return;
    try {
        // 'sign_up' with a 'method' param is GA4's own recommended-event
        // vocabulary, so this populates the built-in acquisition reports
        // instead of needing a custom dimension.
        sendGAEvent('event', 'sign_up', { method, surface: surface() });
    } catch {
        // GA not loaded (env var unset) — nothing to report to.
    }

    // Meta's standard registration conversion. Routed through trackMetaEvent so
    // it reaches the web Pixel AND, inside the native app, the Facebook iOS SDK —
    // the same fan-out Purchase and InitiateCheckout already use.
    //
    // Placed inside trackSignUp rather than at each call site so it cannot drift
    // out of step with the GA4 event: every path that counts a signup counts it
    // in both places, by construction.
    //
    // No value/currency: a registration has no monetary amount, and inventing one
    // would corrupt ROAS for any campaign optimising on this event.
    try {
        trackMetaEvent('CompleteRegistration');
    } catch {
        // trackMetaEvent swallows its own errors; this is belt and braces.
    }
}

/**
 * Normalize the provider string Supabase reports on the account into the
 * `method` vocabulary above. Anything unrecognised stays honest as 'oauth'
 * rather than being guessed into a specific provider.
 */
export function signUpMethodFromProvider(provider: string | null | undefined): SignUpMethod {
    return provider === 'google' || provider === 'apple' || provider === 'email'
        ? provider
        : 'oauth';
}
