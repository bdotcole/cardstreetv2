'use client';

import React, { useState, useEffect } from 'react';
import { PayPalButtons } from '@paypal/react-paypal-js';

// Declare Omise global
declare const Omise: any;

interface PaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    amount: number;
    currency: string;
    items: any[];
    onPaymentSuccess: () => void;
    onPaymentFailed: (error: string) => void;
}

const PaymentModal: React.FC<PaymentModalProps> = ({
    isOpen,
    onClose,
    amount,
    currency,
    items,
    onPaymentSuccess,
    onPaymentFailed
}) => {
    const [method, setMethod] = useState<'promptpay' | 'card' | 'paypal'>('promptpay');
    const [loading, setLoading] = useState(false);
    const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
    const [cardDetails, setCardDetails] = useState({
        name: '',
        number: '',
        expiration_month: '',
        expiration_year: '',
        security_code: ''
    });

    // Convert THB to USD for PayPal (approximate rate)
    const paypalAmount = currency === 'THB' ? (amount * 0.028).toFixed(2) : amount.toFixed(2);

    useEffect(() => {
        if (typeof Omise !== 'undefined') {
            Omise.setPublicKey(process.env.NEXT_PUBLIC_OMISE_PUBLIC_KEY);
        }
    }, [isOpen]);

    const handlePay = async () => {
        setLoading(true);
        setQrCodeUrl(null); // Reset

        try {
            if (typeof Omise === 'undefined') {
                throw new Error("Omise.js not loaded");
            }

            if (method === 'promptpay') {
                // Create Source for PromptPay
                Omise.createSource('promptpay', {
                    "amount": amount * 100,
                    "currency": currency
                }, (statusCode: number, response: any) => {
                    if (statusCode === 200) {
                        processCharge(response.id, 'promptpay', amount);
                    } else {
                        setLoading(false);
                        onPaymentFailed(response.message);
                    }
                });
            } else if (method === 'card') {
                // Create Token for Credit Card
                const cardTokenParams = {
                    name: cardDetails.name,
                    number: cardDetails.number,
                    expiration_month: cardDetails.expiration_month,
                    expiration_year: cardDetails.expiration_year,
                    security_code: cardDetails.security_code
                };

                Omise.createToken('card', cardTokenParams, (statusCode: number, response: any) => {
                    if (statusCode === 200) {
                        processCharge(response.id, 'card', amount);
                    } else {
                        setLoading(false);
                        onPaymentFailed(response.message);
                    }
                });
            }
        } catch (e: any) {
            setLoading(false);
            onPaymentFailed(e.message);
        }
    };

    const processCharge = async (id: string, type: 'promptpay' | 'card', amount: number) => {
        try {
            const payload: any = {
                amount,
                currency,
                metadata: { items: JSON.stringify(items.map(i => i.id)) }
            };

            if (type === 'card') payload.token = id;
            else payload.source = id;

            const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Payment failed');
            }

            if (type === 'promptpay') {
                // Display QR
                if (data.source?.scannable_code?.image?.download_uri) {
                    setQrCodeUrl(data.source.scannable_code.image.download_uri);
                    setLoading(false);
                } else {
                    if (data.status === 'successful' || data.status === 'pending') {
                        setQrCodeUrl(data.source?.scannable_code?.image?.download_uri);
                        setLoading(false);
                    } else {
                        throw new Error("Could not generate QR code");
                    }
                }
            } else {
                // Card
                if (data.status === 'successful') {
                    onPaymentSuccess();
                } else {
                    if (data.authorize_uri) {
                        window.location.href = data.authorize_uri;
                    } else {
                        onPaymentFailed("Payment not successful: " + data.status);
                    }
                }
                setLoading(false);
            }

        } catch (e: any) {
            setLoading(false);
            onPaymentFailed(e.message);
        }
    };

    // PayPal handlers
    const createPayPalOrder = async () => {
        try {
            const response = await fetch('/api/paypal/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: parseFloat(paypalAmount),
                    currency: 'USD', // PayPal uses USD
                }),
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error);
            }
            return data.orderID;
        } catch (error: any) {
            onPaymentFailed(error.message);
            throw error;
        }
    };

    const onPayPalApprove = async (data: any) => {
        try {
            setLoading(true);
            const response = await fetch('/api/paypal/capture-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderID: data.orderID }),
            });

            const captureData = await response.json();

            if (captureData.success) {
                onPaymentSuccess();
            } else {
                onPaymentFailed(captureData.message || 'Payment capture failed');
            }
        } catch (error: any) {
            onPaymentFailed(error.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-[#0f172a] w-full max-w-sm rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-darker to-[#1e293b] p-6 border-b border-white/5 flex justify-between items-center">
                    <div>
                        <h3 className="text-white text-lg font-black italic skew-x-[-10deg]">Secure Checkout</h3>
                        <p className="text-[10px] text-brand-green font-bold uppercase tracking-widest">Encrypted Payment</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-400">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-6 flex justify-between items-center bg-white/5 rounded-xl p-3">
                        <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">Total Amount</span>
                        <div className="text-right">
                            <span className="text-2xl font-black text-white">{currency === 'THB' ? '฿' : '$'}{amount.toLocaleString()}</span>
                            {method === 'paypal' && currency === 'THB' && (
                                <p className="text-[10px] text-slate-500">≈ ${paypalAmount} USD</p>
                            )}
                        </div>
                    </div>

                    {qrCodeUrl ? (
                        <div className="text-center space-y-4 animate-fadeIn">
                            <div className="bg-white p-4 rounded-xl inline-block mx-auto">
                                <img src={qrCodeUrl} className="w-48 h-48 object-contain" />
                            </div>
                            <p className="text-slate-400 text-xs">Scan with any Thai Banking App</p>
                            <button onClick={onPaymentSuccess} className="w-full h-12 bg-brand-green text-brand-darker font-black rounded-xl uppercase tracking-widest hover:bg-white transition-colors">
                                Simulate Payment Success (Test)
                            </button>
                            <button onClick={() => setQrCodeUrl(null)} className="text-xs text-slate-500 underline">Cancel</button>
                        </div>
                    ) : (
                        <>
                            {/* Method Selection */}
                            <div className="flex gap-2 mb-6">
                                <button
                                    onClick={() => setMethod('promptpay')}
                                    className={`flex-1 py-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${method === 'promptpay' ? 'bg-brand-cyan/10 border-brand-cyan text-brand-cyan' : 'bg-white/5 border-transparent text-slate-500'}`}
                                >
                                    <i className="fa-solid fa-qrcode text-xl leading-none"></i>
                                    <span className="text-[9px] font-black uppercase tracking-widest">PromptPay</span>
                                </button>
                                <button
                                    onClick={() => setMethod('card')}
                                    className={`flex-1 py-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${method === 'card' ? 'bg-brand-purple/10 border-brand-purple text-brand-purple' : 'bg-white/5 border-transparent text-slate-500'}`}
                                >
                                    <i className="fa-regular fa-credit-card text-xl leading-none"></i>
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
                                    <input
                                        type="text"
                                        placeholder="Card Name"
                                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-brand-purple outline-none"
                                        value={cardDetails.name}
                                        onChange={(e) => setCardDetails({ ...cardDetails, name: e.target.value })}
                                    />
                                    <input
                                        type="text"
                                        placeholder="Card Number"
                                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-brand-purple outline-none"
                                        value={cardDetails.number}
                                        onChange={(e) => setCardDetails({ ...cardDetails, number: e.target.value })}
                                    />
                                    <div className="flex gap-3">
                                        <input
                                            type="text"
                                            placeholder="MM"
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-brand-purple outline-none"
                                            value={cardDetails.expiration_month}
                                            onChange={(e) => setCardDetails({ ...cardDetails, expiration_month: e.target.value })}
                                        />
                                        <input
                                            type="text"
                                            placeholder="YYYY"
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-brand-purple outline-none"
                                            value={cardDetails.expiration_year}
                                            onChange={(e) => setCardDetails({ ...cardDetails, expiration_year: e.target.value })}
                                        />
                                        <input
                                            type="text"
                                            placeholder="CVC"
                                            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-brand-purple outline-none"
                                            value={cardDetails.security_code}
                                            onChange={(e) => setCardDetails({ ...cardDetails, security_code: e.target.value })}
                                        />
                                    </div>
                                </div>
                            ) : method === 'paypal' ? (
                                <div className="space-y-4">
                                    <div className="text-center py-4 bg-white/5 rounded-2xl border border-dashed border-white/10">
                                        <div className="w-16 h-10 bg-white rounded-lg mx-auto mb-2 flex items-center justify-center">
                                            <i className="fa-brands fa-paypal text-[#0070ba] text-2xl"></i>
                                        </div>
                                        <p className="text-[10px] text-slate-400">Pay securely with PayPal</p>
                                    </div>
                                    <div className="paypal-button-container">
                                        <PayPalButtons
                                            style={{
                                                layout: 'vertical',
                                                color: 'blue',
                                                shape: 'rect',
                                                label: 'paypal',
                                                height: 45
                                            }}
                                            createOrder={createPayPalOrder}
                                            onApprove={onPayPalApprove}
                                            onError={(err) => {
                                                console.error('PayPal Error:', err);
                                                onPaymentFailed('PayPal payment failed');
                                            }}
                                            onCancel={() => {
                                                console.log('PayPal payment cancelled');
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-4 bg-white/5 rounded-2xl border border-dashed border-white/10">
                                    <div className="w-12 h-12 bg-white rounded-lg mx-auto mb-2 p-1">
                                        <img src="https://upload.wikimedia.org/wikipedia/commons/c/c5/PromptPay-logo.png" className="w-full h-full object-contain" />
                                    </div>
                                    <p className="text-[10px] text-slate-400">Scan QR Code to Pay instantly</p>
                                </div>
                            )}

                            {method !== 'paypal' && (
                                <button
                                    onClick={handlePay}
                                    disabled={loading}
                                    className={`mt-6 w-full h-12 rounded-xl font-black uppercase tracking-[0.2em] text-xs transition-all ${loading ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-brand-cyan text-brand-darker hover:bg-white hover:scale-[1.02]'}`}
                                >
                                    {loading ? 'Processing...' : `Pay ${currency === 'THB' ? '฿' : '$'}${amount.toLocaleString()}`}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
