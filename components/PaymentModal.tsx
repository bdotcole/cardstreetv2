'use client';

import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useTranslation } from '@/lib/hooks/useTranslation';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

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

// Inner form — must be inside <Elements> to use useStripe / useElements
const StripeCardForm: React.FC<{
    amount: number;
    currency: string;
    items: any[];
    apiEndpoint?: string;
    extraData?: any;
    onPaymentSuccess: (details: { paymentMethod: string, paymentId: string, transferGroup?: string }) => void;
    onPaymentFailed: (error: string) => void;
}> = ({ amount, currency, items, apiEndpoint = '/api/checkout', extraData = {}, onPaymentSuccess, onPaymentFailed }) => {
    const stripe = useStripe();
    const elements = useElements();
    const [loading, setLoading] = useState(false);

    const handlePay = async () => {
        if (!stripe || !elements) {
            onPaymentFailed('Stripe is not loaded yet. Please try again.');
            return;
        }

        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
            onPaymentFailed('Card element not found.');
            return;
        }

        // Belt-and-suspenders: surface a clear error if the parent rendered us
        // without the required context, instead of letting the server return a
        // generic "missing required fields" message.
        if (apiEndpoint === '/api/checkout' && !extraData?.buyerId) {
            onPaymentFailed('You must be signed in to complete a purchase.');
            return;
        }
        if (!items || items.length === 0) {
            onPaymentFailed('Your cart is empty.');
            return;
        }

        setLoading(true);

        // Charge amount may be overridden by the server in step 2 below.
        let chargeAmount = amount;

        try {
            // Step 1: Create Stripe PaymentMethod from card details
            const { error, paymentMethod } = await stripe.createPaymentMethod({
                type: 'card',
                card: cardElement,
            });

            if (error) {
                onPaymentFailed(error.message || 'Card error');
                setLoading(false);
                return;
            }

            // Step 2: Create orders FIRST to get a transfer_group
            // This prevents "zombie payments" — orders exist before money is charged
            let transferGroup: string | undefined;

            if (apiEndpoint === '/api/checkout') {
                // buyerId is derived from the session server-side — never send
                // it from the client.
                const orderRes = await fetch('/api/orders/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items,
                        paymentMethod: 'credit_card',
                    }),
                });

                const orderData = await orderRes.json();

                if (!orderRes.ok || !orderData.success) {
                    onPaymentFailed(orderData.error || 'Failed to create orders');
                    setLoading(false);
                    return;
                }

                transferGroup = orderData.transferGroup;
                // The server is authoritative on the final total (it computes
                // shipping with Flash). Use its number for the Stripe charge —
                // otherwise the buyer's card statement won't match the order
                // records, and refunds get fiddly.
                if (typeof orderData.totalAmount === 'number') {
                    chargeAmount = orderData.totalAmount;
                }
                // Intentionally not logging transfer_group / amount in client console.
            }

            // Step 3: Charge the card via Stripe
            const payload = apiEndpoint === '/api/checkout'
                ? {
                    // amount is ignored server-side (computed from DB) — kept
                    // only for legacy logging compatibility.
                    amount: chargeAmount,
                    currency,
                    token: paymentMethod.id,
                    metadata: {
                        transfer_group: transferGroup,
                    },
                }
                : {
                    orderId: items[0]?.id,
                    paymentMethodId: paymentMethod.id,
                    ...extraData
                };

            const res = await fetch(apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Payment failed');
            }

            if (data.status === 'succeeded') {
                // Client-triggered fulfillment fallback. The Stripe webhook
                // is the canonical post-payment path, but if it's misconfigured
                // or delivery fails, orders would stay stuck at pending_payment
                // and never reach the seller's "Pending Shipments" view.
                // /api/orders/finalize re-verifies the payment with Stripe and
                // runs the same idempotent fulfillment — CAS guard inside
                // fulfillOrdersByTransferGroup prevents double-processing if
                // the webhook ALSO fires.
                if (apiEndpoint === '/api/checkout' && transferGroup) {
                    try {
                        const finalizeRes = await fetch('/api/orders/finalize', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                transferGroup,
                                paymentIntentId: data.id,
                            }),
                        });
                        const finalizeData = await finalizeRes.json().catch(() => ({}));
                        if (!finalizeRes.ok) {
                            console.warn('[PaymentModal] Finalize fallback returned an error (webhook may still fulfill)');
                        }
                    } catch (finalizeErr) {
                        // Don't block the user — the webhook is still the
                        // canonical path, this is just a safety net.
                        console.warn('[PaymentModal] Finalize fallback threw (webhook should still fulfill):', finalizeErr);
                    }
                }
                onPaymentSuccess({ paymentMethod: 'card', paymentId: data.id, transferGroup: data.transfer_group || transferGroup });
            } else if (data.status === 'requires_action' && data.next_action?.redirect_to_url) {
                window.location.href = data.next_action.redirect_to_url.url;
            } else {
                onPaymentFailed('Payment not completed: ' + data.status);
            }
        } catch (e: any) {
            onPaymentFailed(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="bg-black/20 border border-white/10 rounded-xl px-4 py-4">
                <CardElement
                    options={{
                        style: {
                            base: {
                                color: '#ffffff',
                                fontFamily: 'Inter, sans-serif',
                                fontSize: '14px',
                                '::placeholder': { color: '#64748b' },
                                iconColor: '#a78bfa',
                            },
                            invalid: { color: '#f87171' },
                        },
                    }}
                />
            </div>
            <button
                onClick={handlePay}
                disabled={loading || !stripe}
                className={`mt-4 w-full h-12 rounded-xl font-black uppercase tracking-[0.2em] text-xs transition-all ${
                    loading || !stripe
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                        : 'bg-brand-cyan text-brand-darker hover:bg-white hover:scale-[1.02]'
                }`}
            >
                {loading ? 'Processing...' : `Pay ${currency === 'THB' ? '฿' : '$'}${amount.toLocaleString()}`}
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-[#0f172a] w-full max-w-sm rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-darker to-[#1e293b] p-6 border-b border-white/5 flex justify-between items-center">
                    <div>
                        <h3 className="text-white text-lg font-black italic skew-x-[-10deg]">ชำระเงินอย่างปลอดภัย</h3>
                        <p className="text-[10px] text-brand-green font-bold uppercase tracking-widest">ชำระเงินผ่านระบบเข้ารหัส</p>
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
                        <Elements stripe={stripePromise}>
                            <StripeCardForm
                                amount={effectiveAmount}
                                currency={currency}
                                items={items}
                                apiEndpoint={apiEndpoint}
                                extraData={extraData}
                                onPaymentSuccess={onPaymentSuccess}
                                onPaymentFailed={onPaymentFailed}
                            />
                        </Elements>
                        <p className="text-center text-[10px] text-slate-600 flex items-center justify-center gap-1 mt-2">
                            <i className="fa-brands fa-stripe text-slate-500 text-sm"></i>
                            Secured by Stripe
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
