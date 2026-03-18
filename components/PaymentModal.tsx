'use client';

import React, { useState, useRef } from 'react';
import { PayPalButtons } from '@paypal/react-paypal-js';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    amount: number;
    currency: string;
    items: any[];
    onPaymentSuccess: () => void;
    onPaymentFailed: (error: string) => void;
}

// Inner form — must be inside <Elements> to use useStripe / useElements
const StripeCardForm: React.FC<{
    amount: number;
    currency: string;
    items: any[];
    onPaymentSuccess: () => void;
    onPaymentFailed: (error: string) => void;
}> = ({ amount, currency, items, onPaymentSuccess, onPaymentFailed }) => {
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

        setLoading(true);

        try {
            const { error, paymentMethod } = await stripe.createPaymentMethod({
                type: 'card',
                card: cardElement,
            });

            if (error) {
                onPaymentFailed(error.message || 'Card error');
                setLoading(false);
                return;
            }

            const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount,
                    currency,
                    token: paymentMethod.id,
                    metadata: { items: JSON.stringify(items.map(i => i.id)) },
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Payment failed');
            }

            if (data.status === 'succeeded') {
                onPaymentSuccess();
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
    currency,
    items,
    onPaymentSuccess,
    onPaymentFailed
}) => {
    const [method, setMethod] = useState<'card' | 'paypal'>('card');

    // Convert THB to USD for PayPal (approximate rate)
    const paypalAmount = currency === 'THB' ? (amount * 0.028).toFixed(2) : amount.toFixed(2);

    // PayPal handlers
    const createPayPalOrder = async () => {
        const response = await fetch('/api/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: parseFloat(paypalAmount), currency: 'USD' }),
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data.orderID;
    };

    const onPayPalApprove = async (data: any) => {
        const response = await fetch('/api/paypal/capture-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderID: data.orderID }),
        });
        const captureData = await response.json();
        if (captureData.success) {
            onPaymentSuccess();
        } else {
            onPaymentFailed(captureData.message || 'PayPal payment capture failed');
        }
    };

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
                    <div className="mb-6 flex justify-between items-center bg-white/5 rounded-xl p-3">
                        <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">ยอดรวมสุทธิ</span>
                        <div className="text-right">
                            <span className="text-2xl font-black text-white">{currency === 'THB' ? '฿' : '$'}{amount.toLocaleString()}</span>
                            {method === 'paypal' && currency === 'THB' && (
                                <p className="text-[10px] text-slate-500">≈ ${paypalAmount} USD</p>
                            )}
                        </div>
                    </div>

                    {/* Method Selection */}
                    <div className="flex gap-2 mb-6">
                        <button
                            onClick={() => setMethod('card')}
                            className={`flex-1 py-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${method === 'card' ? 'bg-brand-purple/10 border-brand-purple text-brand-purple' : 'bg-white/5 border-transparent text-slate-500'}`}
                        >
                            <i className="fa-brands fa-stripe text-xl leading-none"></i>
                            <span className="text-[9px] font-black uppercase tracking-widest">Card</span>
                        </button>
                        <button
                            onClick={() => setMethod('paypal')}
                            className={`flex-1 py-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${method === 'paypal' ? 'bg-[#0070ba]/10 border-[#0070ba] text-[#0070ba]' : 'bg-white/5 border-transparent text-slate-500'}`}
                        >
                            <i className="fa-brands fa-paypal text-xl leading-none"></i>
                            <span className="text-[9px] font-black uppercase tracking-widest">PayPal</span>
                        </button>
                    </div>

                    {/* Forms */}
                    {method === 'card' ? (
                        <div className="space-y-3">
                            <Elements stripe={stripePromise}>
                                <StripeCardForm
                                    amount={amount}
                                    currency={currency}
                                    items={items}
                                    onPaymentSuccess={onPaymentSuccess}
                                    onPaymentFailed={onPaymentFailed}
                                />
                            </Elements>
                            <p className="text-center text-[10px] text-slate-600 flex items-center justify-center gap-1 mt-2">
                                <i className="fa-brands fa-stripe text-slate-500 text-sm"></i>
                                Secured by Stripe
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="text-center py-4 bg-white/5 rounded-2xl border border-dashed border-white/10">
                                <div className="w-16 h-10 bg-white rounded-lg mx-auto mb-2 flex items-center justify-center">
                                    <i className="fa-brands fa-paypal text-[#0070ba] text-2xl"></i>
                                </div>
                                <p className="text-[10px] text-slate-400">Pay securely with PayPal</p>
                            </div>
                            <div className="paypal-button-container">
                                <PayPalButtons
                                    style={{ layout: 'vertical', color: 'blue', shape: 'rect', label: 'paypal', height: 45 }}
                                    createOrder={createPayPalOrder}
                                    onApprove={onPayPalApprove}
                                    onError={(err) => {
                                        console.error('PayPal Error:', err);
                                        onPaymentFailed('PayPal payment failed');
                                    }}
                                    onCancel={() => console.log('PayPal payment cancelled')}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
