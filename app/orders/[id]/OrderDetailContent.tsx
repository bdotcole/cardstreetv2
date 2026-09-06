'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';

export interface OrderDetailData {
    id: string;
    status: string;
    totalAmount: number;
    platformFee: number;
    shippingFee: number;
    createdAt: string;
    completedAt: string | null;
    // Live-break spot order: no per-order label exists (parcels consolidate at
    // stream settle), and card.name may be empty when the break join failed.
    isBreakOrder?: boolean;
    card: {
        name: string;
        set: string;
        imageSmall: string | null;
        condition: string | null;
        isGraded: boolean;
        gradingCompany: string | null;
        grade: string | null;
    };
    tracking: { number: string; url: string | null } | null;
}

interface Props {
    order?: OrderDetailData;
    role?: 'seller' | 'buyer';
    orderId: string;
    signedOut?: boolean;
}

const fmtTHB = (n: number): string => `฿${Math.round(n).toLocaleString()}`;

// Raw order status -> tone + bilingual label. Several backend statuses collapse
// to one user-facing label, matching components/desktop/DesktopOrders.
const STATUS: Record<string, { tone: string; en: string; th: string }> = {
    pending: { tone: 'bg-slate-700/60 text-slate-300 border-slate-600', en: 'Awaiting payment', th: 'รอการชำระเงิน' },
    pending_payment: { tone: 'bg-slate-700/60 text-slate-300 border-slate-600', en: 'Awaiting payment', th: 'รอการชำระเงิน' },
    // PromptPay settles asynchronously: the buyer has scanned and paid, and the
    // bank confirmation lands seconds to minutes later via the webhook. Between
    // those two moments "Awaiting payment" reads as "your payment failed" to
    // someone who just watched their banking app succeed — the single worst
    // thing to tell a first-time buyer on a rail we are actively pushing them
    // toward. This is the state that says "we have it, we are checking".
    payment_confirming: { tone: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', en: 'Confirming payment', th: 'กำลังยืนยันการชำระเงิน' },
    paid: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', en: 'Processing', th: 'กำลังดำเนินการ' },
    label_generated: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', en: 'Ready to ship', th: 'พร้อมจัดส่ง' },
    processing: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', en: 'Processing', th: 'กำลังดำเนินการ' },
    shipped: { tone: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', en: 'Shipped', th: 'จัดส่งแล้ว' },
    in_transit: { tone: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', en: 'In transit', th: 'กำลังจัดส่ง' },
    out_for_delivery: { tone: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30', en: 'Out for delivery', th: 'กำลังนำจ่าย' },
    delivered: { tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', en: 'Delivered', th: 'จัดส่งสำเร็จ' },
    completed: { tone: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', en: 'Completed', th: 'เสร็จสมบูรณ์' },
    cancelled: { tone: 'bg-slate-700/60 text-slate-400 border-slate-600', en: 'Cancelled', th: 'ยกเลิกแล้ว' },
    disputed: { tone: 'bg-brand-red/10 text-rose-300 border-brand-red/30', en: 'Disputed', th: 'มีข้อพิพาท' },
};

// Statuses where a seller can still pull the shipping label.
const SHIPPABLE = new Set(['paid', 'label_generated', 'processing', 'shipped', 'out_for_delivery']);

/**
 * Seller handling window, in days. Matches the Product JSON-LD's handlingTime
 * (minValue 1, maxValue 2) on every card page — the promise a buyer may already
 * have read in a search result, so the order page must not quote a different one.
 */
const HANDLING_DAYS = 2;

/** "Seller ships by <date>", or null before payment (nothing to promise yet). */
function shipByLabel(createdAt: string, status: string, isThai: boolean): string | null {
    if (status === 'pending' || status === 'pending_payment' || status === 'cancelled') return null;
    const t = Date.parse(createdAt);
    if (!Number.isFinite(t)) return null;
    return new Date(t + HANDLING_DAYS * 864e5).toLocaleDateString(isThai ? 'th-TH' : 'en-GB', {
        weekday: 'short', day: 'numeric', month: 'short',
    });
}

const shellClass = 'min-h-screen bg-brand-darker text-white p-6 pb-24';

export default function OrderDetailContent({ order, role, orderId, signedOut }: Props) {
    const { isThai } = useTranslation();
    const [labelBusy, setLabelBusy] = useState(false);
    const [labelError, setLabelError] = useState<string | null>(null);
    // Read in an effect, not during render: this page is server-rendered and a
    // window read at render time would not match on hydration.
    const [confirming, setConfirming] = useState(false);
    React.useEffect(() => {
        try {
            setConfirming(new URLSearchParams(window.location.search).get('confirming') === '1');
        } catch { /* no query string — the real status stands */ }
    }, []);

    if (signedOut || !order) {
        return (
            <div className={shellClass}>
                <div className="max-w-md mx-auto pt-16 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl glass border border-white/10 flex items-center justify-center mx-auto text-brand-cyan">
                        <i className="fa-solid fa-lock text-lg"></i>
                    </div>
                    <h1 className="text-xl font-black">{isThai ? 'เข้าสู่ระบบเพื่อดูคำสั่งซื้อนี้' : 'Sign in to view this order'}</h1>
                    <p className="text-sm text-slate-400">
                        {isThai
                            ? 'คำสั่งซื้อนี้เป็นข้อมูลส่วนตัว กรุณาเข้าสู่ระบบด้วยบัญชี CardStreet ของคุณ แล้วเปิดลิงก์นี้อีกครั้ง'
                            : 'This order is private. Sign in to your CardStreet account, then reopen this link.'}
                    </p>
                    <Link
                        href="/"
                        className="inline-block bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
                    >
                        {isThai ? 'ไปที่ CardStreet' : 'Go to CardStreet'}
                    </Link>
                </div>
            </div>
        );
    }

    // ?confirming=1 arrives straight from a PromptPay authorisation: the buyer
    // has paid, the webhook has not landed yet, and the row still says
    // pending_payment. Show the confirming state for that window instead of
    // "Awaiting payment", which reads as a failure. Only an override of the
    // LABEL — the order's real status is untouched, and a refresh after the
    // webhook lands shows the true one.
    const effectiveStatus =
        confirming && (order.status === 'pending_payment' || order.status === 'pending')
            ? 'payment_confirming'
            : order.status;
    const st = STATUS[effectiveStatus] ?? { tone: 'bg-slate-700/60 text-slate-300 border-slate-600', en: order.status.replace(/_/g, ' '), th: order.status.replace(/_/g, ' ') };
    const shortId = order.id.slice(0, 8).toUpperCase();
    const shipBy = shipByLabel(order.createdAt, order.status, isThai);
    const isSeller = role === 'seller';
    const payout = order.totalAmount - order.platformFee;
    const buyerTotal = order.totalAmount + order.shippingFee;
    const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(isThai ? 'th-TH' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

    const openLabel = async () => {
        setLabelBusy(true);
        setLabelError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/label/url`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || 'label_failed');
            window.open(data.url, '_blank', 'noopener');
        } catch {
            setLabelError(isThai ? 'เปิดใบปะหน้าไม่สำเร็จ ลองใหม่อีกครั้ง' : 'Could not open the label. Please try again.');
        } finally {
            setLabelBusy(false);
        }
    };

    const L = isThai
        ? { order: 'คำสั่งซื้อ', placed: 'สั่งซื้อเมื่อ', item: 'สินค้า', shipping: 'ค่าจัดส่ง', fee: 'ค่าธรรมเนียม', payout: 'ยอดที่คุณจะได้รับ', total: 'ยอดรวม', tracking: 'เลขพัสดุ', track: 'ติดตามพัสดุ', printLabel: 'พิมพ์ใบปะหน้าพัสดุ', preparing: 'กำลังเตรียม…', viewAll: 'ดูคำสั่งซื้อทั้งหมด', graded: 'จัดเกรด', liveBreakSpot: 'สปอตไลฟ์เบรก', breakParcel: 'จัดส่งรวมกับพัสดุเบรกหลังจบไลฟ์', shipBy: 'ผู้ขายจะจัดส่งภายใน', shipByHint: 'จัดส่งโดย Flash Express ถึงมือคุณใน 1-3 วัน', trackingPending: 'จะแสดงเลขพัสดุที่นี่ทันทีที่ผู้ขายพิมพ์ใบปะหน้า' }
        : { order: 'Order', placed: 'Placed', item: 'Item', shipping: 'Shipping', fee: 'Platform fee', payout: 'Your payout', total: 'Total', tracking: 'Tracking', track: 'Track parcel', printLabel: 'Print shipping label', preparing: 'Preparing…', viewAll: 'View all orders', graded: 'Graded', liveBreakSpot: 'Live break spot', breakParcel: 'Ships with the break parcel after the show', shipBy: 'Seller ships by', shipByHint: 'Flash Express, 1-3 days to your door once collected.', trackingPending: 'Appears here as soon as the seller prints the label.' };

    return (
        <div className={shellClass}>
            <div className="max-w-lg mx-auto pt-8 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-cyan italic skew-x-[-10deg]">{L.order}</p>
                        <h1 className="text-2xl font-black tracking-tight">#{shortId}</h1>
                        <p className="text-xs text-slate-500 mt-1">{L.placed} {fmtDate(order.createdAt)}</p>
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded border shrink-0 ${st.tone}`}>
                        {isThai ? st.th : st.en}
                    </span>
                </div>

                {/* Card */}
                <div className="glass rounded-2xl border border-white/10 p-4 flex items-center gap-4">
                    <span className="w-16 h-[88px] rounded-lg bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                        {order.card.imageSmall && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={getThumbnailUrl(order.card.imageSmall)} alt="" loading="lazy" className="w-full h-full object-cover" />
                        )}
                    </span>
                    <div className="min-w-0">
                        <p className="font-bold text-white truncate">{order.card.name || (order.isBreakOrder ? L.liveBreakSpot : '')}</p>
                        {order.card.set && <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate">{order.card.set}</p>}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {order.card.condition && (
                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-300 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">{order.card.condition}</span>
                            )}
                            {order.card.isGraded && (order.card.gradingCompany || order.card.grade) && (
                                <span className="text-[10px] font-bold uppercase tracking-wide text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/30 rounded px-1.5 py-0.5">
                                    {L.graded} {[order.card.gradingCompany, order.card.grade].filter(Boolean).join(' ')}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Money */}
                <div className="glass rounded-2xl border border-white/10 p-5 space-y-3 text-sm">
                    <div className="flex justify-between">
                        <span className="text-slate-400">{L.item}</span>
                        <span className="font-bold">{fmtTHB(order.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-slate-400">{L.shipping}</span>
                        <span className="font-bold">{fmtTHB(order.shippingFee)}</span>
                    </div>
                    {isSeller ? (
                        <>
                            <div className="flex justify-between">
                                <span className="text-slate-400">{L.fee}</span>
                                <span className="font-bold text-rose-300">- {fmtTHB(order.platformFee)}</span>
                            </div>
                            <div className="flex justify-between pt-3 border-t border-white/10">
                                <span className="font-black uppercase tracking-wider text-[11px] text-slate-300 self-center">{L.payout}</span>
                                <span className="text-xl font-black text-emerald-300">{fmtTHB(payout)}</span>
                            </div>
                        </>
                    ) : (
                        <div className="flex justify-between pt-3 border-t border-white/10">
                            <span className="font-black uppercase tracking-wider text-[11px] text-slate-300 self-center">{L.total}</span>
                            <span className="text-xl font-black text-brand-cyan">{fmtTHB(buyerTotal)}</span>
                        </div>
                    )}
                </div>

                {/* Ship-by date. A buyer who has just paid wants one thing: when
                    does it move. Derived from the order's own created_at plus
                    the handling window the Product JSON-LD already publishes
                    (1-2 days), so the page and the structured data cannot
                    disagree. Hidden once it has actually shipped, when the
                    tracking below is the better answer. */}
                {shipBy && !order.tracking && (
                    <div className="glass rounded-2xl border border-white/10 p-5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{L.shipBy}</p>
                        <p className="text-sm font-bold text-white">{shipBy}</p>
                        <p className="text-[11px] text-slate-500 mt-1">{L.shipByHint}</p>
                    </div>
                )}

                {/* Tracking */}
                {order.tracking ? (
                    <div className="glass rounded-2xl border border-white/10 p-5 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{L.tracking}</p>
                            <p className="font-mono text-sm text-white truncate">{order.tracking.number}</p>
                        </div>
                        {order.tracking.url && (
                            <a
                                href={order.tracking.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 text-brand-cyan font-black uppercase text-[10px] tracking-widest hover:underline"
                            >
                                {L.track} ↗
                            </a>
                        )}
                    </div>
                ) : (
                    // Placeholder rather than nothing. An absent tracking block
                    // reads as "this order has no tracking"; a waiting one says
                    // the number is coming and where it will appear.
                    <div className="glass rounded-2xl border border-dashed border-white/10 p-5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{L.tracking}</p>
                        <p className="text-sm text-slate-400">{L.trackingPending}</p>
                    </div>
                )}

                {/* Actions */}
                <div className="space-y-3">
                    {/* Live-break spot orders have no per-order label — the
                        parcel is consolidated at stream settle, so the print
                        button is replaced by a passive notice. */}
                    {order.isBreakOrder && (
                        <div className="w-full text-center glass border border-brand-cyan/20 bg-brand-cyan/5 text-brand-cyan font-bold uppercase tracking-wider text-xs py-3 rounded-xl">
                            <i className="fa-solid fa-box-open mr-2"></i>
                            {L.breakParcel}
                        </div>
                    )}
                    {isSeller && !order.isBreakOrder && SHIPPABLE.has(order.status) && (
                        <button
                            onClick={openLabel}
                            disabled={labelBusy}
                            className="w-full bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider py-3.5 rounded-xl active:scale-[0.98] transition-all disabled:opacity-60"
                        >
                            <i className="fa-solid fa-print mr-2"></i>
                            {labelBusy ? L.preparing : L.printLabel}
                        </button>
                    )}
                    {labelError && <p className="text-xs text-rose-300 text-center">{labelError}</p>}
                    <Link
                        href="/orders"
                        className="block w-full text-center glass border border-white/10 text-slate-200 font-bold uppercase tracking-wider text-sm py-3 rounded-xl active:scale-[0.98] transition-all"
                    >
                        {L.viewAll}
                    </Link>
                </div>
            </div>
        </div>
    );
}
