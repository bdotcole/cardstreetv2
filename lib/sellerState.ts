/**
 * One answer to "can this person list, and what should we tell them?".
 *
 * Both shells and three surfaces used to derive this independently, and they
 * disagreed. The mobile shell showed an amber "finish your payout setup" banner
 * keyed on stripe_details_submitted; /sell keyed its banner on chargesEnabled;
 * the listing gate keyed on isStripeOnlyIncomplete. So a seller who had finished
 * Stripe's form but was still in review saw "finish your payout setup" on one
 * screen, a resume button on another, and a working listing form on a third —
 * three different accounts of the same state.
 *
 * The copy that goes with each state matters as much as the state. Draft-first
 * listings have been live since 20260730, which means a seller with no payout
 * account CAN list right now and the listing publishes itself when onboarding
 * finishes. Nothing said so: every message read as a blocker, so sellers
 * bounced off Stripe's KYC form believing they could not list until they
 * finished it.
 *
 * Pure module — no next/*, no supabase, no 'use client' — so a server route, a
 * client component and the desktop tree can all import it.
 */

import {
    checkSellerProfileComplete,
    isStripeOnlyIncomplete,
    type SellerProfileSubset,
} from '@/lib/profileValidation';

export type SellerState =
    /** Not signed in. */
    | 'signed_out'
    /** Missing shipping fields. The one hard block: Flash needs them at
     *  fulfillment, and they take seconds to fill in-app. */
    | 'shipping_incomplete'
    /** Shipping done, no Stripe account yet. Can list as drafts. */
    | 'no_payout_account'
    /** Stripe account exists, KYC form not finished. Can list as drafts. */
    | 'payouts_unfinished'
    /** KYC submitted, Stripe still reviewing. Can list as drafts. */
    | 'payouts_in_review'
    /** charges_enabled — listings go live immediately. */
    | 'ready';

/** The Stripe half, as returned by /api/stripe/connect/status. */
export interface StripeConnectStatus {
    connected?: boolean | null;
    chargesEnabled?: boolean | null;
    detailsSubmitted?: boolean | null;
    payoutsEnabled?: boolean | null;
}

/**
 * States in which a listing may be created. Only shipping is a real block —
 * everything else produces a draft that auto-publishes (lib/draftListings.ts).
 */
export function canListInState(state: SellerState): boolean {
    return state !== 'signed_out' && state !== 'shipping_incomplete';
}

/** True while listings created now would be drafts rather than live. */
export function listsAsDraftInState(state: SellerState): boolean {
    return state === 'no_payout_account' || state === 'payouts_unfinished' || state === 'payouts_in_review';
}

/** Does this state still need the seller to do something about payouts? */
export function needsPayoutActionInState(state: SellerState): boolean {
    return state === 'no_payout_account' || state === 'payouts_unfinished';
}

/**
 * The seller-required fields plus the cached charges flag. charges_enabled is
 * not in SELLER_REQUIRED_PROFILE_FIELDS on purpose (a seller may list before
 * Stripe finishes reviewing), but it is what separates "in review" from
 * "ready", so callers may pass it when they have it.
 */
export type SellerStateProfile = SellerProfileSubset & {
    stripe_charges_enabled?: boolean | null;
};

export function resolveSellerState(
    signedIn: boolean,
    profile: SellerStateProfile | null | undefined,
    stripe: StripeConnectStatus | null | undefined,
): SellerState {
    if (!signedIn) return 'signed_out';

    const completeness = checkSellerProfileComplete(profile);
    // Anything missing that is NOT a Stripe field is a shipping field.
    if (!completeness.complete && !isStripeOnlyIncomplete(completeness.missing)) {
        return 'shipping_incomplete';
    }

    // Prefer the live Stripe status when the caller has it; fall back to the
    // cached profile columns the webhook writes, so a surface that has not
    // fetched /api/stripe/connect/status still resolves something sane.
    const chargesEnabled = stripe?.chargesEnabled ?? profile?.stripe_charges_enabled;
    if (chargesEnabled === true) return 'ready';

    const detailsSubmitted = stripe?.detailsSubmitted ?? profile?.stripe_details_submitted;
    if (detailsSubmitted === true) return 'payouts_in_review';

    const connected = stripe?.connected ?? (typeof profile?.stripe_account_id === 'string' && !!profile.stripe_account_id);
    return connected ? 'payouts_unfinished' : 'no_payout_account';
}

/**
 * Locale keys for each state, under the `sellerState.*` namespace.
 *
 * Returned as keys rather than strings so this module stays free of the
 * translation hook and can be called from a server route. `cta` is null where
 * there is nothing for the seller to do.
 */
export interface SellerStateCopy {
    /** Short status line. */
    titleKey: string;
    /** The reassurance — what they can do right now. */
    bodyKey: string;
    /** Button label, or null when no action is available/needed. */
    ctaKey: string | null;
}

export function sellerStateCopy(state: SellerState): SellerStateCopy {
    switch (state) {
        case 'signed_out':
            return { titleKey: 'sellerState.signedOutTitle', bodyKey: 'sellerState.signedOutBody', ctaKey: 'sellerState.signedOutCta' };
        case 'shipping_incomplete':
            return { titleKey: 'sellerState.shippingTitle', bodyKey: 'sellerState.shippingBody', ctaKey: 'sellerState.shippingCta' };
        case 'no_payout_account':
            return { titleKey: 'sellerState.canListTitle', bodyKey: 'sellerState.canListBody', ctaKey: 'sellerState.payoutsCta' };
        case 'payouts_unfinished':
            return { titleKey: 'sellerState.canListTitle', bodyKey: 'sellerState.canListBody', ctaKey: 'sellerState.payoutsResumeCta' };
        case 'payouts_in_review':
            // No CTA: Stripe is reviewing and there is nothing the seller can
            // press. A button here would be a dead end wearing a promise.
            return { titleKey: 'sellerState.reviewTitle', bodyKey: 'sellerState.reviewBody', ctaKey: null };
        case 'ready':
            return { titleKey: 'sellerState.readyTitle', bodyKey: 'sellerState.readyBody', ctaKey: null };
    }
}
