'use client'

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getThumbnailUrl } from '@/lib/imageUtils';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    BUYER_PROFILE_FIELD_LABELS,
    checkBuyerProfileComplete,
    BuyerRequiredField,
} from '@/lib/profileValidation';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import AuthModal from '@/components/AuthModal';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { formatTHB } from '@/components/desktop/DesktopMarketplace';

// Stripe Elements only loads when checkout actually opens — same lazy-load
// the mobile shell uses.
const PaymentModal = dynamic(() => import('@/components/PaymentModal'), { ssr: false });

type Phase = 'cart' | 'address' | 'payment';

const EMPTY_ADDRESS: Record<BuyerRequiredField, string> = {
    address: '',
    district: '',
    state: '',
    province: '',
    postcode: '',
    phone_number: '',
};

export default function DesktopCartDrawer() {
    const router = useRouter();
    const { showToast } = useToast();
    const { t } = useTranslation();
    const { user, items, isOpen, removeItem, clear, closeCart } = useDesktopCart();

    const [phase, setPhase] = useState<Phase>('cart');
    const [authOpen, setAuthOpen] = useState(false);
    const [checkingProfile, setCheckingProfile] = useState(false);
    const [addressForm, setAddressForm] = useState(EMPTY_ADDRESS);
    const [savingAddress, setSavingAddress] = useState(false);

    const subtotal = items.reduce((sum, i) => sum + i.price, 0);

    const close = () => {
        setPhase('cart');
        closeCart();
    };

    // Mirror of the mobile pre-check: confirm the buyer's shipping profile is
    // complete before mounting Stripe. /api/orders/checkout re-enforces this
    // server-side; the desktop difference is we collect the address inline
    // instead of bouncing to a profile screen.
    const beginCheckout = async () => {
        if (items.length === 0) return;
        if (!user) {
            setAuthOpen(true);
            return;
        }
        setCheckingProfile(true);
        try {
            const supabase = createClient();
            const { data: profile } = await supabase
                .from('profiles')
                .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
                .eq('id', user.id)
                .single<Record<string, string | null>>();
            const completeness = checkBuyerProfileComplete(profile);
            if (completeness.complete) {
                setPhase('payment');
            } else {
                setAddressForm({
                    ...EMPTY_ADDRESS,
                    ...Object.fromEntries(
                        BUYER_REQUIRED_PROFILE_FIELDS.map((f) => [f, profile?.[f] ?? '']),
                    ),
                });
                setPhase('address');
            }
        } catch (err) {
            // Same fallthrough mobile uses: the server gate still enforces it.
            console.warn('[DesktopCart] Buyer profile pre-check failed:', err);
            setPhase('payment');
        } finally {
            setCheckingProfile(false);
        }
    };

    const saveAddress = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingAddress(true);
        try {
            const res = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(addressForm),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || t('desktop.cart.toastSaveFailed'));
            setPhase('payment');
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setSavingAddress(false);
        }
    };

    const handlePaymentSuccess = () => {
        clear();
        close();
        showToast(t('desktop.cart.toastPaymentReceived'), 'success');
        router.push('/orders');
    };

    return (
        <>
            {isOpen && (
                <div className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close}></div>

                    <aside className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-brand-darker border-l border-white/10 shadow-2xl flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
                            <h2 className="text-white font-black text-lg">
                                {phase === 'address' ? t('desktop.cart.shippingDetails') : t('desktop.cart.title')}
                                {phase === 'cart' && items.length > 0 && (
                                    <span className="text-slate-500 font-bold text-sm ml-2">({items.length})</span>
                                )}
                            </h2>
                            <button onClick={close} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 transition-colors">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        {phase === 'address' ? (
                            <form onSubmit={saveAddress} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                                <p className="text-slate-400 text-xs">
                                    {t('desktop.cart.addressHint')}
                                </p>
                                {BUYER_REQUIRED_PROFILE_FIELDS.map((field) => (
                                    <div key={field}>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                                            {BUYER_PROFILE_FIELD_LABELS[field]}
                                        </label>
                                        <input
                                            type={field === 'phone_number' ? 'tel' : 'text'}
                                            required
                                            value={addressForm[field]}
                                            onChange={(e) => setAddressForm((prev) => ({ ...prev, [field]: e.target.value }))}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-white placeholder:text-slate-600 outline-none focus:border-brand-cyan/50 transition-colors"
                                        />
                                    </div>
                                ))}
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => setPhase('cart')}
                                        className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-bold py-3 rounded-xl transition-colors"
                                    >
                                        {t('desktop.cart.back')}
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingAddress}
                                        className="flex-1 bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black py-3 rounded-xl transition-colors disabled:opacity-50"
                                    >
                                        {savingAddress ? t('desktop.cart.saving') : t('desktop.cart.saveContinue')}
                                    </button>
                                </div>
                            </form>
                        ) : items.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                                    <i className="fa-solid fa-cart-shopping text-2xl text-slate-600"></i>
                                </div>
                                <p className="text-white font-bold text-sm uppercase tracking-widest mb-1">{t('desktop.cart.empty')}</p>
                                <p className="text-slate-500 text-sm">{t('desktop.cart.emptyDesc')}</p>
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                                    {items.map((item) => (
                                        <div key={item.id} className="flex items-center gap-3 bg-[#1e293b]/40 border border-white/5 rounded-xl p-3">
                                            <span className="w-12 h-16 rounded-md bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={getThumbnailUrl(item.card.images?.small || item.card.imageUrl)}
                                                    alt=""
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                />
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-white truncate">{item.card.name}</p>
                                                <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wide truncate">
                                                    {item.condition} · {item.sellerName}
                                                </p>
                                                <p className="text-sm font-black text-brand-cyan mt-0.5">{formatTHB(item.price)}</p>
                                            </div>
                                            <button
                                                onClick={() => removeItem(item.id)}
                                                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-brand-red/20 text-slate-500 hover:text-rose-300 transition-colors shrink-0"
                                                aria-label={`Remove ${item.card.name}`}
                                            >
                                                <i className="fa-solid fa-trash-can text-xs"></i>
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <div className="border-t border-white/5 px-6 py-5 shrink-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">{t('desktop.cart.subtotal')}</span>
                                        <span className="text-xl font-black text-white">{formatTHB(subtotal)}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mb-4">{t('desktop.cart.shippingAtCheckout')}</p>
                                    <button
                                        onClick={beginCheckout}
                                        disabled={checkingProfile}
                                        className="w-full bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black py-3.5 rounded-xl transition-colors disabled:opacity-50"
                                    >
                                        {checkingProfile ? t('desktop.cart.oneMoment') : user ? t('desktop.cart.checkout') : t('desktop.cart.signInToCheckout')}
                                    </button>
                                </div>
                            </>
                        )}
                    </aside>
                </div>
            )}

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />

            <PaymentModal
                isOpen={phase === 'payment'}
                onClose={() => setPhase('cart')}
                amount={subtotal}
                currency="THB"
                items={items}
                apiEndpoint="/api/checkout"
                extraData={{ buyerId: user?.id }}
                onPaymentSuccess={handlePaymentSuccess}
                onPaymentFailed={(err) => showToast(`${t('desktop.cart.toastPaymentFailed')}: ${err}`, 'error')}
            />
        </>
    );
}
