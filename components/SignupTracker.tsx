'use client';

/**
 * Fires the GA4 `sign_up` event for OAuth (Google / Apple) account creation.
 *
 * WHY A LANDING-PARAM HANDSHAKE AND NOT A CLICK HANDLER: at the moment the user
 * taps "Continue with Google" the browser knows nothing about whether they are
 * new or returning — signInWithOAuth navigates away, and the answer only exists
 * after the provider round trip. app/api/auth/callback/route.ts is the first
 * place that can tell (see the created_at check there), so it marks a brand-new
 * account with ?cs_new_account=<provider> on the redirect and this component
 * turns that into the event.
 *
 * The event has to fire client-side, in this browser session: GA4's
 * organic/referral attribution lives in the session, and a server-side ping
 * would arrive with no channel attached — which would defeat the entire point
 * of the instrumentation.
 *
 * Renders nothing. Mounted in both shells, like AuthLinkErrorNotice: the mobile
 * SPA (components/MobileHome.tsx) and the desktop layout (app/desktop/layout.tsx).
 */

import { useEffect, useRef } from 'react';
import { trackSignUp, signUpMethodFromProvider } from '@/lib/signupEvents';

export default function SignupTracker() {
    // React 18 StrictMode double-invokes effects in development. The param is
    // stripped below, so the second pass is already a no-op — but the guard
    // makes double-counting impossible rather than merely unlikely.
    const firedRef = useRef(false);

    useEffect(() => {
        if (typeof window === 'undefined' || firedRef.current) return;

        let url: URL;
        try {
            url = new URL(window.location.href);
        } catch {
            return;
        }

        const provider = url.searchParams.get('cs_new_account');
        if (!provider) return;
        firedRef.current = true;

        trackSignUp(signUpMethodFromProvider(provider));

        // Strip the marker so a refresh, a back-navigation, or a link the user
        // shares can never replay the conversion.
        url.searchParams.delete('cs_new_account');
        const search = url.searchParams.toString();
        window.history.replaceState(
            null,
            '',
            `${url.pathname}${search ? `?${search}` : ''}${url.hash}`
        );
    }, []);

    return null;
}
