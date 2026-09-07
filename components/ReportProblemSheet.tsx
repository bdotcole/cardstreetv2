'use client';

import React, { useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { DISPUTE_REASONS, DISPUTE_REASON_KEYS, type DisputeReason } from '@/lib/orderDisputes';

/**
 * "Report a problem" for a buyer's order. Posts to /api/orders/[id]/report, which
 * files a support ticket, puts the order on hold as 'disputed', and pages the
 * founder. One component for all three Track Order surfaces so the copy and the
 * reason set cannot drift between them.
 */
export default function ReportProblemSheet({ orderId, onClose, onReported }: {
    orderId: string;
    onClose: () => void;
    onReported: () => void;
}) {
    const { t } = useTranslation();
    const [reason, setReason] = useState<DisputeReason | null>(null);
    const [details, setDetails] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (!reason || busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ reason, details }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
            onReported();
        } catch (e: any) {
            setError(e?.message || 'Network error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 bg-brand-darker/90 backdrop-blur-sm">
            <div className="w-full max-w-sm glass rounded-3xl p-6 border border-white/10 relative overflow-hidden bg-slate-900">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-rose-500 to-amber-500"></div>
                <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-black text-white leading-tight">{t('orderActions.reportTitle')}</h3>
                    <button onClick={onClose} aria-label={t('orderActions.cancel')} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <i className="fa-solid fa-xmark text-slate-400"></i>
                    </button>
                </div>
                <p className="text-slate-400 text-sm mb-5 leading-relaxed">{t('orderActions.reportIntro')}</p>

                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{t('orderActions.reasonLabel')}</label>
                <div className="grid grid-cols-1 gap-2 mb-4">
                    {DISPUTE_REASONS.map((r) => (
                        <button
                            key={r}
                            type="button"
                            onClick={() => setReason(r)}
                            className={`text-left px-4 py-3 rounded-xl border text-sm font-bold transition-colors ${reason === r ? 'bg-rose-500/15 border-rose-400/50 text-white' : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'}`}
                        >
                            {t(DISPUTE_REASON_KEYS[r])}
                        </button>
                    ))}
                </div>

                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">{t('orderActions.detailsLabel')}</label>
                <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder={t('orderActions.detailsPlaceholder')}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-400/50 resize-none mb-4"
                />

                {error && <p className="text-xs text-rose-300 mb-3">{error}</p>}

                <button
                    onClick={submit}
                    disabled={!reason || busy}
                    className="w-full h-12 rounded-xl bg-rose-500 text-white font-black text-sm uppercase tracking-wider hover:bg-rose-400 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {busy ? t('orderActions.sending') : t('orderActions.submitReport')}
                </button>
                <p className="text-[11px] text-slate-500 mt-3 text-center">{t('orderActions.guarantee')}</p>
            </div>
        </div>
    );
}
