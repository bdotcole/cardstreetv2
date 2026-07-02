/**
 * Next.js instrumentation entrypoint.
 *
 * Replaces sentry.server.config.ts and sentry.edge.config.ts. Next.js invokes
 * `register()` once per server runtime (nodejs and edge are separate), so we
 * branch on NEXT_RUNTIME and Sentry.init for each.
 *
 * Required by Sentry 8+ on Next.js 15+. Without this file, server-side
 * Sentry initialization is silently skipped.
 *
 * Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */

import * as Sentry from '@sentry/nextjs';

export async function register() {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return; // No-op in environments without Sentry configured

    const environment = process.env.VERCEL_ENV === 'production' ? 'production' : 'development';

    // 10% transaction sampling: full tracing at launch-traffic volume burns the
    // Sentry quota that error events need. Errors are always captured; this
    // only samples performance transactions.
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        Sentry.init({
            dsn,
            environment,
            tracesSampleRate: 0.1,
        });
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
        Sentry.init({
            dsn,
            environment,
            tracesSampleRate: 0.1,
        });
    }
}

// Wires server-side request errors into Sentry's structured error capture.
// Required for Next.js to surface route handler errors with full context.
export const onRequestError = Sentry.captureRequestError;
