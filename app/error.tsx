'use client';

/**
 * Route-level error boundary.
 *
 * Sits inside the root layout, so a throw in any route segment replaces only
 * the page body -- <head>, the providers, and the shell survive, and the user
 * keeps a working way out.
 *
 * Until this existed the only boundary was app/global-error.tsx, which
 * substitutes its own <html> document: a single component failing anywhere in
 * the tree stripped the entire app down to a bare "Something went wrong"
 * screen. global-error.tsx stays as the last resort -- for failures in the root
 * layout itself, and for a throw inside this component.
 *
 * Routes under app/desktop keep their own boundary (app/desktop/error.tsx) so
 * a failure there leaves the desktop nav and footer standing.
 */

import RouteErrorState from '@/components/RouteErrorState';

export default function PageError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <RouteErrorState error={error} reset={reset} />;
}
