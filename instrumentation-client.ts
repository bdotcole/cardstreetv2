/**
 * Client-side Sentry initialization.
 *
 * Replaces sentry.client.config.ts. Required form for Sentry 8+ on Next.js
 * with Turbopack — the old file name will stop working in Next 16.
 *
 * Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

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
        ignoreErrors: [
            /Java object is gone/i,
            /Error invoking postMessage/i,
        ],
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({
                maskAllText: true,
                blockAllMedia: true,
            }),
        ],
    });
}

// Surfaces client-side router transition errors in Sentry. Required hook
// export for Next.js App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
