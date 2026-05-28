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
 * Single-platform for now: every new account is created on Stripe Thailand
 * (which handles both cards and PromptPay). The dual-platform region routing
 * in lib/stripe.ts and app/api/stripe/connect/start/route.ts is preserved
 * server-side so we can layer a US platform back on later without a UI
 * rewrite — at that point we'll re-add a currency picker here.
 *
 * Before Stripe's hosted flow, a bilingual pre-screen lists what Stripe will
 * ask for (ID, bank, address, phone) so users know what they're walking
 * into. Skipped on resume — the user has already seen it.
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

interface ConnectStatus {
    connected: boolean;
    accountId: string | null;
    region: 'us' | 'th' | null;
    status: 'pending' | 'enabled' | 'restricted' | 'rejected' | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
}

// Detect the Capacitor native shell. Resolves false in any non-Capacitor
// (web) context — including SSR.
async function detectNativePlatform(): Promise<boolean> {
    try {
        const { Capacitor } = await import('@capacitor/core');
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}

// Where Stripe should send the seller back to after a hosted flow.
//   - Native: bounce through /mobile-redirect, which forwards to the
//     cardstreet:// custom scheme the app intercepts. App Links on
//     cardstreet.app are unreliable, so we never rely on them. The
//     appUrlOpen handler in app/page.tsx turns that deep link into a
//     'stripe-connect-return' event (listened for below).
//   - Web: return to the current origin (localhost / preview / prod).
function stripeReturnUrls(isNative: boolean): { returnUrl?: string; refreshUrl?: string } {
    if (isNative) {
        return {
            returnUrl: 'https://cardstreet.app/mobile-redirect?stripe_connect=complete',
            refreshUrl: 'https://cardstreet.app/mobile-redirect?stripe_connect=refresh',
        };
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (!origin) return {};
    return {
        returnUrl: `${origin}/?stripe_connect=complete`,
        refreshUrl: `${origin}/?stripe_connect=refresh`,
    };
}

// Open a Stripe-hosted URL the right way for the platform. On native we use
// the in-app browser (Custom Tab) so the deep-link return can dismiss it via
// Browser.close() in the appUrlOpen handler, exactly like the OAuth login
// flow. On web: 'navigate' replaces the current page (onboarding), 'newtab'
// opens a separate tab (dashboard/manage).
async function openStripeUrl(url: string, isNative: boolean, webMode: 'navigate' | 'newtab') {
    if (isNative) {
        try {
            const { Browser } = await import('@capacitor/browser');
            await Browser.open({ url });
        } catch {
            window.open(url, '_system');
        }
        return;
    }
    if (webMode === 'navigate') {
        window.location.href = url;
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

export default function StripeConnectSection() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<ConnectStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
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

    // Begin/resume the hosted onboarding flow. Used for fresh accounts and to
    // resolve a restricted account's outstanding requirements (account_onboarding
    // works for full-dashboard v2 accounts; a login link does not).
    const startOnboarding = useCallback(async () => {
        setActionLoading(true);
        setError(null);
        try {
            const isNative = await detectNativePlatform();
            const urls = stripeReturnUrls(isNative);
            const res = await fetch('/api/stripe/connect/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(urls.returnUrl ? urls : {}),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start onboarding');
            await openStripeUrl(data.url, isNative, 'navigate');
            // Native: leave actionLoading true — the page stays mounted while
            // the user is in the browser, and the stripe-connect-return event
            // resets it on the way back. Web: we've navigated away.
            if (!isNative) setActionLoading(false);
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
                // Link expired — kick off a new one. The server uses the
                // persisted region for existing accounts; for fresh ones it
                // defaults to TH via preferred_currency.
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

    // Native return path: the WebView never navigates to ?stripe_connect=...
    // (Stripe redirects an external browser, not the WebView), so the mount
    // effect above never sees it. Instead the appUrlOpen deep-link handler in
    // app/page.tsx fires this event when the cardstreet:// scheme brings the
    // app back to the foreground. 'refresh' restarts onboarding; otherwise we
    // re-pull status from Stripe.
    useEffect(() => {
        const onReturn = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            setActionLoading(false);
            if (detail === 'refresh') {
                startOnboarding();
            } else {
                setLoading(true);
                fetchStatus(true);
            }
        };
        window.addEventListener('stripe-connect-return', onReturn);
        return () => window.removeEventListener('stripe-connect-return', onReturn);
    }, [fetchStatus, startOnboarding]);

    // Open the seller's account management. For legacy Express accounts this
    // is a single-use Express Dashboard login link; for full-dashboard v2
    // accounts (no Express Dashboard) the server falls back to a hosted
    // account_update AccountLink, which needs return URLs and the native
    // deep-link bounce just like onboarding.
    const openDashboard = useCallback(async () => {
        setActionLoading(true);
        setError(null);
        try {
            const isNative = await detectNativePlatform();
            const urls = stripeReturnUrls(isNative);
            const res = await fetch('/api/stripe/connect/dashboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(urls.returnUrl ? urls : {}),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to open dashboard');
            await openStripeUrl(data.url, isNative, 'newtab');
            // Native: the stripe-connect-return event resets actionLoading when
            // an account_update flow deep-links back (a plain login link won't,
            // but it's terminal anyway). Web: nothing kept us blocked.
            if (!isNative) setActionLoading(false);
        } catch (e: any) {
            setError(e.message);
            setActionLoading(false);
        }
    }, []);

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
                        onClick={() => startOnboarding()}
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
                        startOnboarding();
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
