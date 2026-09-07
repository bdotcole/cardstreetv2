'use client';

import React, { useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';

export interface OrderReview {
    rating: number;
    comment: string | null;
}

/**
 * Stand-alone seller review for a delivered or completed order. Posts to
 * /api/reviews (one review per order; posting again edits it). The
 * confirm-delivery modals in Profile and DesktopOrders still take a review at
 * confirmation time; this is for the orders that completed on their own.
 */
export default function ReviewSheet({ orderId, initial, onClose, onSaved }: {
    orderId: string;
    initial?: OrderReview | null;
    onClose: () => void;
    onSaved: (review: OrderReview) => void;
}) {
    const { t } = useTranslation();
    const [rating, setRating] = useState<number>(initial?.rating ?? 5);
    const [comment, setComment] = useState<string>(initial?.comment ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/reviews', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ orderId, rating, comment }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
            onSaved(data.review ?? { rating, comment: comment || null });
        } catch (e: any) {
            setError(e?.message || 'Network error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-4 bg-brand-darker/90 backdrop-blur-sm">
            <div className="w-full max-w-sm glass rounded-3xl p-6 border border-white/10 relative overflow-hidden bg-slate-900">
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-brand-orange to-amber-500"></div>
                <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-black text-white leading-tight">{t('orderActions.reviewTitle')}</h3>
                    <button onClick={onClose} aria-label={t('orderActions.cancel')} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <i className="fa-solid fa-xmark text-slate-400"></i>
                    </button>
                </div>
                <p className="text-slate-400 text-sm mb-5 leading-relaxed">{t('orderActions.reviewIntro')}</p>

                <div className="flex gap-2 mb-4">
                    {[1, 2, 3, 4, 5].map((star) => (
                        <button
                            key={star}
                            type="button"
                            onClick={() => setRating(star)}
                            aria-label={`${star}`}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${rating >= star ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50' : 'bg-white/5 text-slate-600 border border-transparent'}`}
                        >
                            <i className="fa-solid fa-star text-sm"></i>
                        </button>
                    ))}
                </div>
                <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder={t('profile.reviewPlaceholder')}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-orange/50 resize-none mb-4"
                />

                {error && <p className="text-xs text-rose-300 mb-3">{error}</p>}

                <button
                    onClick={submit}
                    disabled={busy}
                    className="w-full h-12 rounded-xl bg-brand-orange text-white font-black text-sm uppercase tracking-wider hover:bg-white hover:text-brand-darker active:scale-[0.98] transition-all disabled:opacity-50"
                >
                    {busy ? t('orderActions.sending') : t('orderActions.submitReview')}
                </button>
            </div>
        </div>
    );
}
