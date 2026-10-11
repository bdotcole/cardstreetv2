/**
 * Client-side Sentry initialization.
 *
 * Replaces sentry.client.config.ts. Required form for Sentry 8+ on Next.js
 * with Turbopack — the old file name will stop working in Next 16.
 *
 * Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */

import * as Sentry from '@sentry/nextjs';
import { installDomMutationGuard } from '@/lib/domMutationGuard';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// An exception whose every frame is <anonymous> ran in code with no source
// file: a script the host browser evaluated into the page. ZTE's system
// WebView injects autofill/CSS helpers that call globals it never defines
// ("xbrowser is not defined" from execute_auto_fill, "swbrowser is not
// defined" from needInjectCss, CARDSTREET-4D/4C). When the injected code ran
// from a setTimeout, Sentry's own timer wrapper is the outermost frame, so
// that one frame is allowed. Our own code always has a /_next/ or page-URL
// frame where it throws, so it never matches.
const isHostInjectedScriptError = (event: Sentry.ErrorEvent): boolean => {
    const values = event.exception?.values;
    if (!values?.length) return false;
    return values.every((value) => {
        const frames = value.stacktrace?.frames ?? [];
        const wrapped = (value.mechanism?.type ?? '').startsWith('auto.browser.browserapierrors');
        const own = wrapped ? frames.slice(1) : frames;
        return own.length > 0 && own.every((frame) => frame.filename === '<anonymous>');
    });
};

if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ? 'production' : 'development',
        // 10% transaction sampling — full tracing at ad-push traffic volume
        // burns the quota error events need. Errors are always captured.
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        // Android WebView / Capacitor bridge teardown (CARDSTREET-17/-18). The
        // native bridge throws "Error invoking postMessage: Java object is gone"
        // when JS reaches it after Android has destroyed the WebView's backing
        // Java object (app backgrounded, activity recreated, low-memory reclaim).
        // The native peer is already gone — nothing to fix in JS, zero impact.
        //
        // Nothing else is filtered. Four gtag entries sat here
        // (CARDSTREET-1/-1B/-2/-5/-6) for an injected-script parse failure read
        // as third-party noise. It was ours: NEXT_PUBLIC_GA_MEASUREMENT_ID
        // carried a trailing CRLF, so the GA <script> src was malformed, the
        // querySelector next/script uses to dedupe the tag threw on every page
        // load, and analytics recorded nothing for months. Fixed at the source
        // (0293936 trims the value; both Vercel entries cleaned), so the
        // suppressions are gone. Two were anchored bare-message regexes
        // (/^(?:SyntaxError: )?Invalid or unexpected token$/ and its Unexpected
        // EOF twin) which also swallowed real syntax errors from our own bundle
        // — that blind spot is why the failure went unnoticed. Don't reintroduce
        // a bare-message filter to quiet a symptom; fix what is throwing.
        //
        // The two added since are exact messages from code that is not ours
        // and that we cannot catch:
        // - supabase auth-js's own fire-and-forget calls (the visibility-change
        //   session recovery, onAuthStateChange's initial emit) give up after
        //   10s when the iOS app resumes while a suspended token refresh still
        //   holds the auth lock, and reject with nothing awaiting them
        //   (CARDSTREET-2B). The refresh that holds the lock completes.
        // - "runtime.sendMessage ... Tab not found" is the WebExtension API,
        //   which this app never calls: DuckDuckGo's iOS browser's own
        //   scripts (CARDSTREET-4F, no stack frames at all).
        ignoreErrors: [
            /Java object is gone/i,
            /Error invoking postMessage/i,
            /^Acquiring process lock with name "lock:sb-[a-z0-9]+-auth-token" timed out$/,
            /^Invalid call to runtime\.sendMessage\(\)\. Tab not found\.$/,
        ],
        beforeSend(event) {
            return isHostInjectedScriptError(event) ? null : event;
        },
        integrations: [
            Sentry.browserTracingIntegration(),
        ],
    });

    // Session replay only where there is a session to replay: the app shell at
    // "/". The SEO pages (/card, /sets, the game landings) are served to phones
    // straight from search and were carrying ~530 KB of replay recorder in the
    // root bundle for sessions that almost never trigger it. Loaded lazily from
    // Sentry's CDN so it never sits in the initial bundle at all.
    if (typeof window !== 'undefined' && window.location.pathname === '/') {
        Sentry.lazyLoadIntegration('replayIntegration')
            .then((replayIntegration) => {
                Sentry.addIntegration(replayIntegration({ maskAllText: true, blockAllMedia: true }));
            })
            .catch(() => { /* replay is a diagnostic nicety, not a dependency */ });
    }
}

// Before hydration, so React's first commit already runs with it.
if (typeof window !== 'undefined') installDomMutationGuard();

// Surfaces client-side router transition errors in Sentry. Required hook
// export for Next.js App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
