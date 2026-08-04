'use client';

/**
 * "Add a card to bid" — saves a card on the CardStreet platform (TH) customer
 * via a SetupIntent so live wins can be charged off-session. Card-only:
 * PromptPay can't be charged off-session, so live bidding requires a card.
 *
 * The card is tokenized in the PLATFORM context (no stripeAccount) — it's saved
 * on the platform customer, then cloned to the seller's connected account at
 * charge time (see lib/liveStreamPayments.ts). This differs from PaymentModal,
 * which tokenizes in the SELLER account context for direct-charge checkout.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { Stripe, StripeElementsOptions } from '@stripe/stripe-js';
import { useTranslation } from '@/lib/hooks/useTranslation';

const PUBLISHABLE_KEY = (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TH ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    ''
).trim();

// Platform-context Stripe.js (no stripeAccount) — the live card is saved on the
// platform customer. Cached module-wide so re-opens reuse one instance.
let platformStripePromise: Promise<Stripe | null> | null = null;
function getPlatformStripe(): Promise<Stripe | null> | null {
    if (!PUBLISHABLE_KEY) return null;
    if (!platformStripePromise) platformStripePromise = loadStripe(PUBLISHABLE_KEY);
    return platformStripePromise;
}

interface AddCardToBidProps {
    /** Fired with the saved PaymentMethod id once the card is persisted. */
    onSaved?: (paymentMethodId: string) => void;
    onCancel?: () => void;
}

const SetupForm: React.FC<{ onSaved?: (pm: string) => void }> = ({ onSaved }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { t } = useTranslation();
    const [submitting, setSubmitting] = useState(false);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!stripe || !elements) return;
        setSubmitting(true);
        setError(null);
        try {
            const submitRes = await elements.submit();
            if (submitRes.error) {
                setError(submitRes.error.message || 'Please check your card details.');
                return;
            }
            const { error: confirmError, setupIntent } = await stripe.confirmSetup({
                elements,
                confirmParams: { return_url: window.location.href },
                redirect: 'if_required',
            });
            if (confirmError) {
                setError(confirmError.message || 'Could not save your card.');
                return;
            }
            if (setupIntent?.status === 'succeeded') {
                const res = await fetch('/api/streams/payment-method/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ setupIntentId: setupIntent.id }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setError(data?.error || 'Could not save your card.');
                    return;
                }
                onSaved?.(data.paymentMethod);
            } else {
                setError(`Card not saved (status: ${setupIntent?.status ?? 'unknown'}).`);
            }
        } catch (e: any) {
            setError(e?.message || 'Something went wrong saving your card.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <PaymentElement onReady={() => setReady(true)} />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
                type="button"
                onClick={handleSave}
                disabled={!stripe || !ready || submitting}
                className="w-full rounded-xl bg-white py-3 font-bold text-black disabled:opacity-50"
            >
                {submitting
                    ? (t('live.payment.saving') || 'Saving…')
                    : (t('live.payment.saveCard') || 'Save card')}
            </button>
        </div>
    );
};

const AddCardToBid: React.FC<AddCardToBidProps> = ({ onSaved, onCancel }) => {
    const { t } = useTranslation();
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const res = await fetch('/api/streams/payment-method/setup', { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (!active) return;
                if (!res.ok) {
                    setError(data?.error || 'Could not start card setup.');
                    return;
                }
                setClientSecret(data.clientSecret);
            } catch {
                if (active) setError('Could not start card setup.');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    const stripePromise = getPlatformStripe();

    const options: StripeElementsOptions | null = useMemo(
        () => (clientSecret ? { clientSecret, appearance: { theme: 'night' } } : null),
        [clientSecret],
    );

    return (
        <div className="flex flex-col gap-3">
            <div>
                <h3 className="text-lg font-bold text-white">
                    {t('live.payment.addCard') || 'Add a card to bid'}
                </h3>
                <p className="text-sm text-slate-400">
                    {t('live.payment.cardOnlyNotice') ||
                        'Live bidding is card-only. Your card is charged only if you win.'}
                </p>
            </div>

            {!PUBLISHABLE_KEY && (
                <p className="text-sm text-red-400">Payments are not configured.</p>
            )}
            {loading && <p className="text-sm text-slate-400">{t('live.payment.loading') || 'Loading…'}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}

            {stripePromise && options && (
                <Elements stripe={stripePromise} options={options}>
                    <SetupForm onSaved={onSaved} />
                </Elements>
            )}

            {onCancel && (
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-sm text-slate-400 hover:text-slate-200"
                >
                    {t('common.cancel') || 'Cancel'}
                </button>
            )}
        </div>
    );
};

export default AddCardToBid;
