'use client';

/**
 * Shop status card — pause / reopen the whole shop ("vacation mode").
 *
 * Lives under the Stripe card in Profile > Seller Account (mobile) and above
 * "Your listings" on desktop /sell. One tap pauses: every active listing goes
 * to status='paused' (hidden from buyers, unbuyable), and reopening restores
 * them. The flip is atomic server-side (set_shop_paused in
 * 20260925_seller_shop_pause.sql); this card only shows state and asks.
 *
 * Pausing hides the seller's entire inventory, so it takes an inline confirm
 * step rather than firing on the first tap. Reopening is one tap — there is
 * nothing to lose by reopening.
 *
 * Renders nothing while the feature is unavailable (migration not applied):
 * a toggle that 503s would be worse than no toggle.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, PauseCircle, PlayCircle, Store } from 'lucide-react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import { useToast } from '@/lib/contexts/ToastContext';

interface ShopStatus {
    available: boolean;
    paused: boolean;
    pausedAt: string | null;
    activeCount: number;
    pausedCount: number;
}

/** Fired on window after a successful flip so listing surfaces can refetch. */
export const SHOP_PAUSE_CHANGED_EVENT = 'cs:shopPauseChanged';

export default function ShopPauseSection({
    onChanged,
    className = '',
}: {
    /** Called after a successful pause/reopen with the new state. */
    onChanged?: (paused: boolean) => void;
    className?: string;
}) {
    const { t } = useTranslation();
    const { settings } = useUserSettings();
    const { showToast } = useToast();
    const [status, setStatus] = useState<ShopStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/profile/shop', { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as ShopStatus;
            setStatus(data);
        } catch {
            // A failed read hides the card rather than showing a broken toggle.
            setStatus(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void fetchStatus(); }, [fetchStatus]);

    const setPaused = useCallback(async (paused: boolean) => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/profile/shop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ paused }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || t('profile.shopPauseError'));
            setConfirming(false);
            showToast(paused ? t('profile.shopPauseToastPaused') : t('profile.shopPauseToastReopened'), 'success');
            onChanged?.(paused);
            try {
                window.dispatchEvent(new CustomEvent(SHOP_PAUSE_CHANGED_EVENT, { detail: { paused } }));
            } catch { /* noop */ }
            await fetchStatus();
        } catch (e) {
            setError(e instanceof Error && e.message ? e.message : t('profile.shopPauseError'));
        } finally {
            setBusy(false);
        }
    }, [fetchStatus, onChanged, showToast, t]);

    if (loading) {
        return (
            <div className={`bg-slate-900/40 border border-white/10 rounded-2xl p-5 flex items-center gap-3 text-slate-400 ${className}`}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">{t('profile.shopPauseLoading')}</span>
            </div>
        );
    }
    if (!status || !status.available) return null;

    const paused = status.paused;
    const pausedSince = status.pausedAt
        ? new Date(status.pausedAt).toLocaleDateString(settings.language === 'TH' ? 'th-TH' : 'en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
        })
        : null;

    return (
        <div className={`bg-slate-900/40 border border-white/10 rounded-2xl p-5 space-y-4 ${className}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-white font-bold text-base flex items-center gap-2">
                        <Store className="w-4 h-4 text-brand-cyan shrink-0" />
                        {t('profile.shopPauseTitle')}
                    </h3>
                    <p className="text-slate-400 text-xs mt-1">
                        {paused ? t('profile.shopPausePausedDesc') : t('profile.shopPauseOpenDesc')}
                    </p>
                    {paused && pausedSince && (
                        <p className="text-[10px] text-amber-400/80 font-bold uppercase tracking-widest mt-2">
                            {t('profile.shopPausePausedSince')} {pausedSince}
                            {status.pausedCount > 0 ? ` · ${status.pausedCount} ${t('profile.shopPauseHiddenCount')}` : ''}
                        </p>
                    )}
                </div>
                {paused ? (
                    <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold uppercase tracking-wider shrink-0">
                        <PauseCircle className="w-4 h-4" />
                        {t('profile.shopPauseStatusPaused')}
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 text-brand-green text-xs font-bold uppercase tracking-wider shrink-0">
                        <PlayCircle className="w-4 h-4" />
                        {t('profile.shopPauseStatusOpen')}
                    </div>
                )}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg p-3">
                    {error}
                </div>
            )}

            {paused ? (
                <button
                    onClick={() => setPaused(false)}
                    disabled={busy}
                    className="w-full h-11 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                    {t('profile.shopPauseReopenBtn')}
                </button>
            ) : confirming ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-3">
                    <p className="text-amber-200 text-sm font-bold">{t('profile.shopPauseConfirmTitle')}</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                        {status.activeCount} {t('profile.shopPauseConfirmCount')}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                            className="flex-1 h-10 bg-white/5 border border-white/10 text-slate-200 font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-50"
                        >
                            {t('profile.shopPauseKeepOpen')}
                        </button>
                        <button
                            onClick={() => setPaused(true)}
                            disabled={busy}
                            className="flex-1 h-10 bg-amber-400 text-brand-darker font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-amber-300 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                            {t('profile.shopPauseConfirmBtn')}
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <button
                        onClick={() => setConfirming(true)}
                        disabled={busy}
                        className="w-full h-11 bg-slate-800 text-white border border-white/10 font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        <PauseCircle className="w-4 h-4" />
                        {t('profile.shopPauseBtn')}
                    </button>
                    <p className="text-xs text-slate-500">{t('profile.shopPauseHint')}</p>
                </>
            )}
        </div>
    );
}
