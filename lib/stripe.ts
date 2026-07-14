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
 * Returns every webhook signing secret configured for the given region —
 * primary plus any "Connect" companion secrets. We use direct charges on
 * the TH platform, which means payment_intent.* events fire on the
 * connected account (a separate event destination in the Stripe Dashboard
 * with its own signing secret) while account.updated still fires on the
 * platform (the original event destination's secret). To serve both
 * destinations on one endpoint, we try each secret in turn when verifying.
 *
 * Env layout:
 *   STRIPE_WEBHOOK_SECRET_TH         - platform-account events (account.updated, etc.)
 *   STRIPE_WEBHOOK_SECRET_TH_CONNECT - connected-account events (payment_intent.*)
 *
 * The CONNECT variant is optional; if unset, only the primary secret is
 * tried (back-compat with the old single-destination setup).
 */
export function getAllWebhookSecretsForRegion(region: StripeRegion): string[] {
    const secrets: string[] = [];
    const primary = process.env[webhookSecretEnvKeyFor(region)]?.trim();
    if (primary) secrets.push(primary);

    const connectEnvKey = region === 'th'
        ? 'STRIPE_WEBHOOK_SECRET_TH_CONNECT'
        : 'STRIPE_WEBHOOK_SECRET_CONNECT';
    const connect = process.env[connectEnvKey]?.trim();
    if (connect) secrets.push(connect);

    if (secrets.length === 0) {
        throw new Error(`[Stripe] No webhook secret configured for region ${region}.`);
    }
    return secrets;
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
 * Extracts the buyer's ACTUAL payment method from a PaymentIntent, normalized
 * to our `orders.payment_method` vocabulary ('credit_card' | 'promptpay' | …).
 *
 * Why this exists: /api/orders/checkout seeds `orders.payment_method` from the
 * client's declared method BEFORE the buyer picks one in Stripe's
 * PaymentElement (which offers card + PromptPay via automatic_payment_methods).
 * That seed defaults to 'credit_card' and is never corrected, so a PromptPay
 * purchase — paid or abandoned — is mislabeled 'credit_card' in the DB, making
 * it impossible to measure PromptPay completion vs. abandonment. Callers pass
 * the retrieved PaymentIntent here (webhook on success, reconcile cron on
 * cancel) to stamp the real method.
 *
 * Reads the most authoritative source available, in order:
 *   1. the expanded PaymentMethod (`expand: ['payment_method']`) — set once the
 *      buyer confirms, even for an abandoned/unpaid attempt;
 *   2. the expanded latest Charge's payment_method_details — present after a
 *      successful charge;
 *   3. `payment_method_types` only when it has collapsed to a single method
 *      (an unconfirmed automatic-methods PI lists several — ambiguous, skip).
 * Returns null when the method can't be determined, so callers leave the
 * existing value untouched rather than guessing.
 */
export function orderPaymentMethodFromIntent(pi: Stripe.PaymentIntent): string | null {
    const normalize = (type: string | null | undefined): string | null => {
        if (!type) return null;
        // Stripe calls it 'card'; our schema/UI has always said 'credit_card'.
        return type === 'card' ? 'credit_card' : type;
    };

    // 1. Expanded PaymentMethod object.
    const pm = pi.payment_method;
    if (pm && typeof pm !== 'string' && pm.type) {
        return normalize(pm.type);
    }

    // 2. Expanded latest Charge (succeeded OR failed — a failed charge still
    //    records which method was attempted).
    const charge = pi.latest_charge;
    if (charge && typeof charge !== 'string') {
        const detailsType = charge.payment_method_details?.type;
        if (detailsType) return normalize(detailsType);
    }

    // 3. The method that failed — e.g. a PromptPay QR that expired unpaid moves
    //    the PI to requires_payment_method and detaches `payment_method`, but
    //    the failed attempt's method survives here. Always embedded (no expand).
    const failedType = pi.last_payment_error?.payment_method?.type;
    if (failedType) return normalize(failedType);

    // 4. Unambiguous single-method PI.
    if (Array.isArray(pi.payment_method_types) && pi.payment_method_types.length === 1) {
        return normalize(pi.payment_method_types[0]);
    }

    return null;
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
