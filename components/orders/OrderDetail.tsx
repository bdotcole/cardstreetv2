'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { formatTHB } from '@/lib/currency';
import { cardAddedToCollection, canReportOrder, canReviewOrder, shipByDate } from '@/lib/orderDisputes';
import { CHAT_OPEN_EVENT, type ChatOpenDetail } from '@/lib/chat';
import ReviewSheet, { type OrderReview } from '@/components/ReviewSheet';
import ReportProblemSheet from '@/components/ReportProblemSheet';
import AuthModal from '@/components/AuthModal';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';

export type OrderRole = 'seller' | 'buyer';

/**
 * The other party, from the public_profiles view (lib/publicProfiles): the
 * shop a buyer bought from, or the buyer a seller is packing for. Display
 * data only, never phone or address.
 */
export interface OrderCounterpart {
    id: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
}

export interface OrderDetailData {
    id: string;
    status: string;
    totalAmount: number;
    platformFee: number;
    // Collector Pass voucher taken off the buyer's charge. It is funded from
    // the platform fee and platformFee arrives already reduced by it, so the
    // seller's fee is platformFee + discountAmount and their payout is the
    // same as on a plain sale (lib/orderGroups sellerFeeOf).
    discountAmount?: number;
    shippingFee: number;
    createdAt: string;
    completedAt: string | null;
    deliveredAt?: string | null;
    // Set by nothing today (the column predates the Flash integration), read
    // so the timeline dates the Shipped step the day something starts to.
    shippedAt?: string | null;
    // Buyer-side: the buyer's own review of this order, and the open report.
    review?: OrderReview | null;
    disputeReason?: string | null;
    disputeOutcome?: string | null;
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
    // `carrier` is set when the seller shipped outside our Flash waybill
    // (lib/parcels handOffParcel): then `number` is whatever that carrier
    // gave them, possibly nothing, and there is no tracking link.
    tracking: { number: string | null; url: string | null; carrier: string | null } | null;
    // A label row exists: the parcel may have left even if no Flash scan
    // ever moved the status, so the buyer can confirm receipt from
    // label_generated.
    hasLabel?: boolean;
    counterpart?: OrderCounterpart | null;
}

/**
 * 'standalone' is the phone page at /orders/<id>: one column, its own dark
 * shell, a sticky way back into the shop because there is no tab bar.
 * 'desktop' renders inside the desktop shell (nav, cart, messages) with a
 * breadcrumb, a progress line and a two-column layout; the middleware sends
 * desktop browsers to app/desktop/orders/[id], which passes it.
 */
export type OrderDetailVariant = 'standalone' | 'desktop';

interface Props {
    order?: OrderDetailData;
    role?: OrderRole;
    orderId: string;
    signedOut?: boolean;
    variant?: OrderDetailVariant;
}

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

// Statuses where a seller can still pull the shipping label. A 'paid' order
// has no label yet: the seller creates it from the shipments tab, where they
// also choose which of the buyer's orders share the parcel.
const SHIPPABLE = new Set(['label_generated', 'processing', 'shipped', 'out_for_delivery']);

// How far along the order is, for the desktop progress line. The four steps
// are what a buyer waits for; the finer backend states (label printed, in
// transit, out for delivery) read as the step they belong to, with the exact
// state in the badge beside the title.
const STEP_RANK: Record<string, number> = {
    pending: 0,
    pending_payment: 0,
    payment_confirming: 0,
    paid: 1,
    label_generated: 1,
    processing: 1,
    shipped: 2,
    in_transit: 2,
    out_for_delivery: 2,
    delivered: 3,
    completed: 4,
};

const STRINGS = {
    en: {
        order: 'Order', orders: 'Orders', placed: 'Placed', item: 'Item', shipping: 'Shipping', fee: 'Platform fee', payout: 'Your payout', total: 'Total', voucher: 'Voucher discount', included: 'Included', summary: 'Summary',
        tracking: 'Tracking', track: 'Track parcel', printLabel: 'Print shipping label', preparing: 'Preparing…', viewAll: 'View all orders', graded: 'Graded', liveBreakSpot: 'Live break spot', breakParcel: 'Ships with the break parcel after the show',
        shipBy: 'Seller ships by', shipByHint: 'Flash Express, 1-3 days to your door once collected.', trackingPending: 'Appears here as soon as the seller prints the label.',
        confirmDelivery: 'Confirm I received it', confirming: 'Confirming…', shippedVia: 'Shipped via', anotherCarrier: 'another carrier', noNumber: 'No tracking number given', receivedEarly: 'Already have it? Confirm receipt',
        soldBy: 'Sold by', buyer: 'Buyer', messageSeller: 'Message seller', messageBuyer: 'Message buyer', viewShop: 'View shop',
        stepPaid: 'Paid', stepShipped: 'Shipped', stepDelivered: 'Delivered', stepCompleted: 'Completed', stepAwaiting: 'Awaiting payment', stepConfirming: 'Confirming payment', stepPreparing: 'Label printed, packing', stepShipsBy: 'Ships by',
        signInTitle: 'Sign in to view this order', signInBody: 'This order is private. Sign in to your Cardstreet account, then reopen this link.', signIn: 'Sign in', goHome: 'Go to Cardstreet',
    },
    th: {
        order: 'คำสั่งซื้อ', orders: 'คำสั่งซื้อ', placed: 'สั่งซื้อเมื่อ', item: 'สินค้า', shipping: 'ค่าจัดส่ง', fee: 'ค่าธรรมเนียม', payout: 'ยอดที่คุณจะได้รับ', total: 'ยอดรวม', voucher: 'ส่วนลดคูปอง', included: 'รวมในราคาแล้ว', summary: 'สรุปยอด',
        tracking: 'เลขพัสดุ', track: 'ติดตามพัสดุ', printLabel: 'พิมพ์ใบปะหน้าพัสดุ', preparing: 'กำลังเตรียม…', viewAll: 'ดูคำสั่งซื้อทั้งหมด', graded: 'จัดเกรด', liveBreakSpot: 'สปอตไลฟ์เบรก', breakParcel: 'จัดส่งรวมกับพัสดุเบรกหลังจบไลฟ์',
        shipBy: 'ผู้ขายจะจัดส่งภายใน', shipByHint: 'จัดส่งโดย Flash Express ถึงมือคุณใน 1-3 วัน', trackingPending: 'จะแสดงเลขพัสดุที่นี่ทันทีที่ผู้ขายพิมพ์ใบปะหน้า',
        confirmDelivery: 'ยืนยันว่าได้รับพัสดุแล้ว', confirming: 'กำลังยืนยัน…', shippedVia: 'ผู้ขายส่งผ่าน', anotherCarrier: 'ขนส่งอื่น', noNumber: 'ผู้ขายไม่ได้ระบุเลขพัสดุ', receivedEarly: 'ได้รับของแล้ว? กดยืนยันรับสินค้า',
        soldBy: 'ขายโดย', buyer: 'ผู้ซื้อ', messageSeller: 'ส่งข้อความหาผู้ขาย', messageBuyer: 'ส่งข้อความหาผู้ซื้อ', viewShop: 'ดูร้านค้า',
        stepPaid: 'ชำระแล้ว', stepShipped: 'จัดส่งแล้ว', stepDelivered: 'ถึงมือคุณ', stepCompleted: 'เสร็จสมบูรณ์', stepAwaiting: 'รอการชำระเงิน', stepConfirming: 'กำลังยืนยันการชำระเงิน', stepPreparing: 'พิมพ์ใบปะหน้าแล้ว กำลังแพ็ค', stepShipsBy: 'จัดส่งภายใน',
        signInTitle: 'เข้าสู่ระบบเพื่อดูคำสั่งซื้อนี้', signInBody: 'คำสั่งซื้อนี้เป็นข้อมูลส่วนตัว กรุณาเข้าสู่ระบบด้วยบัญชี Cardstreet ของคุณ แล้วเปิดลิงก์นี้อีกครั้ง', signIn: 'เข้าสู่ระบบ', goHome: 'ไปที่ Cardstreet',
    },
};
type Strings = typeof STRINGS.en;

const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest text-slate-500';
const PANEL = 'glass rounded-2xl border border-white/10';
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60';
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60';
const BTN_OUTLINE_CYAN = 'inline-flex items-center justify-center gap-2 border border-brand-cyan/30 text-brand-cyan hover:bg-brand-cyan/10 text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60';
const BTN_OUTLINE_AMBER = 'inline-flex items-center justify-center gap-2 border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60';

const shellClass = 'min-h-screen bg-brand-darker text-white p-6 pb-24';

function StatusBadge({ tone, label }: { tone: string; label: string }) {
    return (
        <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded border shrink-0 ${tone}`}>
            {label}
        </span>
    );
}

function Stars({ rating }: { rating: number }) {
    return (
        <span className="text-amber-400 text-sm" aria-label={`${rating}/5`}>
            {'★'.repeat(rating)}<span className="text-slate-700">{'★'.repeat(5 - rating)}</span>
        </span>
    );
}

/**
 * The desktop progress line: Paid, Shipped, Delivered, Completed. Hidden for
 * cancelled and disputed orders, whose notice says what happened instead.
 */
function Timeline({ steps, current }: {
    steps: { label: string; detail: string | null }[];
    current: number;
}) {
    return (
        <ol className={`${PANEL} px-5 py-4 grid grid-cols-4 gap-3`} aria-label="Order progress">
            {steps.map((step, i) => {
                const rank = i + 1;
                const done = rank <= current;
                const active = rank === current + 1;
                return (
                    <li key={step.label} className="min-w-0">
                        <div className="flex items-center">
                            <span
                                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[11px] font-black shrink-0 ${
                                    done
                                        ? 'bg-brand-cyan border-brand-cyan text-brand-darker'
                                        : active
                                            ? 'border-brand-cyan text-brand-cyan'
                                            : 'border-white/15 text-slate-600'
                                }`}
                            >
                                {done ? <i className="fa-solid fa-check" aria-hidden="true"></i> : rank}
                            </span>
                            {i < steps.length - 1 && (
                                <span className={`flex-1 h-0.5 mx-2 rounded ${done ? 'bg-brand-cyan' : 'bg-white/10'}`}></span>
                            )}
                        </div>
                        <p className={`mt-2 text-xs font-black uppercase tracking-wider ${done || active ? 'text-white' : 'text-slate-500'}`}>{step.label}</p>
                        {step.detail && <p className="text-[11px] text-slate-400 truncate mt-0.5">{step.detail}</p>}
                    </li>
                );
            })}
        </ol>
    );
}

/**
 * Signed-out state inside the desktop shell: opens the auth modal here and
 * re-renders the page once a session exists, instead of sending the visitor
 * to the homepage to find the sign-in button.
 */
function DesktopSignedOut({ L }: { L: Strings }) {
    const { user } = useDesktopCart();
    const router = useRouter();
    const [authOpen, setAuthOpen] = useState(false);
    // Once: the refreshed server render replaces this component with the
    // order, and a second refresh while the first is in flight would loop.
    const refreshed = useRef(false);
    useEffect(() => {
        if (!user || refreshed.current) return;
        refreshed.current = true;
        router.refresh();
    }, [user, router]);
    return (
        <div className="max-w-md mx-auto py-16 text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-brand-cyan">
                <i className="fa-solid fa-lock text-lg"></i>
            </div>
            <h1 className="text-xl font-black text-white">{L.signInTitle}</h1>
            <p className="text-sm text-slate-400">{L.signInBody}</p>
            <button onClick={() => setAuthOpen(true)} className={BTN_PRIMARY}>{L.signIn}</button>
            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        </div>
    );
}

export default function OrderDetail({ order, role, orderId, signedOut, variant = 'standalone' }: Props) {
    const { isThai, t } = useTranslation();
    const router = useRouter();
    const desktop = variant === 'desktop';
    const [labelBusy, setLabelBusy] = useState(false);
    const [labelError, setLabelError] = useState<string | null>(null);
    // Buyer actions on the order page: confirm delivery, review the seller,
    // report a problem. The review is kept locally after saving so the page
    // reflects it without a round trip.
    const [review, setReview] = useState<OrderReview | null>(order?.review ?? null);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [reported, setReported] = useState(false);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    // Read in an effect, not during render: this page is server-rendered and a
    // window read at render time would not match on hydration.
    const [confirming, setConfirming] = useState(false);
    useEffect(() => {
        try {
            setConfirming(new URLSearchParams(window.location.search).get('confirming') === '1');
        } catch { /* no query string — the real status stands */ }
    }, []);

    const L = STRINGS[isThai ? 'th' : 'en'];

    if (signedOut || !order) {
        if (desktop) return <DesktopSignedOut L={L} />;
        return (
            <div className={shellClass}>
                <div className="max-w-md mx-auto pt-16 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl glass border border-white/10 flex items-center justify-center mx-auto text-brand-cyan">
                        <i className="fa-solid fa-lock text-lg"></i>
                    </div>
                    <h1 className="text-xl font-black">{L.signInTitle}</h1>
                    <p className="text-sm text-slate-400">{L.signInBody}</p>
                    <Link
                        href="/"
                        className="inline-block bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider px-6 py-3 rounded-xl active:scale-[0.98] transition-all"
                    >
                        {L.goHome}
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
    const statusLabel = isThai ? st.th : st.en;
    const shortId = order.id.slice(0, 8).toUpperCase();
    const isSeller = role === 'seller';
    const isBuyer = role === 'buyer';
    const discount = order.discountAmount ?? 0;
    const sellerFee = order.platformFee + discount;
    const payout = order.totalAmount - sellerFee;
    const buyerTotal = order.totalAmount + order.shippingFee - discount;
    const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(isThai ? 'th-TH' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    const fmtDay = (d: Date) => d.toLocaleDateString(isThai ? 'th-TH' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    // "Seller ships by <date>": the handling promise the card page's JSON-LD
    // already publishes, so the two cannot disagree. Nothing to promise before
    // payment or after a cancellation.
    const shipByDay = ['pending', 'pending_payment', 'cancelled'].includes(order.status) ? null : shipByDate(order.createdAt);
    const shipBy = shipByDay ? fmtDay(shipByDay) : null;

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

    // Labels are created where the seller can also combine this buyer's other
    // orders into the same parcel. Phones get the SPA's Pending Shipments card
    // for this order (the ?order= contract in MobileHome); desktop gets the
    // To ship tab. Same UA test as middleware.ts isDesktopClient.
    const goCreateLabel = () => {
        const isPhone = !desktop && /Android|iPhone|iPod|iPad|Mobile|Mobi/i.test(navigator.userAgent);
        router.push(isPhone ? `/?order=${orderId}` : '/orders?tab=shipments');
    };

    // The Messages dialog lives in the desktop nav (DesktopChatHost); the
    // standalone page has no host for it, so the button is desktop-only.
    const counterpart = order.counterpart ?? null;
    const counterpartName = counterpart?.displayName || counterpart?.username || null;
    const openChat = () => {
        if (!counterpart) return;
        const detail: ChatOpenDetail = {
            user: { id: counterpart.id, username: counterpart.username, display_name: counterpart.displayName, avatar_url: counterpart.avatarUrl },
            noShop: isSeller,
        };
        window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail }));
    };

    const effectiveForActions = reported ? 'disputed' : order.status;
    const showConfirm = isBuyer && ['shipped', 'out_for_delivery', 'delivered'].includes(effectiveForActions);
    // Labelled but never scanned: a parcel that left outside our waybill
    // arrives without the status moving (/api/orders/complete accepts this).
    const showConfirmEarly = isBuyer && effectiveForActions === 'label_generated' && !!order.hasLabel;
    const showReview = isBuyer && canReviewOrder({ status: effectiveForActions });
    const showReport = isBuyer && effectiveForActions !== 'disputed'
        && canReportOrder({ status: effectiveForActions, delivered_at: order.deliveredAt ?? null, completed_at: order.completedAt });
    const isDisputed = effectiveForActions === 'disputed';
    const isCancelled = effectiveForActions === 'cancelled';
    const showInCollection = isBuyer && cardAddedToCollection(effectiveForActions, !!order.isBreakOrder);
    // PromptPay: paid in the banking app, the webhook has not landed, so the
    // card is not in the collection yet and the page must not claim it is.
    const showCollectionPending = isBuyer && !order.isBreakOrder && effectiveStatus === 'payment_confirming';
    // Pushing more shopping is right for a buyer whose purchase went through, and
    // wrong on a dispute, a cancellation, or while a delivery waits on their tap.
    const promoteShopping = !showConfirm && (showInCollection || showCollectionPending);
    const showPrintLabel = isSeller && !order.isBreakOrder && SHIPPABLE.has(order.status);
    const showCreateLabel = isSeller && !order.isBreakOrder && order.status === 'paid';

    const confirmDelivery = async () => {
        if (confirmBusy) return;
        setConfirmBusy(true);
        setActionError(null);
        try {
            const res = await fetch('/api/orders/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ orderId }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
            // Completed now; the review prompt opens straight away.
            setReviewOpen(true);
            router.refresh();
        } catch (e: any) {
            setActionError(e?.message || 'Network error');
        } finally {
            setConfirmBusy(false);
        }
    };

    // ----- Pieces shared by both layouts -----

    const chips = (
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
    );

    const cardImage = (sizeClass: string) => (
        <span className={`${sizeClass} rounded-lg bg-brand-darker overflow-hidden shrink-0 border border-white/10`}>
            {order.card.imageSmall && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getThumbnailUrl(order.card.imageSmall)} alt="" loading="lazy" className="w-full h-full object-cover" />
            )}
        </span>
    );

    const moneyRows = (
        <>
            <div className="flex justify-between">
                <span className="text-slate-400">{L.item}</span>
                <span className="font-bold">{formatTHB(order.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
                <span className="text-slate-400">{L.shipping}</span>
                {/* Shipping has been inside the price since 2026-09-27; a bare
                    ฿0 line read as a missing charge. */}
                <span className={order.shippingFee > 0 ? 'font-bold' : 'text-xs font-bold text-slate-400 self-center'}>
                    {order.shippingFee > 0 ? formatTHB(order.shippingFee) : L.included}
                </span>
            </div>
            {isSeller ? (
                <>
                    <div className="flex justify-between">
                        <span className="text-slate-400">{L.fee}</span>
                        <span className="font-bold text-rose-300">- {formatTHB(sellerFee)}</span>
                    </div>
                    <div className="flex justify-between pt-3 border-t border-white/10">
                        <span className="font-black uppercase tracking-wider text-[11px] text-slate-300 self-center">{L.payout}</span>
                        <span className="text-xl font-black text-emerald-300">{formatTHB(payout)}</span>
                    </div>
                </>
            ) : (
                <>
                    {discount > 0 && (
                        <div className="flex justify-between">
                            <span className="text-slate-400">{L.voucher}</span>
                            <span className="font-bold text-amber-300">- {formatTHB(discount)}</span>
                        </div>
                    )}
                    <div className="flex justify-between pt-3 border-t border-white/10">
                        <span className="font-black uppercase tracking-wider text-[11px] text-slate-300 self-center">{L.total}</span>
                        <span className="text-xl font-black text-brand-cyan">{formatTHB(buyerTotal)}</span>
                    </div>
                </>
            )}
        </>
    );

    const trackingHeading = order.tracking?.carrier ? `${L.shippedVia} ${order.tracking.carrier}` : L.tracking;

    const disputeNotice = isDisputed && (
        <div className={`${PANEL} border-brand-red/30 bg-brand-red/5 p-4 text-sm text-rose-200`}>
            <p className="font-bold">{t('orderActions.disputeOpen')}</p>
            <p className="text-[11px] text-rose-200/70 mt-1">{t('orderActions.guarantee')}</p>
        </div>
    );

    const breakNotice = order.isBreakOrder && (
        <div className="w-full text-center glass border border-brand-cyan/20 bg-brand-cyan/5 text-brand-cyan font-bold uppercase tracking-wider text-xs py-3 rounded-xl">
            <i className="fa-solid fa-box-open mr-2"></i>
            {L.breakParcel}
        </div>
    );

    const reviewRow = showReview && (
        review ? (
            <div className={`${PANEL} p-4 flex items-center justify-between gap-3`}>
                <div>
                    <p className={EYEBROW}>{t('orderActions.yourReview')}</p>
                    <div className="mt-1"><Stars rating={review.rating} /></div>
                </div>
                <button onClick={() => setReviewOpen(true)} className="text-brand-cyan font-black uppercase text-[10px] tracking-widest hover:underline">
                    {t('orderActions.editReview')}
                </button>
            </div>
        ) : (
            <button
                onClick={() => setReviewOpen(true)}
                className={desktop
                    ? `${BTN_OUTLINE_AMBER} w-full`
                    : 'w-full glass border border-amber-500/30 text-amber-300 font-bold uppercase tracking-wider text-sm py-3 rounded-xl active:scale-[0.98] transition-all'}
            >
                <i className="fa-solid fa-star mr-2"></i>{t('orderActions.reviewSeller')}
            </button>
        )
    );

    const reportLink = showReport && (
        <button
            onClick={() => setReportOpen(true)}
            className="w-full text-center text-slate-400 hover:text-rose-300 text-xs font-bold uppercase tracking-wider py-2 transition-colors"
        >
            {t('orderActions.reportProblem')}
        </button>
    );

    const sheets = (
        <>
            {reviewOpen && (
                <ReviewSheet
                    orderId={orderId}
                    initial={review}
                    onClose={() => setReviewOpen(false)}
                    onSaved={(r) => { setReview(r); setReviewOpen(false); }}
                />
            )}
            {reportOpen && (
                <ReportProblemSheet
                    orderId={orderId}
                    onClose={() => setReportOpen(false)}
                    onReported={() => { setReported(true); setReportOpen(false); router.refresh(); }}
                />
            )}
        </>
    );

    // ----- Desktop layout -----

    if (desktop) {
        const current = STEP_RANK[effectiveStatus] ?? 0;
        const paidDetail = current >= 1
            ? fmtDate(order.createdAt)
            : effectiveStatus === 'payment_confirming' ? L.stepConfirming : L.stepAwaiting;
        const shippedDetail = current >= 2
            ? (order.shippedAt ? fmtDate(order.shippedAt) : order.tracking?.number ?? null)
            : current === 1
                ? (order.status === 'label_generated' ? L.stepPreparing : shipBy ? `${L.stepShipsBy} ${shipBy}` : null)
                : null;
        const steps = [
            { label: L.stepPaid, detail: paidDetail },
            { label: L.stepShipped, detail: shippedDetail },
            { label: L.stepDelivered, detail: current >= 3 && order.deliveredAt ? fmtDate(order.deliveredAt) : null },
            { label: L.stepCompleted, detail: current >= 4 && order.completedAt ? fmtDate(order.completedAt) : null },
        ];

        // One primary action beside the title: what this person should do next.
        const primary = showPrintLabel ? (
            <button onClick={openLabel} disabled={labelBusy} className={BTN_PRIMARY}>
                <i className="fa-solid fa-print"></i>
                {labelBusy ? L.preparing : L.printLabel}
            </button>
        ) : showCreateLabel ? (
            <button onClick={goCreateLabel} className={BTN_PRIMARY}>
                <i className="fa-solid fa-print"></i>
                {t('parcel.createLabel')}
            </button>
        ) : showConfirm ? (
            <button onClick={confirmDelivery} disabled={confirmBusy} className={BTN_PRIMARY}>
                <i className="fa-solid fa-check"></i>
                {confirmBusy ? L.confirming : L.confirmDelivery}
            </button>
        ) : isBuyer && promoteShopping ? (
            <Link href="/?tab=marketplace" className={BTN_PRIMARY}>
                {t('orderActions.keepShopping')}
            </Link>
        ) : null;

        return (
            <div className="max-w-5xl mx-auto">
                <nav className="flex items-center gap-2 text-xs text-slate-500" aria-label="Breadcrumb">
                    <Link href="/orders" className="hover:text-white transition-colors">{L.orders}</Link>
                    <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true"></i>
                    <span className="font-mono text-slate-300">#{shortId}</span>
                </nav>

                <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-2xl font-black text-white">{L.order} #{shortId}</h1>
                            <StatusBadge tone={st.tone} label={statusLabel} />
                        </div>
                        <p className="text-sm text-slate-400 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{L.placed} {fmtDate(order.createdAt)}</span>
                            {counterpartName && (
                                <>
                                    <span className="text-slate-600" aria-hidden="true">·</span>
                                    <span className="inline-flex items-center gap-1.5">
                                        {isBuyer ? L.soldBy : L.buyer}
                                        {counterpart?.avatarUrl && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={counterpart.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover border border-white/10" />
                                        )}
                                        {isBuyer && counterpart?.username ? (
                                            <Link href={`/seller/${counterpart.username}`} className="font-bold text-white hover:text-brand-cyan transition-colors">{counterpartName}</Link>
                                        ) : (
                                            <span className="font-bold text-white">{counterpartName}</span>
                                        )}
                                    </span>
                                </>
                            )}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {counterpart && (
                            <button type="button" onClick={openChat} className={BTN_SECONDARY}>
                                <i className="fa-regular fa-comment-dots"></i>
                                {isBuyer ? L.messageSeller : L.messageBuyer}
                            </button>
                        )}
                        {primary}
                    </div>
                </header>
                {labelError && <p className="text-xs text-rose-300 mt-2 text-right">{labelError}</p>}
                {actionError && <p className="text-xs text-rose-300 mt-2 text-right">{actionError}</p>}

                <div className="mt-6">
                    {isDisputed ? disputeNotice : !isCancelled && <Timeline steps={steps} current={current} />}
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
                    <div className="space-y-4 min-w-0">
                        {/* The item */}
                        <section className={`${PANEL} p-5`}>
                            <p className={EYEBROW}>{L.item}</p>
                            <div className="flex gap-5 mt-3">
                                {cardImage('w-24 h-[134px] rounded-xl')}
                                <div className="min-w-0 flex-1">
                                    <p className="text-lg font-black text-white leading-tight">{order.card.name || (order.isBreakOrder ? L.liveBreakSpot : '')}</p>
                                    {order.card.set && <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wide mt-1">{order.card.set}</p>}
                                    {chips}
                                    <p className="text-xl font-black text-white mt-4">{formatTHB(order.totalAmount)}</p>
                                </div>
                            </div>
                        </section>

                        {/* Shipping: the tracking number once there is one, the
                            seller's handling promise before that. */}
                        {breakNotice}
                        {order.tracking ? (
                            <section className={`${PANEL} p-5 flex flex-wrap items-center justify-between gap-4`}>
                                <div className="min-w-0">
                                    <p className={EYEBROW}>{trackingHeading}</p>
                                    {order.tracking.number
                                        ? <p className="font-mono text-lg text-white mt-1 truncate">{order.tracking.number}</p>
                                        : <p className="text-sm text-slate-400 mt-1">{L.noNumber}</p>}
                                </div>
                                {order.tracking.url && (
                                    <a href={order.tracking.url} target="_blank" rel="noopener noreferrer" className={BTN_OUTLINE_CYAN}>
                                        {L.track}
                                        <i className="fa-solid fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i>
                                    </a>
                                )}
                            </section>
                        ) : shipBy && !order.isBreakOrder && !isCancelled && !isDisputed ? (
                            <section className={`${PANEL} p-5 flex flex-wrap items-center justify-between gap-4`}>
                                <div>
                                    <p className={EYEBROW}>{L.shipBy}</p>
                                    <p className="text-lg font-black text-white mt-1">{shipBy}</p>
                                    <p className="text-[11px] text-slate-500 mt-1">{L.shipByHint}</p>
                                </div>
                                <div className="text-right max-w-[260px]">
                                    <p className={EYEBROW}>{L.tracking}</p>
                                    <p className="text-xs text-slate-400 mt-1">{L.trackingPending}</p>
                                </div>
                            </section>
                        ) : null}

                        {/* Fulfilment already put the card in the buyer's
                            collection; without this row nothing says so. */}
                        {showInCollection && (
                            <Link
                                href="/collection"
                                className={`${PANEL} border-emerald-500/20 p-4 flex items-center justify-between gap-4 hover:border-emerald-500/40 hover:bg-white/[0.07] transition-colors`}
                            >
                                <span className="min-w-0">
                                    <span className="block text-sm font-bold text-white">
                                        <i className="fa-solid fa-circle-check text-emerald-300 mr-2"></i>
                                        {t('orderActions.addedToCollection')}
                                    </span>
                                    <span className="block text-[11px] text-slate-500 mt-1">{t('orderActions.addedToCollectionHint')}</span>
                                </span>
                                <span className="text-xs font-bold text-brand-cyan shrink-0">
                                    {t('orderActions.viewCollection')} <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true"></i>
                                </span>
                            </Link>
                        )}
                        {showCollectionPending && (
                            <div className={`${PANEL} border-dashed p-4`}>
                                <p className="text-[11px] text-slate-400">{t('orderActions.collectionAfterPayment')}</p>
                            </div>
                        )}
                    </div>

                    <aside className="space-y-4">
                        <section className={`${PANEL} p-5 space-y-3 text-sm`}>
                            <p className={`${EYEBROW} !mb-1`}>{L.summary}</p>
                            {moneyRows}
                        </section>

                        {(showConfirmEarly || showReview || showReport || isBuyer) && (
                            <section className="space-y-3">
                                {showConfirmEarly && (
                                    <button onClick={confirmDelivery} disabled={confirmBusy} className={`${BTN_OUTLINE_CYAN} w-full`}>
                                        {confirmBusy ? L.confirming : L.receivedEarly}
                                    </button>
                                )}
                                {reviewRow}
                                {reportLink}
                                {isBuyer && !isDisputed && (
                                    <p className="text-[11px] text-slate-500 text-center leading-relaxed">{t('orderActions.guarantee')}</p>
                                )}
                            </section>
                        )}

                        <div className="flex flex-col gap-2">
                            {isBuyer && !(promoteShopping && !showConfirm) && (
                                <Link href="/?tab=marketplace" className={`${BTN_SECONDARY} w-full`}>{t('orderActions.keepShopping')}</Link>
                            )}
                            <Link href="/orders" className="text-center text-xs font-bold text-slate-400 hover:text-white py-2 transition-colors">{L.viewAll}</Link>
                        </div>
                    </aside>
                </div>

                {sheets}
            </div>
        );
    }

    // ----- Standalone (phone) layout -----

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
                    <StatusBadge tone={st.tone} label={statusLabel} />
                </div>

                {/* Card */}
                <div className={`${PANEL} p-4 flex items-center gap-4`}>
                    {cardImage('w-16 h-[88px]')}
                    <div className="min-w-0">
                        <p className="font-bold text-white truncate">{order.card.name || (order.isBreakOrder ? L.liveBreakSpot : '')}</p>
                        {order.card.set && <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate">{order.card.set}</p>}
                        {chips}
                    </div>
                </div>

                {/* Fulfilment already put the card in the buyer's collection;
                    without this row nothing on the page says so. */}
                {showInCollection && (
                    <Link
                        href="/collection"
                        className={`${PANEL} border-emerald-500/20 p-4 flex items-center justify-between gap-4 active:scale-[0.98] transition-all`}
                    >
                        <span className="min-w-0">
                            <span className="block text-sm font-bold text-white">
                                <i className="fa-solid fa-circle-check text-emerald-300 mr-2"></i>
                                {t('orderActions.addedToCollection')}
                            </span>
                            <span className="block text-[11px] text-slate-500 mt-1">{t('orderActions.addedToCollectionHint')}</span>
                        </span>
                        <i className="fa-solid fa-chevron-right text-brand-cyan text-xs shrink-0" aria-hidden="true"></i>
                    </Link>
                )}
                {showCollectionPending && (
                    <div className={`${PANEL} border-dashed p-4`}>
                        <p className="text-[11px] text-slate-400">{t('orderActions.collectionAfterPayment')}</p>
                    </div>
                )}

                {/* Money */}
                <div className={`${PANEL} p-5 space-y-3 text-sm`}>
                    {moneyRows}
                </div>

                {/* Ship-by date. A buyer who has just paid wants one thing: when
                    does it move. Hidden once it has actually shipped, when the
                    tracking below is the better answer. */}
                {shipBy && !order.tracking && (
                    <div className={`${PANEL} p-5`}>
                        <p className={`${EYEBROW} mb-1`}>{L.shipBy}</p>
                        <p className="text-sm font-bold text-white">{shipBy}</p>
                        <p className="text-[11px] text-slate-500 mt-1">{L.shipByHint}</p>
                    </div>
                )}

                {/* Tracking */}
                {order.tracking ? (
                    <div className={`${PANEL} p-5 flex items-center justify-between gap-4`}>
                        <div className="min-w-0">
                            <p className={`${EYEBROW} mb-1`}>{trackingHeading}</p>
                            {order.tracking.number
                                ? <p className="font-mono text-sm text-white truncate">{order.tracking.number}</p>
                                : <p className="text-sm text-slate-400">{L.noNumber}</p>}
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
                    <div className={`${PANEL} border-dashed p-5`}>
                        <p className={`${EYEBROW} mb-1`}>{L.tracking}</p>
                        <p className="text-sm text-slate-400">{L.trackingPending}</p>
                    </div>
                )}

                {/* Actions */}
                <div className="space-y-3">
                    {breakNotice}
                    {showPrintLabel && (
                        <button
                            onClick={openLabel}
                            disabled={labelBusy}
                            className="w-full bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider py-3.5 rounded-xl active:scale-[0.98] transition-all disabled:opacity-60"
                        >
                            <i className="fa-solid fa-print mr-2"></i>
                            {labelBusy ? L.preparing : L.printLabel}
                        </button>
                    )}
                    {showCreateLabel && (
                        <button
                            onClick={goCreateLabel}
                            className="w-full bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider py-3.5 rounded-xl active:scale-[0.98] transition-all"
                        >
                            <i className="fa-solid fa-print mr-2"></i>
                            {t('parcel.createLabel')}
                        </button>
                    )}
                    {labelError && <p className="text-xs text-rose-300 text-center">{labelError}</p>}

                    {/* Buyer: confirm, review, report. The report window and the
                        review gate live in lib/orderDisputes so this page, the
                        mobile Track Orders panel, and desktop Orders agree. */}
                    {disputeNotice}
                    {showConfirm && (
                        <button
                            onClick={confirmDelivery}
                            disabled={confirmBusy}
                            className="w-full bg-brand-cyan text-brand-darker font-black uppercase tracking-wider py-3.5 rounded-xl active:scale-[0.98] transition-all disabled:opacity-60"
                        >
                            {confirmBusy ? L.confirming : L.confirmDelivery}
                        </button>
                    )}
                    {showConfirmEarly && (
                        <button
                            onClick={confirmDelivery}
                            disabled={confirmBusy}
                            className="w-full glass border border-brand-cyan/30 text-brand-cyan font-bold uppercase tracking-wider text-sm py-3 rounded-xl active:scale-[0.98] transition-all disabled:opacity-60"
                        >
                            {confirmBusy ? L.confirming : L.receivedEarly}
                        </button>
                    )}
                    {reviewRow}
                    {reportLink}
                    {isBuyer && !isDisputed && (
                        <p className="text-[11px] text-slate-500 text-center">{t('orderActions.guarantee')}</p>
                    )}
                    {actionError && <p className="text-xs text-rose-300 text-center">{actionError}</p>}
                </div>

                {/* The way back into the shop: this page sits outside the app
                    shell, so it has no tab bar. Sticky, and so a sibling of the
                    actions rather than inside them, because the page is taller
                    than a phone and a buyer who has just paid should not have to
                    scroll to find it. */}
                {isBuyer && (
                    <Link
                        href="/?tab=marketplace"
                        className={promoteShopping
                            ? 'block w-full text-center sticky bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] z-10 shadow-lg shadow-black/40 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black uppercase tracking-wider py-3.5 rounded-xl active:scale-[0.98] transition-all'
                            : 'block w-full text-center glass border border-white/10 text-slate-200 font-bold uppercase tracking-wider text-sm py-3 rounded-xl active:scale-[0.98] transition-all'}
                    >
                        {t('orderActions.keepShopping')}
                    </Link>
                )}
                <Link
                    href="/orders"
                    className="block w-full !mt-3 text-center glass border border-white/10 text-slate-200 font-bold uppercase tracking-wider text-sm py-3 rounded-xl active:scale-[0.98] transition-all"
                >
                    {L.viewAll}
                </Link>
            </div>

            {sheets}
        </div>
    );
}
