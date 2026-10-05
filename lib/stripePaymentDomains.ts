/**
 * Apple Pay and Google Pay only appear in the Payment Element on a domain that
 * is registered with Stripe, and the registration has to sit on the account
 * that runs the charge. Cardstreet charges with DIRECT charges (the
 * PaymentIntent lives on the seller's connected account), so cardstreet.app
 * must be registered on EVERY seller's account, not once on the platform.
 * Nothing did that before 2026-10, so the wallets never showed at checkout.
 * https://docs.stripe.com/payments/payment-methods/pmd-registration (Connect)
 *
 * Only the apex: www.cardstreet.app and the alias domains 308 to it, so the
 * payment form never renders on another host. Stripe does Apple's merchant
 * validation itself; there is no association file to serve.
 *
 * Three callers keep every seller covered: /api/orders/estimate (before the
 * payment form mounts), Connect onboarding (new accounts) and the daily
 * /api/cron/payment-domains sweep (everyone else).
 */

import type Stripe from 'stripe';

export const CHECKOUT_DOMAINS = ['cardstreet.app'] as const;

export interface PaymentDomainResult {
    domain: string;
    action: 'ok' | 'created' | 'enabled' | 'error';
    applePay?: string;
    googlePay?: string;
    error?: string;
}

// Accounts already confirmed by this server instance. The estimate route runs
// on every payment-form open; one Stripe round trip per seller per warm
// instance is plenty.
const confirmed = new Set<string>();

export async function ensurePaymentMethodDomains(
    stripe: Stripe,
    stripeAccount: string,
): Promise<PaymentDomainResult[]> {
    if (confirmed.has(stripeAccount)) return [];
    const opts = { stripeAccount };
    const results: PaymentDomainResult[] = [];

    for (const domain of CHECKOUT_DOMAINS) {
        try {
            const existing = await stripe.paymentMethodDomains.list({ domain_name: domain, limit: 1 }, opts);
            let pmd = existing.data[0];
            let action: PaymentDomainResult['action'] = 'ok';
            if (!pmd) {
                pmd = await stripe.paymentMethodDomains.create({ domain_name: domain, enabled: true }, opts);
                action = 'created';
            } else if (!pmd.enabled) {
                pmd = await stripe.paymentMethodDomains.update(pmd.id, { enabled: true }, opts);
                action = 'enabled';
            } else if (pmd.apple_pay?.status === 'inactive') {
                // A registration whose Apple Pay check failed stays inactive
                // until it is validated again.
                pmd = await stripe.paymentMethodDomains.validate(pmd.id, {}, opts);
            }
            results.push({
                domain,
                action,
                applePay: pmd.apple_pay?.status,
                googlePay: pmd.google_pay?.status,
            });
        } catch (e) {
            results.push({ domain, action: 'error', error: (e as Error).message });
        }
    }

    if (results.every((r) => r.action !== 'error')) confirmed.add(stripeAccount);
    return results;
}

/**
 * For request paths: waits at most `ms`, never throws. A slow or failing
 * Stripe call must not hold up checkout; the daily sweep catches the account.
 */
export async function ensurePaymentMethodDomainsWithin(
    stripe: Stripe,
    stripeAccount: string,
    ms: number,
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            ensurePaymentMethodDomains(stripe, stripeAccount).then((results) => {
                const failed = results.filter((r) => r.action === 'error');
                if (failed.length) {
                    console.warn(`[PaymentDomains] ${stripeAccount}: ${failed.map((r) => `${r.domain}: ${r.error}`).join('; ')}`);
                }
            }),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }),
        ]);
    } catch (e) {
        console.warn(`[PaymentDomains] ${stripeAccount} (non-fatal):`, (e as Error).message);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
