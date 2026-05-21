'use client';

/**
 * Stripe Connect onboarding panel for sellers.
 *
 * Shows the seller's current payout state and the right action button:
 *   - No account → "Set up payouts" (creates the account, opens onboarding)
 *   - Account exists, not done → "Continue payout setup" (resumes onboarding)
 *   - Account active → "Manage payouts" (opens Express Dashboard) + green check
 *   - Account restricted → "Update payout info" + amber warning
 *
 * Before first onboarding, the seller picks the currency they want to be paid
 * in. THB routes to the Stripe Thailand platform (PromptPay-enabled); USD
 * routes to the US platform (cards only). Stripe accounts can't move between
 * platforms after creation, so this choice is sticky.
 *
 * After currency selection but before Stripe's hosted flow, a bilingual
 * pre-screen lists what Stripe will ask for (ID, bank, address, phone) so
 * users know what they're walking into. Skipped on resume — the user has
 * already seen it.
 *
 * Handles the ?stripe_connect=complete|refresh query string Stripe redirects
 * back to: refreshes status from Stripe and clears the param.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
    CheckCircle,
    AlertCircle,
    ExternalLink,
    Loader2,
    CreditCard,
    IdCard,
    MapPin,
    Phone,
    Shield,
    X,
} from 'lucide-react';
import { useTranslation } from '@/lib/hooks/useTranslation';

type Currency = 'usd' | 'thb';

interface ConnectStatus {
    connected: boolean;
    accountId: string | null;
    region: 'us' | 'th' | null;
    status: 'pending' | 'enabled' | 'restricted' | 'rejected' | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
}

// Mirror lib/stripe.ts: TH path only renders if the platform is configured.
// The server route falls back to 'us' if the seller picks THB but the key is
// missing — exposing this flag here keeps the UI consistent with that behavior.
const TH_PAYOUTS_ENABLED = process.env.NEXT_PUBLIC_STRIPE_TH_ENABLED === '1';

export default function StripeConnectSection() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<ConnectStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pickedCurrency, setPickedCurrency] = useState<Currency>(
        TH_PAYOUTS_ENABLED ? 'thb' : 'usd'
    );
    const [showPreScreen, setShowPreScreen] = useState(false);

    const fetchStatus = useCallback(async (refresh = false) => {
        try {
            const res = await fetch(`/api/stripe/connect/status${refresh ? '?refresh=1' : ''}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setStatus(data);
        } catch (e: any) {
            setError(e.message || 'Failed to load Stripe status');
        } finally {
            setLoading(false);
        }
    }, []);

    const startOnboarding = useCallback(async (currency?: Currency) => {
        setActionLoading(true);
        setError(null);
        try {
            // Pass the current origin so Stripe returns the seller to the
            // exact deploy they started from (web, preview, localhost). The
            // server validates the host against an allowlist; on the Android
            // Capacitor app `window.location.origin` is https://cardstreet.app
            // which App Links intercepts back into the native shell.
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const res = await fetch('/api/stripe/connect/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...(currency ? { currency } : {}),
                    ...(origin
                        ? {
                            returnUrl: `${origin}/?stripe_connect=complete`,
                            refreshUrl: `${origin}/?stripe_connect=refresh`,
                        }
                        : {}),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start onboarding');
            window.location.href = data.url;
        } catch (e: any) {
            setError(e.message);
            setActionLoading(false);
        }
    }, []);

    // On mount: check for Stripe redirect query params, then load status.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const cn = params.get('stripe_connect');

        if (cn === 'complete' || cn === 'refresh') {
            // Strip the param so a refresh doesn't re-trigger
            params.delete('stripe_connect');
            const newSearch = params.toString();
            window.history.replaceState(
                {},
                '',
                window.location.pathname + (newSearch ? `?${newSearch}` : '')
            );

            if (cn === 'refresh') {
                // Link expired — kick off a new one. Currency choice doesn't
                // matter here: the account already exists, so the server will
                // ignore the body and use the persisted region.
                startOnboarding();
                return;
            }

            // 'complete' — refresh from Stripe to pick up the latest state
            fetchStatus(true);
            return;
        }

        fetchStatus(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const openDashboard = async () => {
        setActionLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/stripe/connect/dashboard', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to open dashboard');
            window.open(data.url, '_blank', 'noopener,noreferrer');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="bg-slate-900/40 border border-white/10 rounded-2xl p-5 flex items-center gap-3 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">{t('profile.stripeConnectLoading')}</span>
            </div>
        );
    }

    const isActive = status?.payoutsEnabled === true;
    const isRestricted = status?.status === 'restricted' || status?.status === 'rejected';
    const inProgress = status?.connected && !isActive && !isRestricted;

    const regionLabel =
        status?.region === 'th'
            ? t('profile.stripeRegionThb')
            : status?.region === 'us'
                ? t('profile.stripeRegionUsd')
                : null;

    // First-time onboarding gets the pre-screen so the user knows what
    // Stripe is about to ask for. Resume/restricted users skip it.
    const onSetUpClick = () => {
        if (!status?.connected) {
            setShowPreScreen(true);
        } else {
            startOnboarding();
        }
    };

    return (
        <>
            <div className="bg-slate-900/40 border border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-white font-bold text-base">{t('profile.stripeConnectTitle')}</h3>
                        <p className="text-slate-400 text-xs mt-1">
                            {t('profile.stripeConnectDesc')}
                        </p>
                        {regionLabel && (
                            <p className="text-[10px] text-brand-cyan font-bold uppercase tracking-widest mt-2">
                                {regionLabel}
                            </p>
                        )}
                    </div>
                    {isActive && (
                        <div className="flex items-center gap-1.5 text-brand-green text-xs font-bold uppercase tracking-wider shrink-0">
                            <CheckCircle className="w-4 h-4" />
                            {t('profile.stripeConnectActive')}
                        </div>
                    )}
                    {isRestricted && (
                        <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider shrink-0">
                            <AlertCircle className="w-4 h-4" />
                            {t('profile.stripeConnectActionNeeded')}
                        </div>
                    )}
                    {inProgress && (
                        <div className="flex items-center gap-1.5 text-brand-cyan text-xs font-bold uppercase tracking-wider shrink-0">
                            <AlertCircle className="w-4 h-4" />
                            {t('profile.stripeConnectIncomplete')}
                        </div>
                    )}
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg p-3">
                        {error}
                    </div>
                )}

                {!status?.connected && TH_PAYOUTS_ENABLED && (
                    <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                            {t('profile.stripeCurrencyPickerLabel')}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPickedCurrency('thb')}
                                disabled={actionLoading}
                                className={`flex-1 h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-colors ${pickedCurrency === 'thb'
                                    ? 'bg-brand-cyan/10 border-brand-cyan text-brand-cyan'
                                    : 'bg-white/5 border-transparent text-slate-400 hover:bg-white/10'
                                    }`}
                            >
                                {t('profile.stripeCurrencyThb')}
                            </button>
                            <button
                                onClick={() => setPickedCurrency('usd')}
                                disabled={actionLoading}
                                className={`flex-1 h-10 rounded-xl border text-xs font-black uppercase tracking-widest transition-colors ${pickedCurrency === 'usd'
                                    ? 'bg-brand-cyan/10 border-brand-cyan text-brand-cyan'
                                    : 'bg-white/5 border-transparent text-slate-400 hover:bg-white/10'
                                    }`}
                            >
                                {t('profile.stripeCurrencyUsd')}
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-500 italic">
                            {t('profile.stripeCurrencyLockedNote')}
                        </p>
                    </div>
                )}

                {!status?.connected && (
                    <button
                        onClick={onSetUpClick}
                        disabled={actionLoading}
                        className="w-full h-11 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        {t('profile.stripeConnectSetUp')}
                    </button>
                )}

                {inProgress && (
                    <button
                        onClick={() => startOnboarding()}
                        disabled={actionLoading}
                        className="w-full h-11 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        {t('profile.stripeConnectContinue')}
                    </button>
                )}

                {isRestricted && (
                    <button
                        onClick={openDashboard}
                        disabled={actionLoading}
                        className="w-full h-11 bg-amber-400 text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        {t('profile.stripeConnectUpdate')}
                    </button>
                )}

                {isActive && (
                    <button
                        onClick={openDashboard}
                        disabled={actionLoading}
                        className="w-full h-11 bg-slate-800 text-white border border-white/10 font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                        {t('profile.stripeConnectManage')}
                    </button>
                )}

                {status?.connected && !isActive && (
                    <p className="text-xs text-slate-500">
                        {t('profile.stripeConnectQueue')}
                    </p>
                )}
            </div>

            {showPreScreen && (
                <StripePreScreen
                    onCancel={() => setShowPreScreen(false)}
                    onContinue={() => {
                        setShowPreScreen(false);
                        startOnboarding(TH_PAYOUTS_ENABLED ? pickedCurrency : undefined);
                    }}
                    loading={actionLoading}
                />
            )}
        </>
    );
}

interface StripePreScreenProps {
    onCancel: () => void;
    onContinue: () => void;
    loading: boolean;
}

function StripePreScreen({ onCancel, onContinue, loading }: StripePreScreenProps) {
    const { t } = useTranslation();

    const items = [
        { icon: IdCard, label: t('profile.stripePreIdItem') },
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
