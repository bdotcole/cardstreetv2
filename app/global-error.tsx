'use client';

/**
 * Root error boundary. Catches React render errors anywhere in the tree
 * (including layouts) and reports them to Sentry. Required for Sentry to see
 * client-rendering errors in the App Router — without this file, render
 * errors are silently swallowed by Next.js's default error UI.
 *
 * Must be a self-contained <html><body> document because it replaces the
 * entire app shell when triggered.
 */

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
    error,
}: {
    error: Error & { digest?: string };
}) {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html>
            <body style={{
                fontFamily: 'system-ui, -apple-system, sans-serif',
                background: '#0a0d12',
                color: '#e2e8f0',
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                margin: 0,
            }}>
                <div style={{ textAlign: 'center', maxWidth: 480 }}>
                    <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>
                        Something went wrong
                    </h2>
                    <p style={{ color: '#94a3b8', marginBottom: 24 }}>
                        Our team has been notified. Please refresh the page or try again later.
                    </p>
                    <a
                        href="/"
                        style={{
                            display: 'inline-block',
                            padding: '10px 20px',
                            background: '#22d3ee',
                            color: '#0a0d12',
                            borderRadius: 12,
                            fontWeight: 700,
                            textDecoration: 'none',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                            fontSize: 13,
                        }}
                    >
                        Return home
                    </a>
                </div>
            </body>
        </html>
    );
}
