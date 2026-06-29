'use client'

import React, { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import AuthModal from '@/components/AuthModal';
import { formatTHB } from '@/components/desktop/DesktopMarketplace';

// Shapes returned by /api/profile/{orders,shipments,sales} — same contracts
// the mobile Profile panels consume.
interface OrderRow {
    id: string;
    status: string;
    created_at: string;
    total_amount: number;
    listing: { card_data: any; condition: string } | null;
    shipping_labels?: {
        tracking_number?: string | null;
        carrier_name?: string | null;
        courier_tracking_url?: string | null;
    }[];
}

interface SaleRow {
    id: string;
    total_amount: number;
    platform_fee: number;
    completed_at: string;
    listing: { card_data: any; condition: string; price: number } | null;
}

type Tab = 'purchases' | 'shipments' | 'sales';

// Raw order status -> Tailwind tone (CSS, locale-independent) and the i18n key
// under desktop.orders.status. Several backend statuses collapse to one
// user-facing label (e.g. paid/label_generated/processing all read "Processing").
const STATUS_META: Record<string, { tone: string; key: string }> = {
    pending: { tone: 'bg-slate-700/60 text-slate-300 border-slate-600', key: 'pending_payment' },
    paid: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', key: 'processing' },
    label_generated: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', key: 'processing' },
    processing: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', key: 'processing' },
    shipped: { tone: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', key: 'shipped' },
    in_transit: { tone: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', key: 'in_transit' },
    out_for_delivery: { tone: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', key: 'out_for_delivery' },
    delivered: { tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', key: 'delivered' },
    completed: { tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', key: 'completed' },
    cancelled: { tone: 'bg-slate-700/60 text-slate-400 border-slate-600', key: 'cancelled' },
    disputed: { tone: 'bg-brand-red/10 text-rose-300 border-brand-red/30', key: 'disputed' },
};

function StatusChip({ status }: { status: string }) {
    const { t } = useTranslation();
    const meta = STATUS_META[status];
    const tone = meta?.tone ?? 'bg-slate-700/60 text-slate-300 border-slate-600';
    const label = meta ? t(`desktop.orders.status.${meta.key}`) : status.replace(/_/g, ' ');
    return (
        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${tone}`}>
            {label}
        </span>
    );
}

function CardCell({ cardData, condition }: { cardData: any; condition?: string }) {
    return (
        <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-14 rounded-md bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                {cardData?.images?.small && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={getThumbnailUrl(cardData.images.small)} alt="" loading="lazy" className="w-full h-full object-cover" />
                )}
            </span>
            <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{cardData?.name || 'Card order'}</p>
                {condition && <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wide">{condition}</p>}
            </div>
        </div>
    );
}

export default function DesktopOrders() {
    const { showToast } = useToast();
    const { t } = useTranslation();
    const [user, setUser] = useState<User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);

    const [tab, setTab] = useState<Tab>('purchases');
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [shipments, setShipments] = useState<OrderRow[]>([]);
    const [sales, setSales] = useState<SaleRow[]>([]);
    const [loading, setLoading] = useState(true);

    // Confirm-delivery review modal
    const [reviewOrderId, setReviewOrderId] = useState<string | null>(null);
    const [reviewScore, setReviewScore] = useState(5);
    const [reviewComment, setReviewComment] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            setUser(data.user ?? null);
            setAuthChecked(true);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    const fetchTab = useCallback(async (which: Tab) => {
        setLoading(true);
        try {
            if (which === 'purchases') {
                const res = await fetch('/api/profile/orders?limit=50');
                const data = await res.json();
                if (res.ok) setOrders(data.orders || []);
            } else if (which === 'shipments') {
                const res = await fetch('/api/profile/shipments');
                const data = await res.json();
                if (res.ok) setShipments(data.shipments || []);
            } else {
                const res = await fetch('/api/profile/sales');
                const data = await res.json();
                if (res.ok) setSales(data.sales || []);
            }
        } catch (err) {
            console.error('Failed to load', which, err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) fetchTab(tab);
    }, [user, tab, fetchTab]);

    const openLabel = async (orderId: string) => {
        try {
            const res = await fetch(`/api/orders/${orderId}/label/url`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || t('desktop.orders.toastLabelFailed'));
            window.open(data.url, '_blank', 'noopener');
        } catch (err: any) {
            showToast(err.message || t('desktop.orders.toastLabelFailed'), 'error');
        }
    };

    const submitCompleteOrder = async () => {
        if (!reviewOrderId) return;
        setSubmittingReview(true);
        try {
            const res = await fetch('/api/orders/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: reviewOrderId, reviewScore: reviewScore || null, reviewComment }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || t('desktop.orders.toastConfirmFailed'));
            }
            setReviewOrderId(null);
            showToast(t('desktop.orders.toastCompleted'), 'success');
            fetchTab('purchases');
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setSubmittingReview(false);
        }
    };

    if (!authChecked) {
        return <div className="h-64 rounded-2xl bg-white/5 animate-pulse"></div>;
    }

    if (!user) {
        return (
            <div className="text-center py-24">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                    <i className="fa-solid fa-box-open text-2xl text-slate-600"></i>
                </div>
                <h1 className="text-white font-bold uppercase tracking-widest text-sm mb-1">{t('desktop.orders.signedOutTitle')}</h1>
                <p className="text-slate-500 text-sm mb-6">{t('desktop.orders.signedOutDesc')}</p>
                <button
                    onClick={() => setAuthOpen(true)}
                    className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-6 py-2.5 rounded-xl transition-colors"
                >
                    {t('desktop.signIn')}
                </button>
                <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-2xl font-black text-white">{t('desktop.orders.title')}</h1>
            <p className="text-sm text-slate-400 mt-1">{t('desktop.orders.subtitle')}</p>

            <div className="flex gap-2 mt-6 border-b border-white/5">
                {([
                    ['purchases', t('desktop.orders.tabPurchases')],
                    ['shipments', t('desktop.orders.tabShipments')],
                    ['sales', t('desktop.orders.tabSales')],
                ] as [Tab, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`px-5 py-3 text-sm font-bold border-b-2 -mb-px transition-colors ${
                            tab === key
                                ? 'text-white border-brand-cyan'
                                : 'text-slate-500 border-transparent hover:text-slate-300'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="space-y-2 mt-6">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse"></div>
                    ))}
                </div>
            ) : (
                <div className="mt-6">
                    {tab === 'purchases' && (
                        orders.length === 0 ? (
                            <p className="text-slate-500 text-sm">{t('desktop.orders.noPurchases')}</p>
                        ) : (
                            <div className="space-y-2">
                                {orders.map((order) => {
                                    const label = order.shipping_labels?.[0];
                                    const canComplete = ['shipped', 'out_for_delivery', 'delivered'].includes(order.status);
                                    return (
                                        <div key={order.id} className="flex flex-wrap items-center justify-between gap-4 bg-[#1e293b]/40 border border-white/5 rounded-xl px-4 py-3">
                                            <CardCell cardData={order.listing?.card_data} condition={order.listing?.condition} />
                                            <div className="flex items-center gap-5 flex-wrap">
                                                {label?.tracking_number && label.tracking_number !== 'MANUAL' && (
                                                    <span className="text-xs text-slate-400">
                                                        <span className="font-mono text-white">{label.tracking_number}</span>
                                                        {label.courier_tracking_url && (
                                                            <a
                                                                href={label.courier_tracking_url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-brand-cyan hover:underline ml-2 font-bold uppercase text-[10px] tracking-widest"
                                                            >
                                                                {t('desktop.orders.track')} ↗
                                                            </a>
                                                        )}
                                                    </span>
                                                )}
                                                {label?.tracking_number === 'MANUAL' && (
                                                    <span className="text-xs text-amber-300 italic">{t('desktop.orders.manual')}</span>
                                                )}
                                                <span className="text-xs text-slate-500">{new Date(order.created_at).toLocaleDateString()}</span>
                                                <StatusChip status={order.status} />
                                                <span className="text-lg font-black text-brand-cyan">{formatTHB(order.total_amount)}</span>
                                                {canComplete && (
                                                    <button
                                                        onClick={() => { setReviewOrderId(order.id); setReviewScore(5); setReviewComment(''); }}
                                                        className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-xs font-black px-4 py-2 rounded-lg transition-colors"
                                                    >
                                                        {t('desktop.orders.confirmDelivery')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {tab === 'shipments' && (
                        shipments.length === 0 ? (
                            <p className="text-slate-500 text-sm">{t('desktop.orders.noShipments')}</p>
                        ) : (
                            <div className="space-y-2">
                                {shipments.map((order) => (
                                    <div key={order.id} className="flex flex-wrap items-center justify-between gap-4 bg-[#1e293b]/40 border border-white/5 rounded-xl px-4 py-3">
                                        <CardCell cardData={order.listing?.card_data} condition={order.listing?.condition} />
                                        <div className="flex items-center gap-5 flex-wrap">
                                            <span className="text-xs text-slate-500">{new Date(order.created_at).toLocaleDateString()}</span>
                                            <StatusChip status={order.status} />
                                            <span className="text-lg font-black text-brand-cyan">{formatTHB(order.total_amount)}</span>
                                            <button
                                                onClick={() => openLabel(order.id)}
                                                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                                            >
                                                <i className="fa-solid fa-print mr-2 text-slate-400"></i>
                                                {t('desktop.orders.shippingLabel')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {tab === 'sales' && (
                        sales.length === 0 ? (
                            <p className="text-slate-500 text-sm">{t('desktop.orders.noSales')}</p>
                        ) : (
                            <div className="space-y-2">
                                {sales.map((sale) => (
                                    <div key={sale.id} className="flex flex-wrap items-center justify-between gap-4 bg-[#1e293b]/40 border border-white/5 rounded-xl px-4 py-3">
                                        <CardCell cardData={sale.listing?.card_data} condition={sale.listing?.condition} />
                                        <div className="flex items-center gap-5 flex-wrap">
                                            <span className="text-xs text-slate-500">
                                                {sale.completed_at ? new Date(sale.completed_at).toLocaleDateString() : ''}
                                            </span>
                                            <span className="text-xs text-slate-400">
                                                {t('desktop.orders.fee')} <span className="text-slate-300 font-bold">{formatTHB(sale.platform_fee || 0)}</span>
                                            </span>
                                            <span className="text-lg font-black text-emerald-300">
                                                {formatTHB((sale.total_amount || 0) - (sale.platform_fee || 0))}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            )}

            {reviewOrderId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setReviewOrderId(null)}></div>
                    <div className="relative w-full max-w-sm bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl p-6">
                        <h3 className="text-white font-black text-lg">{t('desktop.orders.confirmDelivery')}</h3>
                        <p className="text-slate-400 text-sm mt-1">{t('desktop.orders.rateSeller')}</p>
                        <div className="flex gap-2 mt-4">
                            {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                    key={n}
                                    onClick={() => setReviewScore(n)}
                                    className={`text-2xl transition-colors ${n <= reviewScore ? 'text-yellow-400' : 'text-slate-700 hover:text-slate-500'}`}
                                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                                >
                                    ★
                                </button>
                            ))}
                        </div>
                        <textarea
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder={t('desktop.orders.reviewPlaceholder')}
                            rows={3}
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 mt-4 resize-none"
                        />
                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setReviewOrderId(null)}
                                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-bold py-2.5 rounded-xl transition-colors"
                            >
                                {t('desktop.orders.cancel')}
                            </button>
                            <button
                                onClick={submitCompleteOrder}
                                disabled={submittingReview}
                                className="flex-1 bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black py-2.5 rounded-xl transition-colors disabled:opacity-50"
                            >
                                {submittingReview ? t('desktop.orders.confirming') : t('desktop.orders.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
