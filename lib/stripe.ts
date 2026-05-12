/**
 * Lazy-initialized Stripe client.
 *
 * Why lazy: instantiating `new Stripe(process.env.STRIPE_SECRET_KEY!)` at
 * module load means any build step that imports the module (e.g. Next.js
 * page-data collection) crashes if STRIPE_SECRET_KEY isn't set in that
 * environment. Deferring to first call lets the build complete and only
 * fails at request time, with a clear error message.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
    if (_stripe) return _stripe;

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        throw new Error(
            '[Stripe] STRIPE_SECRET_KEY is not set. Configure it in Vercel ' +
            '(Production + Preview) and redeploy.'
        );
    }

    _stripe = new Stripe(key, {
        httpClient: Stripe.createFetchHttpClient(),
    });

    return _stripe;
}

/**
 * Returns the canonical app base URL for Stripe redirect URLs.
 * Honors NEXT_PUBLIC_APP_URL, falls back to localhost in dev, prod URL otherwise.
 */
export function getAppBaseUrl(): string {
    if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
    if (process.env.NODE_ENV === 'development') return 'http://localhost:3000';
    return 'https://cardstreet.app';
}

/**
 * Maps a Stripe Account object to our four-state status enum.
 * Kept here (not in a route file) so route handlers can import it without
 * creating route-to-route module coupling.
 */
export function deriveConnectStatus(account: {
    details_submitted?: boolean;
    payouts_enabled?: boolean;
    requirements?: { disabled_reason?: string | null } | null;
}): 'pending' | 'enabled' | 'restricted' | 'rejected' {
    const disabledReason = account.requirements?.disabled_reason || null;
    if (disabledReason && disabledReason.startsWith('rejected')) return 'rejected';
    if (disabledReason) return 'restricted';
    if (account.payouts_enabled) return 'enabled';
    if (account.details_submitted) return 'restricted'; // Submitted but not yet payable
    return 'pending';
}
