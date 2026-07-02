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
        // Google Tag Manager / gtag injected-script parse failures
        // (CARDSTREET-1/-2/-5/-6): the analytics <script> fails to compile
        // during appendChild. Blink reports "...appendChild... Invalid or
        // unexpected token"; WebKit/iOS reports the identical failure as a bare
        // SyntaxError "Unexpected EOF". Confirmed third-party noise (zero
        // affected app users), so the WebKit twin is now filtered too — the
        // anchored regex matches only the script-compiler EOF, never a real
        // "JSON Parse error: ...Unexpected EOF" from app code.
        // Android WebView / Capacitor bridge teardown (CARDSTREET-17/-18). The
        // native bridge throws "Error invoking postMessage: Java object is gone"
        // when JS reaches it after Android has destroyed the WebView's backing
        // Java object (app backgrounded, activity recreated, low-memory reclaim).
        // The native peer is already gone — nothing to fix in JS, zero impact.
        ignoreErrors: [
            /googletagmanager/i,
            "Failed to execute 'appendChild' on 'Node': Invalid or unexpected token",
            /^(?:SyntaxError: )?Unexpected EOF$/,
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
