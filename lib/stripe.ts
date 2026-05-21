/**
 * Region-aware Stripe clients.
 *
 * CardStreet runs two Stripe platforms under the same organization:
 *   - 'us' — US-entity Stripe account. Charges in USD by default; existing
 *     code paths that historically charged THB on this platform remain valid
 *     until callers migrate to the TH platform.
 *   - 'th' — Stripe Thailand account. Native THB processing, unlocks PromptPay
 *     as a payment method on Checkout / PaymentIntents.
 *
 * Each platform has its own secret key and webhook signing secret:
 *   STRIPE_SECRET_KEY        + STRIPE_WEBHOOK_SECRET        (US)
 *   STRIPE_SECRET_KEY_TH     + STRIPE_WEBHOOK_SECRET_TH     (TH)
 *
 * Clients are lazy-initialized so a build that doesn't have the env vars set
 * (e.g. preview deploy without TH key, or a dev importing this for tooling)
 * doesn't crash at module load — the error only fires at first request.
 */

import Stripe from 'stripe';

export type StripeRegion = 'us' | 'th';

const clients: Partial<Record<StripeRegion, Stripe>> = {};

function envKeyFor(region: StripeRegion): string {
    return region === 'th' ? 'STRIPE_SECRET_KEY_TH' : 'STRIPE_SECRET_KEY';
}

function webhookSecretEnvKeyFor(region: StripeRegion): string {
    return region === 'th' ? 'STRIPE_WEBHOOK_SECRET_TH' : 'STRIPE_WEBHOOK_SECRET';
}

/**
 * Returns true if the given region has its secret key configured. UI and
 * onboarding flows use this to feature-flag the TH path until the env var
 * lands in Vercel.
 */
export function isRegionConfigured(region: StripeRegion): boolean {
    return !!process.env[envKeyFor(region)];
}

export function getStripeForRegion(region: StripeRegion): Stripe {
    const cached = clients[region];
    if (cached) return cached;

    const envKey = envKeyFor(region);
    const key = process.env[envKey];
    if (!key) {
        throw new Error(
            `[Stripe] ${envKey} is not set. Configure it in Vercel ` +
            `(Production + Preview) and redeploy.`
        );
    }

    const client = new Stripe(key, {
        httpClient: Stripe.createFetchHttpClient(),
    });
    clients[region] = client;
    return client;
}

/**
 * Returns the webhook signing secret for the given region. Throws a clear
 * error rather than returning undefined so the webhook handler fails closed
 * if a region is misconfigured.
 */
export function getWebhookSecretForRegion(region: StripeRegion): string {
    const envKey = webhookSecretEnvKeyFor(region);
    const secret = process.env[envKey]?.trim();
    if (!secret) {
        throw new Error(`[Stripe] ${envKey} is not set.`);
    }
    return secret;
}

/**
 * Back-compat alias: the existing US platform. All historical callers used
 * this; new code should prefer getStripeForRegion(region) with an explicit
 * region argument so the platform routing is visible.
 */
export function getStripe(): Stripe {
    return getStripeForRegion('us');
}

/**
 * Returns the default currency for charges on the given platform. THB is the
 * only currency the TH platform processes; the US platform historically
 * charged THB but going forward defaults to USD for new flows.
 */
export function defaultCurrencyForRegion(region: StripeRegion): 'usd' | 'thb' {
    return region === 'th' ? 'thb' : 'usd';
}

/**
 * Returns the Stripe `payment_method_types` array for a checkout/PaymentIntent
 * on the given platform. PromptPay is only available on the TH platform.
 */
export function paymentMethodTypesForRegion(region: StripeRegion): string[] {
    return region === 'th' ? ['card', 'promptpay'] : ['card'];
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
