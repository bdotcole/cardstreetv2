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
 * Handles the ?stripe_connect=complete|refresh query string Stripe redirects
 * back to: refreshes status from Stripe and clears the param.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, ExternalLink, Loader2 } from 'lucide-react';

interface ConnectStatus {
    connected: boolean;
    accountId: string | null;
    status: 'pending' | 'enabled' | 'restricted' | 'rejected' | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
}

export default function StripeConnectSection() {
    const [status, setStatus] = useState<ConnectStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
                // Link expired — kick off a new one
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

    const startOnboarding = async () => {
        setActionLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/stripe/connect/start', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start onboarding');
            window.location.href = data.url;
        } catch (e: any) {
            setError(e.message);
            setActionLoading(false);
        }
    };

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
                <span className="text-sm">Loading payout status…</span>
            </div>
        );
    }

    const isActive = status?.payoutsEnabled === true;
    const isRestricted = status?.status === 'restricted' || status?.status === 'rejected';
    const inProgress = status?.connected && !isActive && !isRestricted;

    return (
        <div className="bg-slate-900/40 border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-white font-bold text-base">Seller Payouts</h3>
                    <p className="text-slate-400 text-xs mt-1">
                        Connect your bank via Stripe to receive payouts from sales.
                    </p>
                </div>
                {isActive && (
                    <div className="flex items-center gap-1.5 text-brand-green text-xs font-bold uppercase tracking-wider shrink-0">
                        <CheckCircle className="w-4 h-4" />
                        Active
                    </div>
                )}
                {isRestricted && (
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider shrink-0">
                        <AlertCircle className="w-4 h-4" />
                        Action needed
                    </div>
                )}
                {inProgress && (
                    <div className="flex items-center gap-1.5 text-brand-cyan text-xs font-bold uppercase tracking-wider shrink-0">
                        <AlertCircle className="w-4 h-4" />
                        Incomplete
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
                    onClick={startOnboarding}
                    disabled={actionLoading}
                    className="w-full h-11 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    Set up payouts with Stripe
                </button>
            )}

            {inProgress && (
                <button
                    onClick={startOnboarding}
                    disabled={actionLoading}
                    className="w-full h-11 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    Continue payout setup
                </button>
            )}

            {isRestricted && (
                <button
                    onClick={openDashboard}
                    disabled={actionLoading}
                    className="w-full h-11 bg-amber-400 text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-amber-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    Update payout info
                </button>
            )}

            {isActive && (
                <button
                    onClick={openDashboard}
                    disabled={actionLoading}
                    className="w-full h-11 bg-slate-800 text-white border border-white/10 font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    Manage payouts
                </button>
            )}

            {status?.connected && !isActive && (
                <p className="text-xs text-slate-500">
                    Until payouts are active, completed orders queue automatically and pay
                    out as soon as Stripe finishes verifying your account.
                </p>
            )}
        </div>
    );
}
