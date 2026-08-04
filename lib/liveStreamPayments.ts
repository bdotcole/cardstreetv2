/**
 * Live-stream off-session payment rail (TH platform, server-only).
 *
 * Live bidding requires a card on file: the buyer saves a card via a
 * SetupIntent(usage='off_session') on a CardStreet PLATFORM customer, and at
 * hammer-fall / Buy-It-Now the saved payment method is cloned onto the seller's
 * connected account and charged off-session as a DIRECT charge (seller is
 * merchant of record on TH — see CLAUDE.md Payments). The platform takes an
 * application_fee_amount (the partner-tiered cut).
 *
 * This is the money move validated by the 2026-07-04 TH off-session spike:
 * SetupIntent card-save + cross-account PM clone confirmed in test mode; the
 * off-session direct charge is confirmed structurally and gated on an E2E pass
 * before any real live bidding ships.
 *
 * PromptPay CANNOT be charged off-session, so live bidding is card-only. This
 * module never touches PromptPay — ordinary marketplace checkout keeps it.
 *
 * NEVER import from a 'use client' module: getStripeForRegion reads the secret
 * key. Callers are beta-gated service-role API routes only.
 */

import type Stripe from 'stripe';
import { getStripeForRegion } from '@/lib/stripe';

/**
 * Returns true if the stored platform customer id still resolves to a live
 * (non-deleted) Stripe customer. Used to self-heal a stale id (deleted customer
 * / rotated keys) before reusing it.
 *
 * The caller must orchestrate get-or-create atomically at the DB layer (a
 * compare-and-swap on profiles.stripe_customer_id_th) so concurrent "add a
 * card" calls converge on ONE customer — a static Stripe idempotency key can't
 * be used here because it would collide with the deliberate self-heal re-mint.
 */
export async function isLiveCustomerValid(customerId: string): Promise<boolean> {
    const stripe = getStripeForRegion('th');
    try {
        const c = await stripe.customers.retrieve(customerId);
        return !!c && !(c as { deleted?: boolean }).deleted;
    } catch {
        // resource_missing (deleted / rotated keys) — treat as invalid.
        return false;
    }
}

/** Create a fresh platform (TH) Stripe customer for the buyer. */
export async function createLivePlatformCustomer(
    email: string | null,
    userId: string,
): Promise<string> {
    const stripe = getStripeForRegion('th');
    const created = await stripe.customers.create({
        email: email || undefined,
        metadata: { cardstreet_user_id: userId },
    });
    return created.id;
}

/**
 * Best-effort delete of a just-minted customer that LOST the create-customer
 * race (another concurrent setup call persisted first). Swallows errors — an
 * undeleted orphan is harmless, and cleanup must never fail the request.
 */
export async function deleteLivePlatformCustomer(customerId: string): Promise<void> {
    const stripe = getStripeForRegion('th');
    try {
        await stripe.customers.del(customerId);
    } catch {
        // Orphan cleanup is best-effort.
    }
}

/**
 * Create a SetupIntent to save a card on the platform customer for later
 * off-session live charges. Card-only (PromptPay can't off-session).
 */
export async function createLiveCardSetupIntent(customerId: string): Promise<Stripe.SetupIntent> {
    const stripe = getStripeForRegion('th');
    return stripe.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        payment_method_types: ['card'],
        metadata: { purpose: 'live_bidding_card' },
    });
}

export interface LiveWinChargeParams {
    /** The seller's TH connected account — the charge is created ON it (direct charge). */
    sellerStripeAccountId: string;
    /** The buyer's platform customer id (profiles.stripe_customer_id_th). */
    platformCustomerId: string;
    /** The buyer's saved platform PM id (profiles.live_default_payment_method). */
    savedPaymentMethodId: string;
    /** Item amount in satang (integer). Shipping is charged separately at close. */
    amountSatang: number;
    /** Platform cut in satang (partner-tiered). Omitted/0 = no application fee. */
    applicationFeeSatang?: number;
    /** Stripe idempotency key — derive from the win id so retries don't double-charge. */
    idempotencyKey: string;
    metadata?: Record<string, string>;
    description?: string;
    /** Defaults to 'thb'. */
    currency?: string;
}

export interface LiveWinChargeResult {
    status: Stripe.PaymentIntent.Status;
    paymentIntentId: string;
    clonedPaymentMethodId: string;
}

/**
 * Charge a live win off-session: clone the buyer's platform-saved card onto the
 * seller's connected account, then create an off-session direct-charge
 * PaymentIntent on that account with the platform application fee.
 *
 * On an off-session charge Stripe THROWS a StripeCardError rather than
 * returning a non-succeeded status: a decline throws code 'card_declined', and
 * a 3DS-mandated card throws code 'authentication_required' (off-session can't
 * surface a challenge). The caller catches these and maps them to the
 * stream_wins pay_window state (buyer retries on-session) — a returned
 * 'requires_action' PaymentIntent is effectively unreachable on this path. A
 * resolved call returns status 'succeeded'.
 */
export async function chargeLiveWinOffSession(p: LiveWinChargeParams): Promise<LiveWinChargeResult> {
    const stripe = getStripeForRegion('th');
    const currency = (p.currency || 'thb').toLowerCase();

    // 1. Clone the platform PM onto the connected account. Clones are single-use
    //    per charge — each win needs a fresh clone (spike finding).
    const cloned = await stripe.paymentMethods.create(
        { customer: p.platformCustomerId, payment_method: p.savedPaymentMethodId },
        // The `:clone` suffix is load-bearing: it dedupes the clone across a
        // retried win (no orphaned clones on the connected account) but must NOT
        // equal the PI's key below — Stripe rejects reusing one key across two
        // structurally different requests.
        { stripeAccount: p.sellerStripeAccountId, idempotencyKey: `${p.idempotencyKey}:clone` },
    );

    // 2. Off-session DIRECT charge created ON the seller's connected account.
    const piParams: Stripe.PaymentIntentCreateParams = {
        amount: p.amountSatang,
        currency,
        payment_method: cloned.id,
        confirm: true,
        off_session: true,
        description: p.description,
        metadata: p.metadata,
    };
    if (
        p.applicationFeeSatang &&
        p.applicationFeeSatang > 0 &&
        p.applicationFeeSatang < p.amountSatang
    ) {
        piParams.application_fee_amount = p.applicationFeeSatang;
    }

    const pi = await stripe.paymentIntents.create(piParams, {
        stripeAccount: p.sellerStripeAccountId,
        idempotencyKey: p.idempotencyKey,
    });

    return {
        status: pi.status,
        paymentIntentId: pi.id,
        clonedPaymentMethodId: cloned.id,
    };
}
