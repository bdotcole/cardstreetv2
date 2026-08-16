'use client';

/**
 * Error boundary for the desktop tree.
 *
 * Nested below app/desktop/layout.tsx, so a failing desktop page is contained
 * inside the shell's <main> and DesktopNav / DesktopFooter / the cart drawer
 * stay mounted. Without it the nearest boundary would be app/error.tsx, which
 * sits above this layout and would take the desktop chrome down with the page.
 */

import RouteErrorState from '@/components/RouteErrorState';

export default function DesktopPageError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <RouteErrorState error={error} reset={reset} />;
}
