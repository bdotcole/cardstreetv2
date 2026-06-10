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
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        // Google Tag Manager noise (CARDSTREET-1/-2/-6): gtag's injected
        // script failing to parse, or its preload-link querySelector throwing
        // in certain webviews/extensions. Hundreds of events, zero affected
        // users, drowns out real regressions. Deliberately NOT filtering
        // WebKit's "Unexpected EOF" — truncated script loads are evidence we
        // want while diagnosing iPad/WKWebView behavior.
        ignoreErrors: [
            /googletagmanager/i,
            "Failed to execute 'appendChild' on 'Node': Invalid or unexpected token",
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
