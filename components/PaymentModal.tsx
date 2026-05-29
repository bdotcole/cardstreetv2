'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { StripeElementsOptions } from '@stripe/stripe-js';
import { useTranslation } from '@/lib/hooks/useTranslation';

// Publishable key, region-aware to match the dual-platform server setup.
// The server reads STRIPE_SECRET_KEY_TH for the Thailand platform; its client
// counterpart is NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TH. We prefer the TH key
// and fall back to the legacy un-suffixed var so either Vercel naming works.
//
// NEXT_PUBLIC_* values are inlined at build time and must be referenced as
// static `process.env.X` member accesses for Next to inline them — don't
// rewrite this as a dynamic lookup. Trim defensively: a trailing space/newline
// pasted into Vercel makes loadStripe() reject the key and renders a blank,
// dead card field.
const PUBLISHABLE_KEY = (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TH ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    ''
).trim();

// Stripe.js instances are cached per connected account. A Thailand direct
// charge requires the card to be tokenized in the SELLER's account context
// (`stripeAccount`) — /api/checkout creates the PaymentIntent on that account,
// and a platform-scoped PaymentMethod would be rejected with "No such
// payment_method." The legacy US platform path loads without an account.
const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(stripeAccount?: string | null): ReturnType<typeof loadStripe> | null {
    if (!PUBLISHABLE_KEY) return null;
    const cacheKey = stripeAccount || '__platform__';
    let promise = stripePromiseCache.get(cacheKey);
    if (!promise) {
        promise = loadStripe(PUBLISHABLE_KEY, stripeAccount ? { stripeAccount } : undefined);
        stripePromiseCache.set(cacheKey, promise);
    }
    return promise;
}

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    amount: number;
    shippingFee?: number;
    currency: string;
    items: any[];
    apiEndpoint?: string; // New prop
    extraData?: any; // New prop
    onPaymentSuccess: (details: { paymentMethod: string, paymentId: string, transferGroup?: string }) => void;
    onPaymentFailed: (error: string) => void;
}

// Inner form — must be inside <Elements> to use useStripe / useElements.
//
// Uses Stripe's *deferred* PaymentElement flow so the modal can offer every
// method the seller's connected account supports (card + PromptPay on TH)
// without us hardcoding a card field:
//   1. elements.submit()        — validate + collect.
//   2. /api/orders/checkout     — create pending orders, reserve inventory,
//                                 get the transfer_group (zombie-payment guard).
//   3. /api/checkout            — create an unconfirmed PaymentIntent on the
//                                 seller's connected account, return client_secret.
//   4. stripe.confirmPayment()  — confirm. Card confirms inline; PromptPay shows
//                                 a QR and settles async (fulfilled by the webhook
//                                 on payment_intent.succeeded).
const PaymentElementForm: React.FC<{
    displayAmount: number;
    currency: string;
    items: any[];
    apiEndpoint?: string;
    extraData?: any;
    onPaymentSuccess: (details: { paymentMethod: string, paymentId: string, transferGroup?: string }) => void;
    onPaymentFailed: (error: string) => void;
    onTotalChanged?: (newTotal: number) => void;
}> = ({ displayAmount, currency, items, apiEndpoint = '/api/checkout', extraData = {}, onPaymentSuccess, onPaymentFailed, onTotalChanged }) => {
    const stripe = useStripe();
    const elements = useElements();
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);

    const handlePay = async () => {
        if (!stripe || !elements) {
            onPaymentFailed('Stripe is not loaded yet. Please try again.');
            return;
        }
        if (apiEndpoint === '/api/checkout' && !extraData?.buyerId) {
            onPaymentFailed('You must be signed in to complete a purchase.');
            return;
        }
        if (!items || items.length === 0) {
            onPaymentFailed('Your cart is empty.');
            return;
        }

        setLoading(true);
        try {
            // Step 1: validate the entered payment details.
            const { error: submitError } = await elements.submit();
            if (submitError) {
                onPaymentFailed(submitError.message || 'Please check your payment details.');
                setLoading(false);
                return;
            }

            // Step 2: create pending orders first (reserve inventory + get a
            // transfer_group). buyerId is derived from the session server-side.
            let transferGroup: string | undefined;
            if (apiEndpoint === '/api/checkout') {
                const orderRes = await fetch('/api/orders/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // 'credit_card' is the value the orders table has always
                    // stored; the actual method (card/PromptPay) is recorded on
                    // the Stripe PaymentIntent. Keep it to avoid any column
                    // constraint surprise.
                    //
                    // expectedTotal is the price the buyer is looking at right
                    // now. The server refuses to charge more than this (returns
                    // TOTAL_CHANGED) so the displayed total is what gets charged.
                    body: JSON.stringify({ items, paymentMethod: 'credit_card', expectedTotal: displayAmount }),
                });
                const orderData = await orderRes.json();
                if (!orderRes.ok || !orderData.success) {
                    if (orderData.code === 'TOTAL_CHANGED' && typeof orderData.total === 'number') {
                        onTotalChanged?.(orderData.total);
                        onPaymentFailed(
                            `Shipping updated — your new total is ${currency === 'THB' ? '฿' : '$'}${orderData.total.toLocaleString()}. Please review and pay again.`
                        );
                    } else {
                        onPaymentFailed(orderData.error || 'Failed to create orders');
                    }
                    setLoading(false);
                    return;
                }
                transferGroup = orderData.transferGroup;
            }

            // Step 3: create the PaymentIntent (no card token — PaymentElement
            // flow). Server computes the authoritative amount from the orders.
            const piRes = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    apiEndpoint === '/api/checkout'
                        ? { currency, metadata: { transfer_group: transferGroup } }
                        : { orderId: items[0]?.id, ...extraData }
                ),
            });
            const piData = await piRes.json();
            if (!piRes.ok || !piData.client_secret) {
                throw new Error(piData.error || 'Could not start payment');
            }

            // Step 4: confirm. redirect:'if_required' keeps card + PromptPay
            // inline (Stripe renders the PromptPay QR itself); return_url is
            // only used if a method actually needs a full redirect.
            const returnUrl = typeof window !== 'undefined'
                ? `${window.location.origin}/?payment_status=complete`
                : 'https://cardstreet.app/?payment_status=complete';

            const { error, paymentIntent } = await stripe.confirmPayment({
                elements,
                clientSecret: piData.client_secret,
                confirmParams: { return_url: returnUrl },
                redirect: 'if_required',
            });

            if (error) {
                onPaymentFailed(error.message || 'Payment failed');
                setLoading(false);
                return;
            }

            const status = paymentIntent?.status;
            const method = paymentIntent?.payment_method_types?.[0] || 'card';

            if (status === 'succeeded') {
                // Synchronous fulfillment fallback. The webhook is canonical and
                // idempotent (CAS guard in fulfillOrdersByTransferGroup); this
                // just avoids a stuck pending_payment order if the webhook is
                // slow or misconfigured. PromptPay never reaches here (it lands
                // on 'processing'); only the webhook fulfills it.
                if (apiEndpoint === '/api/checkout' && transferGroup && paymentIntent) {
                    try {
                        await fetch('/api/orders/finalize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ transferGroup, paymentIntentId: paymentIntent.id }),
                        });
                    } catch {
                        // Non-blocking — webhook is the canonical path.
                    }
                }
                onPaymentSuccess({ paymentMethod: method, paymentId: paymentIntent!.id, transferGroup });
            } else if (status === 'processing') {
                // PromptPay (and other async methods): the buyer has authorized;
                // funds settle shortly and the webhook fulfills on succeeded.
                onPaymentSuccess({ paymentMethod: method, paymentId: paymentIntent!.id, transferGroup });
            } else {
                onPaymentFailed('Payment not completed: ' + (status || 'unknown'));
            }
        } catch (e: any) {
            onPaymentFailed(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-4 min-h-[44px]">
                <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
            </div>
            <button
                onClick={handlePay}
                disabled={loading || !stripe || !ready}
                className={`mt-4 w-full h-12 rounded-xl font-black uppercase tracking-[0.2em] text-xs transition-all ${loading || !stripe || !ready
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-brand-cyan text-brand-darker hover:bg-white hover:scale-[1.02]'
                    }`}
            >
                {loading
                    ? (t('paymentFlow.processing') || 'Processing…')
                    : `${t('paymentFlow.pay') || 'Pay'} ${currency === 'THB' ? '฿' : '$'}${displayAmount.toLocaleString()}`}
            </button>
        </>
    );
};

const PaymentModal: React.FC<PaymentModalProps> = ({
    isOpen,
    onClose,
    amount,
    shippingFee = 0,
    currency,
    items,
    apiEndpoint,
    extraData,
    onPaymentSuccess,
    onPaymentFailed
}) => {
    const { t } = useTranslation();

    // Server-computed estimate (shipping + total). Fetched on modal open via
    // /api/orders/estimate, which runs the same shipping math as
    // /api/orders/checkout but writes no rows. When this resolves we override
    // the prop amount/shippingFee so the displayed total matches what the
    // buyer will actually be charged.
    const [estimate, setEstimate] = useState<{
        subtotal: number;
        shipping: number;
        total: number;
        shippingIsEstimate: boolean;
        sellerStripeAccountId: string | null;
    } | null>(null);
    const [estimateLoading, setEstimateLoading] = useState(false);
    const [estimateError, setEstimateError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setEstimate(null);
            setEstimateError(null);
            return;
        }
        if (!items?.length) return;

        let cancelled = false;
        setEstimateLoading(true);
        setEstimateError(null);

        // Auth comes from cookie session. Only the listing ids are sent — the
        // server re-derives sellers and prices from the DB.
        fetch('/api/orders/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items.map(i => ({ id: i.id })) }),
        })
            .then(r => r.json())
            .then(data => {
                if (cancelled) return;
                if (!data.success) {
                    setEstimateError(data.error || 'Failed to estimate total');
                    return;
                }
                setEstimate({
                    subtotal: data.subtotal,
                    shipping: data.shipping,
                    total: data.total,
                    shippingIsEstimate: !!data.shippingIsEstimate,
                    sellerStripeAccountId: data.sellerStripeAccountId ?? null,
                });
            })
            .catch(err => {
                if (!cancelled) setEstimateError(err.message || 'Failed to estimate total');
            })
            .finally(() => {
                if (!cancelled) setEstimateLoading(false);
            });

        return () => { cancelled = true; };
    }, [isOpen, items]);

    // Effective display values — prefer the server estimate, fall back to the
    // prop amount (cart subtotal) before the estimate arrives.
    const effectiveAmount = estimate?.total ?? amount;
    const effectiveShipping = estimate?.shipping ?? shippingFee;

    // For the marketplace checkout we must wait for the estimate before
    // mounting Elements, because it tells us which connected account to bind
    // Stripe.js to (TH direct charge). Mounting on the platform first and
    // swapping later would tokenize the card on the wrong account. Other
    // (non-marketplace) callers tokenize on the platform immediately.
    const isMarketplaceCheckout = (apiEndpoint ?? '/api/checkout') === '/api/checkout';
    const stripePromise = useMemo(
        () => getStripePromise(isMarketplaceCheckout ? estimate?.sellerStripeAccountId : undefined),
        [isMarketplaceCheckout, estimate?.sellerStripeAccountId],
    );
    const waitingForEstimate = isMarketplaceCheckout && !estimate && !estimateError;

    // Deferred PaymentElement options. amount is in the currency's smallest
    // unit (satang/cents) and is only used to render eligible methods + wallet
    // amounts; the authoritative charge amount is set server-side on the
    // PaymentIntent. Dark theme to match the modal.
    const amountMinor = Math.max(1, Math.round(effectiveAmount * 100));
    const elementsCurrency = (currency || 'thb').toLowerCase();
    const elementsOptions = useMemo<StripeElementsOptions>(() => ({
        mode: 'payment',
        amount: amountMinor,
        currency: elementsCurrency,
        appearance: {
            theme: 'night',
            variables: { colorPrimary: '#22d3ee', borderRadius: '12px' },
        },
    }), [amountMinor, elementsCurrency]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-[#0f172a] w-full max-w-sm rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-darker to-[#1e293b] p-6 border-b border-white/5 flex justify-between items-center">
                    <div>
                        <h3 className="text-white text-lg font-black italic skew-x-[-10deg]">{t('paymentFlow.secureTitle') || 'Secure Payment'}</h3>
                        <p className="text-[10px] text-brand-green font-bold uppercase tracking-widest">{t('paymentFlow.secureSubtitle') || 'Encrypted checkout'}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-400">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-6 bg-white/5 rounded-xl p-4 space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Subtotal</span>
                            <span className="text-sm font-bold text-slate-300">{currency === 'THB' ? '฿' : '$'}{(effectiveAmount - effectiveShipping).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Shipping</span>
                            <span className="text-sm font-bold text-brand-cyan">
                                {estimateLoading
                                    ? 'Calculating…'
                                    : effectiveShipping > 0
                                        ? `+${currency === 'THB' ? '฿' : '$'}${effectiveShipping.toLocaleString()}`
                                        : `${currency === 'THB' ? '฿' : '$'}0`}
                            </span>
                        </div>
                        {estimateError && (
                            <p className="text-[10px] text-amber-400 italic">
                                Could not calculate shipping — showing subtotal only. Final amount will reflect actual shipping.
                            </p>
                        )}
                        {!estimateError && estimate?.shippingIsEstimate && (
                            <p className="text-[10px] text-amber-400 italic">
                                {t('paymentFlow.shippingEstimate')
                                    || 'Shipping is an estimate — the final amount is calculated at checkout.'}
                            </p>
                        )}
                        <div className="h-[1px] w-full bg-white/10 my-2"></div>
                        <div className="flex justify-between items-center">
                            <span className="text-white text-sm font-black uppercase tracking-wider">Total</span>
                            <span className="text-2xl font-black text-white">{currency === 'THB' ? '฿' : '$'}{effectiveAmount.toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {!stripePromise ? (
                            // PUBLISHABLE_KEY missing/empty — render a clear message
                            // instead of a silently dead card field + greyed button.
                            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-xl p-4 text-center">
                                {t('paymentFlow.paymentUnavailable')
                                    || 'Card payments are temporarily unavailable. Please try again later.'}
                            </div>
                        ) : waitingForEstimate ? (
                            <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-6">
                                <i className="fa-solid fa-circle-notch fa-spin"></i>
                                {t('paymentFlow.preparingCheckout') || 'Preparing secure checkout…'}
                            </div>
                        ) : (
                            <>
                                <Elements
                                    stripe={stripePromise}
                                    options={elementsOptions}
                                    // Deferred Elements can't change amount/currency/account in
                                    // place — remount when any of them changes.
                                    key={`${amountMinor}-${elementsCurrency}-${estimate?.sellerStripeAccountId || 'platform'}`}
                                >
                                    <PaymentElementForm
                                        displayAmount={effectiveAmount}
                                        currency={currency}
                                        items={items}
                                        apiEndpoint={apiEndpoint}
                                        extraData={extraData}
                                        onPaymentSuccess={onPaymentSuccess}
                                        onPaymentFailed={onPaymentFailed}
                                        onTotalChanged={(newTotal) =>
                                            setEstimate((prev) =>
                                                prev
                                                    ? { ...prev, total: newTotal, shipping: newTotal - prev.subtotal }
                                                    : prev
                                            )
                                        }
                                    />
                                </Elements>
                                <p className="text-center text-[10px] text-slate-600 flex items-center justify-center gap-1 mt-2">
                                    <i className="fa-brands fa-stripe text-slate-500 text-sm"></i>
                                    Secured by Stripe
                                </p>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
