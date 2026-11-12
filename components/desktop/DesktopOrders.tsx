'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getThumbnailUrl } from '@/lib/imageUtils';
import OrderCardMeta from '@/components/OrderCardMeta';
import { CHAT_OPEN_EVENT, type ChatOpenDetail } from '@/lib/chat';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import AuthModal from '@/components/AuthModal';
import OffersInbox from '@/components/OffersInbox';
import type { Offer } from '@/types';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { formatTHB } from '@/components/desktop/DesktopMarketplace';
import { groupByTransferGroup, groupByParcel, countCheckouts, isAwaitingLabel, isUnscannedParcel, isPickupCancelled, isHandoffable, hasShippingLabel, handoffOf, parcelsByBuyer, isRealWaybill, sellerFeeOf, sellerNetOf, buyerPaidOf, type ShipMethod } from '@/lib/orderGroups';
import { ShipMethodSheet, ParcelHandoffNote, ShippedElsewhereSheet, HandoffSummary, type PickupInfo, type RecipientInfo } from '@/components/ParcelHandoff';
import { useOfferBadge } from '@/lib/hooks/useOfferBadge';
import { cardAddedToCollection, canReportOrder, canReviewOrder, shipByDate, canBuyerCancelUnshipped, isUnshippedOrder, buyerCancelDate } from '@/lib/orderDisputes';
import ReviewSheet, { type OrderReview } from '@/components/ReviewSheet';
import ReportProblemSheet from '@/components/ReportProblemSheet';

// OBO best-offer is dark-launched behind this flag; the Offers tab is hidden
// entirely when off.
const OFFERS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

// Shapes returned by /api/profile/{orders,shipments,sales} — same contracts
// the mobile Profile panels consume.
interface OrderRow {
    id: string;
    status: string;
    created_at: string;
    total_amount: number;
    // Collector Pass voucher taken off this row's charge (lib/orderGroups buyerPaidOf).
    discount_amount?: number | null;
    delivered_at?: string | null;
    completed_at?: string | null;
    // The buyer's review of this order (one per order), from /api/profile/orders.
    review?: OrderReview | null;
    // One row per listing; a multi-item checkout shares one transfer_group
    // (one payment, one parcel). Tabs render one row per group.
    transfer_group?: string | null;
    // Live-break spot orders: no listing snapshot; the server resolves the
    // stream/lot/spot display context instead (lib/breakOrderContext). Their
    // parcel is consolidated at stream settle, so the label button is
    // replaced by a passive notice for them.
    break_spot_id?: string | null;
    break_context?: { title: string; imageSmall: string | null } | null;
    // Seller shipments only: who the parcel goes to (see /api/profile/shipments).
    buyer_id?: string | null;
    buyer?: { display_name: string | null; phone?: string | null; address?: string | null } | null;
    listing: { card_data: any; condition: string } | null;
    shipping_labels?: {
        tracking_number?: string | null;
        carrier_name?: string | null;
        courier_tracking_url?: string | null;
        status?: string | null;
        // Set when the seller shipped outside our Flash waybill (lib/orderGroups
        // HandoffFields): the carrier and number the buyer should look at.
        handoff_carrier?: string | null;
        handoff_tracking_number?: string | null;
        handed_off_at?: string | null;
        // Seller side: drop-off or a booked courier (components/ParcelHandoff).
        pickup_status?: string | null;
        updated_at?: string | null;
    }[];
}

interface SaleRow {
    id: string;
    total_amount: number;
    platform_fee: number;
    // Buyer voucher paid out of OUR fee; platform_fee above is stored already
    // reduced by it (lib/orderGroups sellerNetOf).
    discount_amount?: number | null;
    completed_at: string;
    transfer_group?: string | null;
    break_spot_id?: string | null;
    break_context?: { title: string; imageSmall: string | null } | null;
    listing: { card_data: any; condition: string; price: number } | null;
}

type Tab = 'purchases' | 'shipments' | 'sales' | 'offers';

// Raw order status -> Tailwind tone (CSS, locale-independent) and the i18n key
// under desktop.orders.status. Several backend statuses collapse to one
// user-facing label (e.g. paid/label_generated/processing all read "Processing").
const STATUS_META: Record<string, { tone: string; key: string }> = {
    pending: { tone: 'bg-slate-700/60 text-slate-300 border-slate-600', key: 'pending_payment' },
    paid: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', key: 'processing' },
    label_generated: { tone: 'bg-amber-500/10 text-amber-300 border-amber-500/30', key: 'preparing_for_shipment' },
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

// Button and link styles shared by the three tabs, so a confirm, a label and
// a clear read as the same family wherever they sit.
const BTN_PRIMARY = 'inline-flex items-center justify-center gap-2 bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-xs font-black px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap';
const BTN_SECONDARY = 'inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap';
const BTN_OUTLINE_CYAN = 'inline-flex items-center justify-center gap-2 border border-brand-cyan/30 text-brand-cyan hover:bg-brand-cyan/10 text-xs font-black px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap';
const BTN_OUTLINE_AMBER = 'inline-flex items-center justify-center gap-2 border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-xs font-black px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap';
const BTN_GREEN = 'inline-flex items-center justify-center gap-2 bg-brand-green/20 hover:bg-brand-green/30 border border-brand-green/30 text-brand-green text-xs font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap';
const LINK_QUIET = 'inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors';
const EYEBROW = 'text-[10px] font-bold uppercase tracking-widest text-slate-500';

// One purchase, parcel or sale: a header strip (who, when, which waybill,
// status), the cards on the left, money and actions stacked on the right.
// Replaces a single wrapped flex row in which ten chips and buttons landed
// wherever the width put them.
function RowShell({ header, aside, children }: { header: React.ReactNode; aside: React.ReactNode; children: React.ReactNode }) {
    return (
        <article className="rounded-2xl border border-white/5 bg-slate-800/40 overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 border-b border-white/5 bg-white/[0.02] text-xs text-slate-400">
                {header}
            </div>
            <div className="grid gap-5 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-3">{children}</div>
                <div className="flex flex-col items-end gap-2.5 md:min-w-[200px] md:pl-6 md:border-l md:border-white/5">{aside}</div>
            </div>
        </article>
    );
}

// "Order #ABCD1234 · 6 Nov 2026", the id linking to the order page.
function OrderRef({ id, date }: { id: string; date?: string | null }) {
    const { t } = useTranslation();
    return (
        <span className="flex items-center gap-2">
            <span className="font-bold uppercase tracking-wide text-slate-500">{t('desktop.orders.order')}</span>
            <Link href={`/orders/${id}`} className="font-mono text-white hover:text-brand-cyan transition-colors">#{id.slice(0, 8).toUpperCase()}</Link>
            {date && (
                <span className="text-slate-500">· {new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            )}
        </span>
    );
}

function EmptyState({ icon, title, body, action }: { icon: string; title: string; body: string; action?: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-dashed border-white/10 py-14 px-6 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/5 mb-4">
                <i className={`fa-solid ${icon} text-xl text-slate-500`}></i>
            </div>
            <p className="text-white font-black">{title}</p>
            <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">{body}</p>
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}

// How a purchase is travelling, under its cards: the Flash waybill with its
// tracking link, the carrier the seller named when they shipped another way,
// or the manual-handling notice. Nothing before a label exists.
function ShippingLine({ label }: { label?: NonNullable<OrderRow['shipping_labels']>[number] }) {
    const { t } = useTranslation();
    const handoff = handoffOf(label);
    if (handoff) {
        return (
            <p className="text-xs text-slate-400 flex items-center gap-2">
                <i className="fa-solid fa-truck-fast opacity-60"></i>
                <span>
                    {t('parcel.shippedVia').replace('{carrier}', handoff.carrier || t('parcel.anotherCarrier'))}
                    {handoff.trackingNumber && <span className="font-mono text-white ml-2">{handoff.trackingNumber}</span>}
                </span>
            </p>
        );
    }
    const pno = label?.tracking_number;
    if (pno === 'MANUAL') {
        return <p className="text-xs text-amber-300 italic">{t('desktop.orders.manual')}</p>;
    }
    if (label && isRealWaybill(pno)) {
        return (
            <p className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                <i className="fa-solid fa-truck opacity-60"></i>
                <span className="font-mono text-white">{pno}</span>
                {label.courier_tracking_url && (
                    <a
                        href={label.courier_tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-cyan hover:underline font-bold uppercase text-[10px] tracking-widest"
                    >
                        {t('desktop.orders.track')} ↗
                    </a>
                )}
            </p>
        );
    }
    return null;
}

// Row shape shared by orders/shipments/sales cells. Live-break spot orders
// have no listing snapshot — the server-resolved break_context ("<stream> —
// <lot> · Spot #N" + lot art) takes precedence, and a break row whose context
// failed to resolve reads as a live-break spot, never "Card order".
function CardCell({ row }: { row: { listing: { card_data: any; condition?: string } | null; break_spot_id?: string | null; break_context?: { title: string; imageSmall: string | null } | null } }) {
    const { t } = useTranslation();
    const cardData = row.listing?.card_data;
    const image = row.break_context?.imageSmall || cardData?.images?.small || null;
    const name = row.break_context?.title
        || cardData?.name
        || (row.break_spot_id ? t('desktop.orders.liveBreakSpot') : 'Card order');
    return (
        <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-14 rounded-md bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                {image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={getThumbnailUrl(image)} alt="" loading="lazy" className={`w-full h-full ${cardData?.isSealed ? 'object-contain' : 'object-cover'}`} />
                )}
            </span>
            <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{name}</p>
                <OrderCardMeta cardData={cardData} condition={row.listing?.condition} />
            </div>
        </div>
    );
}

export default function DesktopOrders() {
    const { showToast } = useToast();
    const { t } = useTranslation();
    // Shared auth state from the cart provider (single gotrue subscription
    // for the whole desktop shell).
    const { user, authChecked, payOffer } = useDesktopCart();
    const [authOpen, setAuthOpen] = useState(false);
    // Count on the Offers tab so an accepted-but-unpaid offer is visible
    // without opening the tab.
    const offerBadge = useOfferBadge(OFFERS_ENABLED && !!user);

    // The offer-email CTA lands here as /orders?tab=offers (forwarded from the
    // desktop home's /?view=offers). The active tab is mirrored into the URL so
    // it survives a round trip out to a card page and back (browser Back returns
    // to the tab the user left, e.g. Offers, instead of resetting to Purchases).
    const router = useRouter();
    const searchParams = useSearchParams();
    const isValidTab = (v: string | null | undefined): v is Tab =>
        v === 'purchases' || v === 'shipments' || v === 'sales' || (v === 'offers' && OFFERS_ENABLED);
    const urlTab = searchParams?.get('tab');
    const initialTab: Tab = isValidTab(urlTab) ? urlTab : 'purchases';
    const [tab, setTab] = useState<Tab>(initialTab);

    // Switch tabs and stamp the choice into the URL (replace, not push, so tab
    // flipping doesn't pile up history entries).
    const selectTab = (key: Tab) => {
        setTab(key);
        router.replace(`/orders?tab=${key}`, { scroll: false });
    };

    // The accepted-offer pay link (/pay/<id>), forwarded by the desktop home as
    // ?payOffer=<id>. Held until there is a session — the link is opened from
    // email, often signed out — then handed to the same payOffer as the inbox's
    // Pay button. A ref, not state: one shot per id, and clearing it must not
    // re-run the effect and drop the lookup in flight.
    const pendingPayOfferId = useRef<string | null>(searchParams?.get('payOffer') ?? null);
    useEffect(() => {
        const id = pendingPayOfferId.current;
        if (!OFFERS_ENABLED || !id || !user) return;
        pendingPayOfferId.current = null;
        router.replace('/orders?tab=offers', { scroll: false });
        void (async () => {
            try {
                const res = await fetch('/api/offers?state=active', { cache: 'no-store' });
                const data = res.ok ? await res.json() : null;
                const list: Offer[] = Array.isArray(data?.offers) ? data.offers : [];
                const offer = list.find((o) => o.id === id);
                if (offer && offer.status === 'accepted' && offer.viewerRole === 'buyer') {
                    payOffer(offer);
                } else {
                    // Paid, expired, withdrawn, or someone else's — the Offers
                    // tab underneath shows the truth.
                    showToast(t('offer.payUnavailable'), 'error');
                }
            } catch {
                showToast(t('offer.payUnavailable'), 'error');
            }
        })();
    }, [user, payOffer, router, showToast, t]);
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [shipments, setShipments] = useState<OrderRow[]>([]);
    const [sales, setSales] = useState<SaleRow[]>([]);
    const [loading, setLoading] = useState(true);

    // Confirm-delivery review modal. Holds every order id in the purchase's
    // transfer group (one parcel = one confirmation); the review rides only
    // the first order so a multi-item group doesn't mint duplicate ratings.
    const [reviewOrderIds, setReviewOrderIds] = useState<string[] | null>(null);
    const [reviewScore, setReviewScore] = useState(5);
    const [reviewComment, setReviewComment] = useState('');
    const [submittingReview, setSubmittingReview] = useState(false);
    // Stand-alone review (an order that completed on its own) and the
    // report-a-problem sheet, both keyed on the group's primary order.
    const [reviewSheetOrder, setReviewSheetOrder] = useState<OrderRow | null>(null);
    const [reportSheetOrder, setReportSheetOrder] = useState<OrderRow | null>(null);

    // Viewing purchases self-heals stale statuses: /api/orders/track polls
    // Flash and advances the order server-side (webhooks can drop, the
    // reconcile cron is hourly). One sweep per mount — the ref stops the
    // post-sweep refetch from sweeping again. Capped at 10 orders: each call
    // is a signed Flash API request against a per-merchant rate limit. The
    // refetch is SILENT (no setLoading) — it lands seconds after mount, and
    // toggling the shared loading flag would swap whichever tab the user has
    // since opened for the skeleton state.
    const sweptRef = useRef(false);
    const silentRefetchPurchases = useCallback(async () => {
        try {
            const res = await fetch('/api/profile/orders?limit=50');
            const data = await res.json();
            if (res.ok) setOrders(data.orders || []);
        } catch { /* keep the list we have */ }
    }, []);
    const syncInFlightOrders = useCallback(async (list: OrderRow[], refetch: () => void) => {
        const inFlight = list
            .filter((o) => {
                const pno = o.shipping_labels?.[0]?.tracking_number;
                return ['label_generated', 'shipped', 'in_transit', 'out_for_delivery'].includes(o.status) && pno && pno !== 'MANUAL';
            })
            .slice(0, 10);
        if (inFlight.length === 0) return;
        const results = await Promise.allSettled(
            inFlight.map((o) => fetch(`/api/orders/track?orderId=${o.id}`).then((r) => (r.ok ? r.json() : null)))
        );
        const advanced = results.some((r, i) => {
            if (r.status !== 'fulfilled' || !r.value) return false;
            const before = inFlight[i];
            return (
                (r.value.label?.status && r.value.label.status !== before.shipping_labels?.[0]?.status) ||
                (r.value.order?.status && r.value.order.status !== before.status)
            );
        });
        if (advanced) refetch();
    }, []);

    const fetchTab = useCallback(async (which: Tab) => {
        // The offers tab is self-fetching (OffersInbox hits /api/offers itself),
        // so there's no data endpoint to load here.
        if (which === 'offers') { setLoading(false); return; }
        setLoading(true);
        try {
            if (which === 'purchases') {
                const res = await fetch('/api/profile/orders?limit=50');
                const data = await res.json();
                if (res.ok) {
                    setOrders(data.orders || []);
                    if (!sweptRef.current) {
                        sweptRef.current = true;
                        syncInFlightOrders(data.orders || [], silentRefetchPurchases);
                    }
                }
            } else if (which === 'shipments') {
                const res = await fetch('/api/profile/shipments?limit=50');
                const data = await res.json();
                if (res.ok) {
                    setShipments(data.shipments || []);
                    setPickupInfo(data.pickup ?? null);
                }
            } else {
                const res = await fetch('/api/profile/sales?limit=50');
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

    // Dismiss a delivered/completed shipment from the "To ship" tab. Same
    // semantics as the mobile swipe: stamps seller_cleared_at; the orders
    // stay in Sales History. Takes the whole transfer group (one parcel, one
    // Clear). Optimistic removal with refetch on failure.
    const clearShipments = async (orderIds: string[]) => {
        setShipments((prev) => prev.filter((s) => !orderIds.includes(s.id)));
        try {
            const results = await Promise.all(orderIds.map((orderId) =>
                fetch('/api/profile/shipments/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId }),
                })
            ));
            if (results.some((res) => !res.ok)) throw new Error();
        } catch {
            showToast(t('desktop.orders.toastClearFailed'), 'error');
            fetchTab('shipments');
        }
    };

    // Labels are minted when the seller is ready (lib/parcels), so the seller
    // decides which of a buyer's orders travel together. One handler serves
    // all three buttons: create for one checkout, combine several checkouts,
    // or add to a waybill Flash has not scanned yet. On success the tab
    // refreshes and the label opens (any order id in the parcel works).
    const [labelBusyIds, setLabelBusyIds] = useState<string[]>([]);
    // A new label first asks how the parcel reaches Flash (components/ParcelHandoff):
    // a courier is booked only when the seller says so. Adding cards to an
    // existing parcel skips the question; that parcel is already arranged.
    const [shipSheet, setShipSheet] = useState<
        { mode: 'create'; orderIds: string[] } | { mode: 'pickup'; trackingNumber: string } | null
    >(null);
    const [pickupInfo, setPickupInfo] = useState<PickupInfo | null>(null);
    const [pickupBusyPno, setPickupBusyPno] = useState<string | null>(null);
    const createLabel = async (orderIds: string[], attachToTrackingNumber?: string, shipMethod?: ShipMethod) => {
        setLabelBusyIds(orderIds);
        try {
            const res = await fetch('/api/orders/label/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderIds, attachToTrackingNumber, shipMethod }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'label create failed');
            showToast(
                attachToTrackingNumber ? t('parcel.created')
                    : shipMethod !== 'pickup' ? t('parcel.createdDropoff')
                    : data?.pickupBooked ? t('parcel.createdPickup')
                    : t('parcel.createdPickupFailed'),
                shipMethod === 'pickup' && !attachToTrackingNumber && !data?.pickupBooked ? 'error' : 'success',
            );
            await fetchTab('shipments');
            if (data?.manual !== true) await openLabel(orderIds[0]);
        } catch (err) {
            console.error('Create label failed:', err);
            showToast(t('parcel.createFailed'), 'error');
        } finally {
            setLabelBusyIds([]);
        }
    };

    // Book a Flash courier for a parcel that already has its label: the seller
    // chose drop-off and changed their mind, or the booked courier never came.
    const bookPickup = async (trackingNumber: string) => {
        setPickupBusyPno(trackingNumber);
        try {
            const res = await fetch('/api/orders/label/pickup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackingNumber }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(t(data?.code === 'PICKUP_RECENT' ? 'parcel.pickupRecent' : 'parcel.pickupFailed'), 'error');
            } else {
                showToast(t('parcel.pickupBookedToast'), 'success');
            }
            await fetchTab('shipments');
        } catch (err) {
            console.error('Book pickup failed:', err);
            showToast(t('parcel.pickupFailed'), 'error');
        } finally {
            setPickupBusyPno(null);
        }
    };

    // The parcel left without a Flash scan of our label (handed to Flash
    // staff, another courier, by hand): the seller says so here and the order
    // moves to shipped, the buyer is told and can confirm receipt. Without it
    // the order sat at label_generated forever (lib/parcels handOffParcel).
    const [handoffSheet, setHandoffSheet] = useState<{ orderIds: string[] } | null>(null);
    const [handoffBusy, setHandoffBusy] = useState(false);
    const handOffParcel = async (orderIds: string[], carrier: string, trackingNumber: string) => {
        setHandoffBusy(true);
        try {
            const res = await fetch('/api/orders/label/handoff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderIds, carrier, trackingNumber }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'handoff failed');
            setHandoffSheet(null);
            showToast(t('parcel.shippedElsewhereDone'), 'success');
            await fetchTab('shipments');
        } catch (err) {
            console.error('Mark shipped elsewhere failed:', err);
            showToast(t('parcel.shippedElsewhereFailed'), 'error');
        } finally {
            setHandoffBusy(false);
        }
    };

    // Ship it myself: the seller took the cards to any counter (a Flash Home,
    // Kerry, J&T, the post office), paid there, and enters the number it gave
    // them (lib/parcels shipSelf). No Flash label is minted; the buyer is told
    // and 17TRACK follows the number. The sheet shows the buyer's address and
    // phone for the counter's form.
    const [selfShipSheet, setSelfShipSheet] = useState<{ orderIds: string[]; recipient: RecipientInfo | null } | null>(null);
    const [selfShipBusy, setSelfShipBusy] = useState(false);
    const shipSelf = async (orderIds: string[], carrier: string, trackingNumber: string) => {
        setSelfShipBusy(true);
        try {
            const res = await fetch('/api/orders/label/self-ship', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderIds, carrier, trackingNumber }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(t(data?.code === 'TRACKING_REQUIRED' ? 'parcel.trackingRequired' : 'parcel.shipSelfFailed'), 'error');
                return;
            }
            setSelfShipSheet(null);
            showToast(t('parcel.shipSelfDone'), 'success');
            await fetchTab('shipments');
        } catch (err) {
            console.error('Self-ship failed:', err);
            showToast(t('parcel.shipSelfFailed'), 'error');
        } finally {
            setSelfShipBusy(false);
        }
    };

    // Buyer: ask to cancel an order the seller has not shipped (lib/orderDisputes
    // canBuyerCancelUnshipped). It files a support ticket; the team refunds.
    const [cancelBusyGroup, setCancelBusyGroup] = useState<string | null>(null);
    const cancelUnshipped = async (transferGroup: string) => {
        if (!window.confirm(t('orderActions.cancelUnshippedConfirm'))) return;
        setCancelBusyGroup(transferGroup);
        try {
            const res = await fetch('/api/orders/cancel-unshipped', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transferGroup }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'cancel failed');
            showToast(t(data?.alreadyOpen ? 'orderActions.cancelUnshippedAlready' : 'orderActions.cancelUnshippedDone'), 'success');
        } catch (err) {
            console.error('Cancel unshipped failed:', err);
            showToast(t('orderActions.cancelUnshippedFailed'), 'error');
        } finally {
            setCancelBusyGroup(null);
        }
    };

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
        if (!reviewOrderIds || reviewOrderIds.length === 0) return;
        setSubmittingReview(true);
        try {
            // Complete every order in the transfer group (the buyer received
            // one parcel); the review rides only the first order.
            let firstError: string | null = null;
            let completedAny = false;
            for (let i = 0; i < reviewOrderIds.length; i++) {
                const res = await fetch('/api/orders/complete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderId: reviewOrderIds[i],
                        reviewScore: i === 0 ? (reviewScore || null) : null,
                        reviewComment: i === 0 ? reviewComment : '',
                    }),
                });
                if (res.ok) {
                    completedAny = true;
                } else if (!firstError) {
                    const data = await res.json().catch(() => ({}));
                    firstError = data.error || t('desktop.orders.toastConfirmFailed');
                }
            }
            if (completedAny) {
                setReviewOrderIds(null);
                showToast(t('desktop.orders.toastCompleted'), 'success');
                fetchTab('purchases');
            }
            if (firstError) throw new Error(firstError);
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
                    // OBO tab only when the offers feature flag is on.
                    ...(OFFERS_ENABLED ? [['offers', t('desktop.orders.tabOffers')] as [Tab, string]] : []),
                ] as [Tab, string][]).map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => selectTab(key)}
                        className={`px-5 py-3 text-sm font-bold border-b-2 -mb-px transition-colors ${
                            tab === key
                                ? 'text-white border-brand-cyan'
                                : 'text-slate-500 border-transparent hover:text-slate-300'
                        }`}
                    >
                        {label}
                        {key === 'offers' && offerBadge.actionable > 0 && (
                            <span className="ml-2 min-w-[18px] h-[18px] px-1.5 rounded-full bg-brand-cyan text-brand-darker text-[10px] font-black inline-flex items-center justify-center align-middle">
                                {offerBadge.actionable}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="space-y-3 mt-6">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-32 rounded-2xl bg-white/5 animate-pulse"></div>
                    ))}
                </div>
            ) : (
                <div className="mt-6">
                    {tab === 'purchases' && (
                        orders.length === 0 ? (
                            <EmptyState
                                icon="fa-bag-shopping"
                                title={t('desktop.orders.noPurchases')}
                                body={t('desktop.orders.noPurchasesDesc')}
                                action={<Link href="/" className={BTN_PRIMARY}>{t('desktop.orders.browseMarketplace')}</Link>}
                            />
                        ) : (
                            <div className="space-y-3">
                                {/* One row per checkout: a multi-item purchase is
                                    one payment and one parcel (lib/orderGroups),
                                    so its rows stack as item cells in one row
                                    with a summed total and a single confirm. */}
                                {groupByTransferGroup(orders).map((group) => {
                                    const order = group[0];
                                    const label = order.shipping_labels?.[0];
                                    const canComplete = ['shipped', 'out_for_delivery', 'delivered'].includes(order.status);
                                    // Labelled but never scanned: a parcel that left
                                    // outside our waybill arrives without the status
                                    // moving, so the buyer who holds it can still close
                                    // the order. Quieter than the confirm above.
                                    const canCompleteEarly = order.status === 'label_generated' && hasShippingLabel(order);
                                    // What the buyer paid: list prices less their voucher (lib/orderGroups).
                                    const groupTotal = group.reduce((sum, o) => sum + buyerPaidOf(o), 0);
                                    const groupDiscount = group.reduce((sum, o) => sum + (Number(o.discount_amount) || 0), 0);
                                    const openConfirm = () => { setReviewOrderIds(group.map((o) => o.id)); setReviewScore(5); setReviewComment(''); };
                                    const inCollection = cardAddedToCollection(order.status, !!order.break_spot_id);
                                    return (
                                        <RowShell
                                            key={order.id}
                                            header={(
                                                <>
                                                    <OrderRef id={order.id} date={order.created_at} />
                                                    {group.length > 1 && (
                                                        <span className="font-bold uppercase tracking-wide text-slate-500">
                                                            {t('desktop.orders.itemsCount').replace('{count}', String(group.length))} · {t('desktop.orders.onePackage')}
                                                        </span>
                                                    )}
                                                    <span className="ml-auto flex items-center gap-3">
                                                        <StatusChip status={order.status} />
                                                        <Link href={`/orders/${order.id}`} className={LINK_QUIET}>
                                                            {t('desktop.orders.viewOrder')}
                                                            <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true"></i>
                                                        </Link>
                                                    </span>
                                                </>
                                            )}
                                            aside={(
                                                <>
                                                    <div className="text-right">
                                                        <p className="text-xl font-black text-brand-cyan leading-none">{formatTHB(groupTotal)}</p>
                                                        {groupDiscount > 0 && (
                                                            <p className="text-[11px] text-amber-300 mt-1.5">{t('rewards.discount')} -{formatTHB(groupDiscount)}</p>
                                                        )}
                                                    </div>
                                                    {canComplete && (
                                                        <button onClick={openConfirm} className={BTN_PRIMARY}>
                                                            {t('desktop.orders.confirmDelivery')}
                                                        </button>
                                                    )}
                                                    {canCompleteEarly && (
                                                        <button onClick={openConfirm} className={BTN_OUTLINE_CYAN}>
                                                            {t('orderActions.receivedEarly')}
                                                        </button>
                                                    )}
                                                    {/* Seller has not shipped: from day seven the buyer may ask
                                                        to cancel (a support ticket; the team refunds). */}
                                                    {!order.break_spot_id && group.every((o) => isUnshippedOrder(o, o.shipping_labels?.[0])) && (
                                                        group.every((o) => canBuyerCancelUnshipped(o, o.shipping_labels?.[0])) ? (
                                                            <button
                                                                onClick={() => order.transfer_group && cancelUnshipped(order.transfer_group)}
                                                                disabled={cancelBusyGroup === order.transfer_group || !order.transfer_group}
                                                                className="inline-flex items-center justify-center gap-2 border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-black px-4 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                                                            >
                                                                {t('orderActions.cancelUnshipped')}
                                                            </button>
                                                        ) : (() => {
                                                            const at = buyerCancelDate(order.created_at);
                                                            return at ? (
                                                                <p className="text-[11px] text-slate-500 text-right max-w-[220px]">
                                                                    {t('orderActions.cancelUnshippedHint').replace('{date}', at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}
                                                                </p>
                                                            ) : null;
                                                        })()
                                                    )}
                                                    {/* Review and report live here so a buyer whose order
                                                        completed on its own still has both paths. */}
                                                    {canReviewOrder(order) && order.status !== 'disputed' && (
                                                        order.review ? (
                                                            <button onClick={() => setReviewSheetOrder(order)} className={LINK_QUIET} title={t('orderActions.editReview')}>
                                                                <span className="text-amber-300">{'★'.repeat(order.review.rating)}</span>
                                                                <span>· {t('orderActions.editReview')}</span>
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => setReviewSheetOrder(order)} className={BTN_OUTLINE_AMBER}>
                                                                <i className="fa-solid fa-star text-[10px]"></i>
                                                                {t('orderActions.reviewSeller')}
                                                            </button>
                                                        )
                                                    )}
                                                    {inCollection && (
                                                        <Link href="/collection" className={LINK_QUIET} title={t('orderActions.addedToCollection')}>
                                                            <i className="fa-solid fa-circle-check text-emerald-300"></i>
                                                            {t('orderActions.viewCollection')}
                                                        </Link>
                                                    )}
                                                    {order.status !== 'disputed' && canReportOrder(order) && (
                                                        <button
                                                            onClick={() => setReportSheetOrder(order)}
                                                            className="text-slate-500 hover:text-rose-300 text-[11px] font-bold uppercase tracking-wider transition-colors"
                                                        >
                                                            {t('orderActions.reportProblem')}
                                                        </button>
                                                    )}
                                                    {order.status === 'disputed' && (
                                                        <p className="text-[11px] text-rose-300 text-right max-w-[220px]">{t('orderActions.disputeOpen')}</p>
                                                    )}
                                                </>
                                            )}
                                        >
                                            {group.map((o) => (
                                                <CardCell key={o.id} row={o} />
                                            ))}
                                            <ShippingLine label={label} />
                                        </RowShell>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {tab === 'shipments' && (
                        shipments.length === 0 ? (
                            <EmptyState
                                icon="fa-box-open"
                                title={t('desktop.orders.noShipmentsTitle')}
                                body={t('desktop.orders.noShipments')}
                            />
                        ) : (
                            <div className="space-y-3">
                                {/* One row per PARCEL (waybill). A checkout ships as
                                    one Flash parcel, and two checkouts share one when
                                    the seller labels them together (lib/parcels), so the row
                                    lists every card for that envelope under its one
                                    label button / one Clear. The primary order's id
                                    drives both (every row carries the same waybill);
                                    Clear stamps every row in the group. */}
                                {groupByParcel(shipments).map((group, _i, parcels) => {
                                    const order = group[0];
                                    const pno = order.shipping_labels?.[0]?.tracking_number;
                                    const checkouts = countCheckouts(group);
                                    const buyerName = order.buyer?.display_name || null;
                                    const buyerId = order.buyer_id || null;
                                    // No label yet: the seller mints it here. The buyer's
                                    // other unlabelled checkouts can go in the same parcel,
                                    // and a parcel Flash has not collected yet can take
                                    // these cards too (no new waybill, nothing cancelled).
                                    const awaitingLabel = group.every(isAwaitingLabel);
                                    const buyerKey = order.buyer_id || '';
                                    const otherUnlabelled = awaitingLabel
                                        ? (parcelsByBuyer(parcels, isAwaitingLabel).get(buyerKey) || []).filter((g) => g !== group)
                                        : [];
                                    const openParcel = awaitingLabel
                                        ? (parcelsByBuyer(parcels, isUnscannedParcel).get(buyerKey) || [])[0]
                                        : undefined;
                                    const openParcelPno = openParcel?.[0]?.shipping_labels?.[0]?.tracking_number;
                                    const combineIds = [group, ...otherUnlabelled].flatMap((g) => g.map((o) => o.id));
                                    const labelBusy = group.some((o) => labelBusyIds.includes(o.id));
                                    // Delivered/completed rows linger as a delivery
                                    // notice until cleared — label printing no longer
                                    // applies to them.
                                    const isDelivered = ['delivered', 'completed'].includes(order.status);
                                    // Live-break spot orders never get a per-order
                                    // label (parcels consolidate at stream settle) —
                                    // the label button becomes a passive notice.
                                    const isBreakOrder = !!order.break_spot_id;
                                    // Flash cancelled the booked courier (reconcile-pickups
                                    // cron): flagged in the header so it is not missed.
                                    const courierCancelled = !isBreakOrder && isRealWaybill(pno) && group.every(isUnscannedParcel)
                                        && isPickupCancelled(group.map((o) => o.shipping_labels?.[0]));
                                    const groupTotal = group.reduce((sum, o) => sum + (o.total_amount || 0), 0);
                                    // The handling promise the buyer already read on the card
                                    // page; overdue once it has passed.
                                    const shipDue = !isDelivered && !isBreakOrder && ['paid', 'label_generated', 'processing'].includes(order.status)
                                        ? shipByDate(order.created_at)
                                        : null;
                                    const shipOverdue = !!shipDue && shipDue.getTime() < Date.now();
                                    // What the seller does with this parcel next.
                                    const primaryAction = isDelivered ? (
                                        <button onClick={() => clearShipments(group.map((o) => o.id))} className={BTN_SECONDARY}>
                                            <i className="fa-solid fa-check text-emerald-400"></i>
                                            {t('desktop.orders.clearShipment')}
                                        </button>
                                    ) : isBreakOrder ? (
                                        <span className="text-[11px] font-bold uppercase tracking-wide text-brand-cyan bg-brand-cyan/5 border border-brand-cyan/20 rounded-lg px-3 py-2 text-right">
                                            <i className="fa-solid fa-box-open mr-2"></i>
                                            {t('desktop.orders.liveBreakShipsWithParcel')}
                                        </span>
                                    ) : awaitingLabel ? (
                                        <>
                                            <button
                                                onClick={() => setShipSheet({ mode: 'create', orderIds: group.map((o) => o.id) })}
                                                disabled={labelBusy}
                                                className={BTN_GREEN}
                                            >
                                                <i className="fa-solid fa-tag"></i>
                                                {labelBusy ? t('parcel.creating') : t('parcel.createLabel')}
                                            </button>
                                            <button
                                                onClick={() => setSelfShipSheet({
                                                    orderIds: group.map((o) => o.id),
                                                    recipient: order.buyer
                                                        ? { name: order.buyer.display_name ?? null, phone: order.buyer.phone ?? null, address: order.buyer.address ?? null }
                                                        : null,
                                                })}
                                                disabled={labelBusy}
                                                className={BTN_SECONDARY}
                                                title={t('parcel.shipSelfHint')}
                                            >
                                                <i className="fa-solid fa-truck-fast text-slate-400"></i>
                                                {t('parcel.shipSelf')}
                                            </button>
                                        </>
                                    ) : handoffOf(order.shipping_labels?.[0]) ? null : (
                                        // A parcel shipped another way never used this label.
                                        <button onClick={() => openLabel(order.id)} className={BTN_SECONDARY}>
                                            <i className="fa-solid fa-print text-slate-400"></i>
                                            {t('desktop.orders.shippingLabel')}
                                        </button>
                                    );
                                    return (
                                        <RowShell
                                            key={order.id}
                                            header={(
                                                <>
                                                    {/* Parcel header: who it goes to, the waybill,
                                                        and how many checkouts it holds. */}
                                                    <span className="font-bold uppercase tracking-wide text-slate-300">
                                                        {t('parcel.heading')}{buyerName ? ` · ${t('parcel.to').replace('{name}', buyerName)}` : ''}
                                                    </span>
                                                    {isRealWaybill(pno) && (
                                                        <span className="font-mono text-slate-400">{pno}</span>
                                                    )}
                                                    {checkouts > 1 && (
                                                        <span className="text-[10px] font-bold uppercase tracking-wide text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/20 rounded-md px-2 py-0.5">
                                                            {t('parcel.combined').replace('{count}', String(checkouts))}
                                                        </span>
                                                    )}
                                                    {courierCancelled && (
                                                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-0.5">
                                                            {t('parcel.courierCancelled')}
                                                        </span>
                                                    )}
                                                    {/* The seller's way to reach this buyer (which print
                                                        did you order, is the address right) without going
                                                        through support. Opens the Messages dialog. */}
                                                    {buyerId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const detail: ChatOpenDetail = {
                                                                    user: { id: buyerId, username: null, display_name: buyerName || t('parcel.buyer'), avatar_url: null },
                                                                    noShop: true,
                                                                };
                                                                window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail }));
                                                            }}
                                                            className="font-bold text-brand-cyan hover:text-white transition-colors inline-flex items-center gap-1.5"
                                                        >
                                                            <i className="fa-regular fa-comment-dots"></i>
                                                            {t('parcel.messageBuyer')}
                                                        </button>
                                                    )}
                                                    <span className="ml-auto flex items-center gap-3">
                                                        <span className="text-slate-500">{new Date(order.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                                        {shipDue && (
                                                            <span className={`font-bold ${shipOverdue ? 'text-rose-300' : 'text-amber-300'}`}>
                                                                {shipOverdue ? t('orderActions.overdue') : t('orderActions.shipBy')} {shipDue.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                                                            </span>
                                                        )}
                                                        <StatusChip status={isDelivered ? 'delivered' : order.status} />
                                                    </span>
                                                </>
                                            )}
                                            aside={(
                                                <>
                                                    <p className="text-xl font-black text-brand-cyan leading-none">{formatTHB(groupTotal)}</p>
                                                    {primaryAction}
                                                    <Link href={`/orders/${order.id}`} className={LINK_QUIET}>
                                                        {t('desktop.orders.viewOrder')}
                                                        <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true"></i>
                                                    </Link>
                                                </>
                                            )}
                                        >
                                            {checkouts > 1 && !isDelivered && (
                                                <p className="text-xs font-semibold text-brand-cyan">{t('parcel.packTogether')}</p>
                                            )}
                                            {/* A combined parcel keeps each checkout's cards
                                                under an "Order n" caption so the seller can
                                                match them to the sale notifications. */}
                                            {groupByTransferGroup(group).map((checkout, idx) => (
                                                <div key={checkout[0].id} className="space-y-2">
                                                    {checkouts > 1 && (
                                                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                                                            {t('parcel.orderN').replace('{n}', String(idx + 1))} · {new Date(checkout[0].created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                        </p>
                                                    )}
                                                    {checkout.map((o) => (
                                                        <CardCell key={o.id} row={o} />
                                                    ))}
                                                </div>
                                            ))}
                                            {group.length > 1 && (
                                                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide">
                                                    {t('desktop.orders.itemsCount').replace('{count}', String(group.length))} · {t('desktop.orders.onePackage')}
                                                </p>
                                            )}
                                            {/* The buyer's other unlabelled checkouts can ship
                                                in this parcel; a parcel Flash has not collected
                                                yet can take these cards too. */}
                                            {!isBreakOrder && awaitingLabel && otherUnlabelled.length > 0 && (
                                                <div className="rounded-lg border border-brand-cyan/20 bg-brand-cyan/5 px-3 py-2 space-y-2 max-w-md">
                                                    <p className="text-xs font-bold text-brand-cyan">
                                                        {t('parcel.moreUnlabelled').replace('{count}', String(otherUnlabelled.length))}
                                                    </p>
                                                    <button
                                                        onClick={() => setShipSheet({ mode: 'create', orderIds: combineIds })}
                                                        disabled={labelBusy}
                                                        className="bg-brand-cyan/15 hover:bg-brand-cyan/25 border border-brand-cyan/30 text-brand-cyan text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                                    >
                                                        <i className="fa-solid fa-box mr-2"></i>
                                                        {t('parcel.combineAndPrint').replace('{count}', String(otherUnlabelled.length + 1))}
                                                    </button>
                                                </div>
                                            )}
                                            {!isBreakOrder && awaitingLabel && openParcelPno && (
                                                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 space-y-2 max-w-md">
                                                    <p className="text-xs font-bold text-amber-300">{t('parcel.hasOpenParcel')}</p>
                                                    <button
                                                        onClick={() => createLabel(group.map((o) => o.id), openParcelPno)}
                                                        disabled={labelBusy}
                                                        className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-200 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                                    >
                                                        <i className="fa-solid fa-box-open mr-2"></i>
                                                        {t('parcel.addToParcel').replace('{pno}', openParcelPno)}
                                                    </button>
                                                </div>
                                            )}
                                            {/* Labelled, not yet scanned by Flash: what was
                                                arranged (drop-off or a booked courier) and a
                                                way to book one. */}
                                            {!isBreakOrder && isRealWaybill(pno) && group.every(isUnscannedParcel) && (
                                                <div className="max-w-md">
                                                    <ParcelHandoffNote
                                                        labels={group.map((o) => o.shipping_labels?.[0])}
                                                        busy={pickupBusyPno === pno}
                                                        onBookPickup={() => setShipSheet({ mode: 'pickup', trackingNumber: pno })}
                                                        onShippedElsewhere={group.every(isHandoffable) ? () => setHandoffSheet({ orderIds: group.map((o) => o.id) }) : undefined}
                                                    />
                                                </div>
                                            )}
                                            {/* A MANUAL placeholder never gets a Flash scan
                                                either; the seller who shipped it anyway can
                                                still move the order on. */}
                                            {!isBreakOrder && pno === 'MANUAL' && group.every(isHandoffable) && (
                                                <button
                                                    onClick={() => setHandoffSheet({ orderIds: group.map((o) => o.id) })}
                                                    className="text-slate-400 hover:text-white text-xs font-bold underline underline-offset-2"
                                                >
                                                    {t('parcel.shippedElsewhere')}
                                                </button>
                                            )}
                                            {/* The seller said this parcel left another way:
                                                the carrier and number they gave. */}
                                            <HandoffSummary label={order.shipping_labels?.[0]} />
                                        </RowShell>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {tab === 'sales' && (
                        sales.length === 0 ? (
                            <EmptyState
                                icon="fa-coins"
                                title={t('desktop.orders.noSales')}
                                body={t('desktop.orders.noSalesDesc')}
                                action={<Link href="/sell" className={BTN_PRIMARY}>{t('desktop.orders.startSelling')}</Link>}
                            />
                        ) : (
                            <div className="space-y-3">
                                {/* "Where is my money?" is answered by Stripe, not
                                    by this list: link the payout account here. */}
                                <div className="flex justify-end">
                                    <Link href="/settings?tab=payouts" className="text-xs font-bold text-slate-400 hover:text-brand-cyan transition-colors">
                                        <i className="fa-solid fa-wallet mr-1.5"></i>{t('desktop.settings.sellerPayouts')}
                                    </Link>
                                </div>
                                {/* One row per checkout — items stack, fee and net
                                    are summed across the group. */}
                                {groupByTransferGroup(sales).map((group) => {
                                    const sale = group[0];
                                    // Seller money (lib/orderGroups): a buyer voucher is paid out of
                                    // our fee, so the fee shown is platform_fee + discount_amount and
                                    // the net does not move with the voucher.
                                    const feeTotal = group.reduce((sum, s) => sum + sellerFeeOf(s), 0);
                                    const netTotal = group.reduce((sum, s) => sum + sellerNetOf(s), 0);
                                    return (
                                        <RowShell
                                            key={sale.id}
                                            header={(
                                                <>
                                                    <OrderRef id={sale.id} date={sale.completed_at} />
                                                    {group.length > 1 && (
                                                        <span className="font-bold uppercase tracking-wide text-slate-500">
                                                            {t('desktop.orders.itemsCount').replace('{count}', String(group.length))}
                                                        </span>
                                                    )}
                                                    <span className="ml-auto">
                                                        <Link href={`/orders/${sale.id}`} className={LINK_QUIET}>
                                                            {t('desktop.orders.viewOrder')}
                                                            <i className="fa-solid fa-chevron-right text-[9px]" aria-hidden="true"></i>
                                                        </Link>
                                                    </span>
                                                </>
                                            )}
                                            aside={(
                                                <div className="text-right">
                                                    <p className={EYEBROW}>{t('desktop.orders.youReceive')}</p>
                                                    <p className="text-xl font-black text-emerald-300 leading-none mt-1">{formatTHB(netTotal)}</p>
                                                    <p className="text-[11px] text-slate-500 mt-1.5">
                                                        {t('desktop.orders.fee')} <span className="text-slate-300 font-bold">{formatTHB(feeTotal)}</span>
                                                    </p>
                                                </div>
                                            )}
                                        >
                                            {group.map((s) => (
                                                <CardCell key={s.id} row={s} />
                                            ))}
                                        </RowShell>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {/* OBO offers inbox. Self-fetches; paying an accepted offer
                        routes through the shared desktop cart (payOffer sets a
                        single-item cart + acceptedOfferId and opens the gated
                        checkout). OffersInbox is null-safe when the flag is off. */}
                    {tab === 'offers' && OFFERS_ENABLED && (
                        <OffersInbox
                            onPayOffer={({ offer }) => payOffer(offer)}
                            onViewListing={(offer) => {
                                // Tapping the card preview opens the full card page;
                                // the offers tab is already mirrored into the URL, so
                                // browser Back returns straight here.
                                if (offer.listing?.card_id) router.push(`/card/${offer.listing.card_id}`);
                            }}
                        />
                    )}
                </div>
            )}

            {reviewOrderIds && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setReviewOrderIds(null)}></div>
                    <div className="relative w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-6">
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
                                onClick={() => setReviewOrderIds(null)}
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

            {reviewSheetOrder && (
                <ReviewSheet
                    orderId={reviewSheetOrder.id}
                    initial={reviewSheetOrder.review ?? null}
                    onClose={() => setReviewSheetOrder(null)}
                    onSaved={(r) => {
                        setOrders((prev) => prev.map((o) => o.id === reviewSheetOrder.id ? { ...o, review: r } : o));
                        setReviewSheetOrder(null);
                        showToast(t('orderActions.reviewSaved'), 'success');
                    }}
                />
            )}
            {reportSheetOrder && (
                <ReportProblemSheet
                    orderId={reportSheetOrder.id}
                    onClose={() => setReportSheetOrder(null)}
                    onReported={() => {
                        setReportSheetOrder(null);
                        showToast(t('orderActions.reportSent'), 'success');
                        fetchTab('purchases');
                    }}
                />
            )}
            {shipSheet && (
                <ShipMethodSheet
                    mode={shipSheet.mode}
                    pickup={pickupInfo}
                    onClose={() => setShipSheet(null)}
                    onEditAddress={() => {
                        setShipSheet(null);
                        const path = window.location.pathname;
                        const prefix = path === '/en' || path.startsWith('/en/') ? '/en' : '';
                        router.push(`${prefix}/settings?tab=profile`);
                    }}
                    onChoose={(method) => {
                        const sheet = shipSheet;
                        setShipSheet(null);
                        if (sheet.mode === 'create') createLabel(sheet.orderIds, undefined, method);
                        else bookPickup(sheet.trackingNumber);
                    }}
                />
            )}
            {handoffSheet && (
                <ShippedElsewhereSheet
                    busy={handoffBusy}
                    onClose={() => setHandoffSheet(null)}
                    onSubmit={(carrier, trackingNumber) => handOffParcel(handoffSheet.orderIds, carrier, trackingNumber)}
                />
            )}
            {selfShipSheet && (
                <ShippedElsewhereSheet
                    mode="self"
                    recipient={selfShipSheet.recipient}
                    busy={selfShipBusy}
                    onClose={() => setSelfShipSheet(null)}
                    onSubmit={(carrier, trackingNumber) => shipSelf(selfShipSheet.orderIds, carrier, trackingNumber)}
                />
            )}
        </div>
    );
}
