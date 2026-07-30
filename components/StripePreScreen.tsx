'use client';

/**
 * Prep step shown before handing a seller off to Stripe's hosted onboarding.
 *
 * Why this exists: TH sellers are merchant-of-record (direct charges), so
 * Stripe runs full KYC — ID + laser code, selfie/liveness, bank account. None
 * of it is trimmable (Thai AMLO/BoT floor) and none of it is pre-fillable. The
 * 2026-07-16 funnel showed 34 of 54 sellers who started onboarding never
 * touched the form at all: they hit Stripe's page cold and bailed. This screen
 * is the only lever we have on that bounce — set expectations, name the two
 * things people don't have to hand (the laser code on the back of the Thai ID,
 * and a selfie), and give the time cost up front.
 *
 * Rendered by every entry point that can launch onboarding — mobile profile
 * (StripeConnectSection, incl. resume + the ?stripe_connect=refresh nudge CTA)
 * and desktop /sell (DesktopSell) — so nobody reaches Stripe unprepared.
 */

import React from 'react';
import { CreditCard, ExternalLink, IdCard, Loader2, MapPin, Phone, ScanFace, Shield, X } from 'lucide-react';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface StripePreScreenProps {
    onCancel: () => void;
    onContinue: () => void;
    loading: boolean;
}

export default function StripePreScreen({ onCancel, onContinue, loading }: StripePreScreenProps) {
    const { t } = useTranslation();

    const items = [
        { icon: IdCard, label: t('profile.stripePreIdItem') },
        { icon: ScanFace, label: t('profile.stripePreSelfieItem') },
        { icon: CreditCard, label: t('profile.stripePreBankItem') },
        { icon: MapPin, label: t('profile.stripePreAddressItem') },
        { icon: Phone, label: t('profile.stripePrePhoneItem') },
    ];

    return (
        <div
            className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stripe-prescreen-title"
            onClick={onCancel}
        >
            <div
                className="bg-brand-darker border border-white/10 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 id="stripe-prescreen-title" className="text-white font-black text-xl">
                            {t('profile.stripePreTitle')}
                        </h2>
                        <p className="text-slate-400 text-sm mt-1">
                            {t('profile.stripePreSubtitle')}
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        aria-label={t('profile.stripePreCancel')}
                        className="p-1.5 -mr-1.5 -mt-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <ul className="space-y-3">
                    {items.map(({ icon: Icon, label }, i) => (
                        <li
                            key={i}
                            className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-xl px-4 py-3"
                        >
                            <Icon className="w-5 h-5 text-brand-cyan shrink-0" />
                            <span className="text-white text-sm">{label}</span>
                        </li>
                    ))}
                </ul>

                <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-900/40 border border-white/5 rounded-xl px-3 py-2.5">
                    <Shield className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>{t('profile.stripePreNote')}</span>
                </div>

                <div className="flex gap-2 pt-1">
                    <button
                        onClick={onCancel}
                        disabled={loading}
                        className="flex-1 h-11 bg-white/5 border border-white/10 text-white font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-50"
                    >
                        {t('profile.stripePreCancel')}
                    </button>
                    <button
                        onClick={onContinue}
                        disabled={loading}
                        className="flex-1 h-11 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        {t('profile.stripePreContinue')}
                    </button>
                </div>
            </div>
        </div>
    );
}
