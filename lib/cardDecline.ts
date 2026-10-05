import type { StripeError } from '@stripe/stripe-js';

/**
 * Reading a failed confirmPayment. Shared by components/PaymentModal.tsx and
 * components/live/SpotPaymentSheet.tsx.
 *
 * The default decline advice ("try PromptPay") only helps someone with a Thai
 * bank account. A buyer paying with a card issued abroad (a tourist, an expat)
 * cannot use PromptPay. Their decline is almost always their own bank blocking
 * overseas online payments, which they can switch on in their banking app.
 * Stripe Thailand itself accepts foreign credit AND debit cards (Visa/MC), so
 * this is the bank's call, not ours. The StripeError carries the card's
 * issuing country, so the two cases can get different advice with no extra
 * call.
 */

export interface DeclinedCard {
    country: string | null;
    funding: string | null;
    brand: string | null;
    wallet: string | null;
}

export function isCardDecline(error: StripeError): boolean {
    return error.type === 'card_error' || error.code === 'card_declined' || !!error.decline_code;
}

export function declinedCard(error: StripeError): DeclinedCard | null {
    const card = error.payment_method?.card;
    if (!card) return null;
    return {
        country: card.country ?? null,
        funding: card.funding ?? null,
        brand: card.brand ?? null,
        wallet: card.wallet?.type ?? null,
    };
}

/** Unknown country counts as Thai: the existing PromptPay advice stays the default. */
export function isForeignCard(card: DeclinedCard | null): boolean {
    return !!card?.country && card.country.toUpperCase() !== 'TH';
}
