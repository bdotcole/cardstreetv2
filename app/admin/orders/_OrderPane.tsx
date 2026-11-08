'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
    FLAG_TONE_CLASS, ORDER_STATUS_TONE, flashTrackingUrl, personName, statusLabel,
    type AdminContact, type AdminOrderDetail,
} from '@/lib/adminOrders'
import { Spinner, StatusChip, initials } from '../inbox/_parts'

// One order for the support team: what was bought, where the parcel is, who
// the buyer and seller are and how to reach them, and every ticket or chat
// already open with either of them. One write: Cancel and refund
// (/api/admin/orders/[id]/refund -> lib/orderRefunds), which used to be a
// Stripe dashboard refund plus hand-written SQL every time. Everything else
// stays where it was (problem reports close on their ticket in the inbox,
// bans on User Reports), each one a link away.

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : null)
const baht = (n: number) => `฿${Math.round(n).toLocaleString()}`

// Statuses lib/orderRefunds accepts from an admin: paid through delivered,
// and a disputed order. Completed orders have released funds; pending ones
// have no money to return.
const REFUNDABLE = new Set(['paid', 'processing', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'disputed'])

export function OrderPane({ orderId, onOpenOrder, onShowAccount }: {
    orderId: string
    onOpenOrder: (id: string) => void
    /** Opens the account drawer (listings, sales, purchases) for the buyer or seller. */
    onShowAccount?: (userId: string) => void
}) {
    const [order, setOrder] = useState<AdminOrderDetail | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [refundOpen, setRefundOpen] = useState(false)
    const [refundNote, setRefundNote] = useState('')
    const [refundScope, setRefundScope] = useState<'order' | 'checkout'>('order')
    const [alreadyRefunded, setAlreadyRefunded] = useState(false)
    const [refundBusy, setRefundBusy] = useState(false)
    const [refundError, setRefundError] = useState<string | null>(null)

    const load = useCallback(async (signal?: { cancelled: boolean }) => {
        try {
            const res = await fetch(`/api/admin/orders/${orderId}`, { cache: 'no-store' })
            if (signal?.cancelled) return
            if (!res.ok) {
                setError(res.status === 404 ? 'That order was not found.' : `Could not load the order (${res.status}).`)
                return
            }
            const data = await res.json()
            if (!signal?.cancelled) setOrder(data.order)
        } catch {
            if (!signal?.cancelled) setError('Could not load the order.')
        }
    }, [orderId])

    useEffect(() => {
        const signal = { cancelled: false }
        setOrder(null)
        setError(null)
        setRefundOpen(false)
        setRefundError(null)
        void load(signal)
        return () => { signal.cancelled = true }
    }, [orderId, load])

    const submitRefund = async () => {
        if (!order || refundBusy) return
        const what = refundScope === 'checkout' && order.checkoutSize > 1
            ? `all ${order.checkoutSize} orders in this checkout`
            : `order #${order.shortId}`
        const money = alreadyRefunded
            ? 'No new Stripe refund is made; the order is recorded as refunded.'
            : "The buyer is refunded from the seller's Stripe balance."
        if (!window.confirm(`Cancel and refund ${what}? ${money} This cannot be undone.`)) return
        setRefundBusy(true)
        setRefundError(null)
        try {
            const res = await fetch(`/api/admin/orders/${orderId}/refund`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: refundNote, scope: refundScope, alreadyRefunded }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setRefundError(data?.error || `Refund failed (${res.status})`)
                return
            }
            setRefundOpen(false)
            setRefundNote('')
            await load()
        } catch (e) {
            setRefundError(e instanceof Error ? e.message : 'Refund failed')
        } finally {
            setRefundBusy(false)
        }
    }

    if (error) return <p className="text-center text-rose-300 text-sm py-10">{error}</p>
    if (!order) return <Spinner size="h-8 w-8" />

    const parcel = order.parcel
    const waybill = parcel?.trackingNumber && !['PENDING', 'MANUAL', 'N/A'].includes(parcel.trackingNumber) ? parcel.trackingNumber : null
    const trackingNumber = parcel?.handoffTrackingNumber || waybill
    const trackingUrl = parcel?.handoffTrackingNumber ? null : parcel?.trackingUrl ?? (waybill ? flashTrackingUrl(waybill) : null)

    const summary = [
        `Order #${order.shortId} (${order.id})`,
        `Status: ${statusLabel(order.status)}${order.flags.length ? ` · ${order.flags.map(f => f.label).join(', ')}` : ''}`,
        `Items: ${order.items.map(i => `${i.name ?? 'Card'} ${baht(i.amount)}`).join('; ')}`,
        `Total: ${baht(order.amounts.total)}`,
        trackingNumber ? `Tracking: ${trackingNumber}${parcel?.carrier ? ` (${parcel.carrier})` : ''}` : 'Tracking: no label yet',
        `Buyer: ${contactLine(order.buyerContact)}`,
        `Seller: ${contactLine(order.sellerContact)}`,
        `Admin: ${typeof window !== 'undefined' ? window.location.origin : ''}/admin/orders?q=${order.id}`,
    ].join('\n')

    return (
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden space-y-3 pr-1">
            {/* Header */}
            <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-lg font-black text-white font-mono">#{order.shortId}</h2>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${ORDER_STATUS_TONE[order.status] ?? 'bg-white/5 text-slate-400 border-white/10'}`}>
                                {statusLabel(order.status)}
                            </span>
                            {order.flags.map(f => (
                                <span key={f.code} className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${FLAG_TONE_CLASS[f.tone]}`}>{f.label}</span>
                            ))}
                        </div>
                        <p className="text-[11px] text-slate-500">
                            Placed {fmt(order.createdAt)}
                            {order.checkoutSize > 1 ? ` · ${order.checkoutSize} orders in this checkout` : ''}
                            {order.isBreakOrder ? ' · live break spot' : ''}
                        </p>
                        <CopyLine label="Order id" value={order.id} mono />
                    </div>
                    <CopyButton text={summary} label="Copy summary" icon="fa-regular fa-clipboard" />
                </div>

                <div className="divide-y divide-white/5 rounded-xl border border-white/5 overflow-hidden">
                    {order.items.map(item => (
                        <div key={item.orderId} className={`flex items-center gap-3 px-3 py-2 ${item.orderId === order.id ? 'bg-white/[0.03]' : ''}`}>
                            <div className="w-9 h-12 rounded bg-white/5 overflow-hidden shrink-0 flex items-center justify-center">
                                {item.image ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={item.image} alt="" className="w-full h-full object-cover" />
                                ) : <i className="fa-regular fa-image text-slate-600 text-xs" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm text-slate-200 truncate">
                                    {item.cardId ? (
                                        <a href={`/card/${item.cardId}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-cyan transition">{item.name ?? 'Card'}</a>
                                    ) : (item.name ?? 'Card')}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                    {[item.condition, item.graded].filter(Boolean).join(' · ') || 'Raw'}
                                    {item.orderId !== order.id && (
                                        <>
                                            {' · '}
                                            <button onClick={() => onOpenOrder(item.orderId)} className="text-brand-cyan hover:underline font-mono">#{item.orderId.slice(0, 8).toUpperCase()}</button>
                                        </>
                                    )}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-sm font-bold text-slate-200">{baht(item.amount)}</p>
                                {item.status !== order.status && <p className="text-[10px] text-slate-500">{statusLabel(item.status)}</p>}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 text-[11px]">
                    <Stat label="Buyer paid" value={baht(order.amounts.total)} />
                    <Stat label="Shipping inside" value={baht(order.amounts.shipping)} />
                    <Stat label="Cardstreet fee" value={baht(order.amounts.platformFee)} />
                    <Stat label="Seller gets" value={baht(order.amounts.total - order.amounts.platformFee - order.amounts.discount)} hint="before Stripe's fee" />
                </div>
                {(order.payment.intentId || order.payment.method) && (
                    <p className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                        {order.payment.method && <span>Paid by {order.payment.method}</span>}
                        {order.payment.intentId && <CopyLine label="Stripe" value={order.payment.intentId} mono />}
                    </p>
                )}
            </div>

            {/* Problem report / refund / review */}
            {(order.dispute || order.refund || order.review) && (
                <div className="glass rounded-2xl border border-white/10 p-4 space-y-2">
                    {order.dispute && (
                        <div className={`rounded-xl border p-3 space-y-1 ${order.dispute.outcome ? 'border-white/10 bg-white/[0.02]' : 'border-brand-red/30 bg-brand-red/5'}`}>
                            <p className="text-[10px] font-bold uppercase text-rose-300">
                                Problem report{order.times.disputeOpened ? ` · ${fmt(order.times.disputeOpened)}` : ''}
                            </p>
                            <p className="text-sm text-slate-200">{order.dispute.reason?.replace(/_/g, ' ') ?? 'Reason not recorded'}</p>
                            {order.dispute.details && <p className="text-xs text-slate-400 whitespace-pre-wrap">{order.dispute.details}</p>}
                            {order.dispute.outcome
                                ? <p className="text-xs text-emerald-300">Closed: {order.dispute.outcome}{order.times.disputeResolved ? ` · ${fmt(order.times.disputeResolved)}` : ''}</p>
                                : <p className="text-[11px] text-slate-500">Open. Close it from its ticket in the inbox (below), which also answers the buyer.</p>}
                        </div>
                    )}
                    {order.refund && (
                        <p className="text-xs text-slate-300"><i className="fa-solid fa-rotate-left mr-1.5 text-slate-500" />Refunded {fmt(order.refund.at)}{order.refund.note ? `: ${order.refund.note}` : ''}</p>
                    )}
                    {order.review && (
                        <p className="text-xs text-slate-300">
                            <i className="fa-solid fa-star mr-1.5 text-amber-300" />Buyer left {order.review.rating}/5{order.review.comment ? `: “${order.review.comment}”` : ''}
                        </p>
                    )}
                </div>
            )}

            {/* Cancel and refund: Stripe refund from the seller's balance (our fee
                goes back too), order cancelled, card out of the buyer's collection
                when nothing shipped, both sides notified. Idempotent per order. */}
            {REFUNDABLE.has(order.status) && !order.refund && (
                <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cancel and refund</p>
                        {!refundOpen && (
                            <button onClick={() => setRefundOpen(true)} className="text-xs font-bold text-rose-300 hover:text-rose-200 transition-colors">
                                <i className="fa-solid fa-rotate-left mr-1.5" />Cancel and refund…
                            </button>
                        )}
                    </div>
                    {refundOpen && (
                        <div className="space-y-2">
                            <input
                                value={refundNote}
                                onChange={e => setRefundNote(e.target.value)}
                                maxLength={500}
                                placeholder="Reason, kept on the refund record (not shown to the customer)"
                                className="w-full h-10 rounded-xl bg-black/30 border border-white/10 px-3 text-sm text-white placeholder:text-slate-600 outline-none focus:border-brand-cyan/50"
                            />
                            {order.checkoutSize > 1 && (
                                <label className="flex items-center gap-2 text-xs text-slate-300">
                                    <input type="checkbox" checked={refundScope === 'checkout'} onChange={e => setRefundScope(e.target.checked ? 'checkout' : 'order')} />
                                    Refund all {order.checkoutSize} orders in this checkout
                                </label>
                            )}
                            <label className="flex items-center gap-2 text-xs text-slate-300">
                                <input type="checkbox" checked={alreadyRefunded} onChange={e => setAlreadyRefunded(e.target.checked)} />
                                Already refunded in the Stripe dashboard (record it, make no new refund)
                            </label>
                            {refundError && <p className="text-xs text-rose-300">{refundError}</p>}
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={submitRefund}
                                    disabled={refundBusy}
                                    className="h-9 px-4 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-bold hover:bg-rose-500/30 transition-colors disabled:opacity-50"
                                >
                                    {refundBusy ? 'Refunding…' : 'Confirm cancel and refund'}
                                </button>
                                <button
                                    onClick={() => { setRefundOpen(false); setRefundError(null) }}
                                    disabled={refundBusy}
                                    className="h-9 px-3 text-xs font-bold text-slate-400 hover:text-white transition-colors"
                                >
                                    Keep the order
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* People */}
            <div className="grid xl:grid-cols-2 gap-3">
                <PersonCard role="Buyer" contact={order.buyerContact} fallbackName={personName(order.buyer)} addressLabel="Ships to" onShowAccount={onShowAccount} />
                <PersonCard role="Seller" contact={order.sellerContact} fallbackName={personName(order.seller)} addressLabel="Pickup address" onShowAccount={onShowAccount} />
            </div>

            {/* Parcel + timeline */}
            <div className="grid xl:grid-cols-2 gap-3">
                <div className="glass rounded-2xl border border-white/10 p-4 space-y-2 min-w-0">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Parcel</p>
                    {!parcel ? (
                        <p className="text-sm text-slate-400">No label yet. The seller creates it from their To ship list; the safety-net cron mints one a day after payment.</p>
                    ) : (
                        <div className="space-y-1.5 text-sm">
                            {trackingNumber ? (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <CopyLine label={parcel.carrier ?? 'Tracking'} value={trackingNumber} mono strong />
                                    {trackingUrl && (
                                        <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-brand-cyan hover:underline">Track <i className="fa-solid fa-arrow-up-right-from-square text-[9px]" /></a>
                                    )}
                                </div>
                            ) : parcel.trackingNumber === 'MANUAL' ? (
                                <p className="text-amber-300 text-sm">Flash refused the address; the seller ships this one by hand.</p>
                            ) : (
                                <p className="text-slate-400 text-sm">Label being created…</p>
                            )}
                            <Row k="Label" v={parcel.labelStatus ? parcel.labelStatus.replace(/_/g, ' ') : null} />
                            {parcel.handedOffAt
                                ? <Row k="Handed off" v={`${fmt(parcel.handedOffAt)} via ${parcel.handoffCarrier ?? 'another carrier'}`} />
                                : <Row k="Pickup" v={parcel.pickupStatus === 'cancelled'
                                    ? `Courier cancelled${parcel.pickupCancelledAt ? ` ${fmt(parcel.pickupCancelledAt)}` : ''}; seller must book again or drop it off`
                                    : parcel.pickupStatus === 'dropoff' ? 'Seller drops it at a Flash branch'
                                        : parcel.pickupStatus === 'scheduled' ? 'Courier booked'
                                            : parcel.pickupStatus === 'manual' ? 'No courier (manual)'
                                                : parcel.pickupStatus} />}
                            {parcel.labelUrl && (
                                <a href={parcel.labelUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-[11px] font-bold text-brand-cyan hover:underline">
                                    <i className="fa-solid fa-file-pdf mr-1" />Label PDF
                                </a>
                            )}
                        </div>
                    )}
                </div>

                <div className="glass rounded-2xl border border-white/10 p-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase text-slate-500">Timeline</p>
                    <div className="space-y-1 text-sm">
                        <Row k="Paid" v={fmt(order.times.created)} />
                        <Row k="Label created" v={fmt(order.times.labelCreated)} />
                        <Row k="Handed off" v={fmt(order.times.handedOff)} />
                        <Row k="Delivered" v={fmt(order.times.delivered)} />
                        <Row k="Completed" v={fmt(order.times.completed)} />
                        <Row k="Problem reported" v={fmt(order.times.disputeOpened)} />
                        <Row k="Report closed" v={fmt(order.times.disputeResolved)} />
                        <Row k="Last change" v={fmt(order.updatedAt)} />
                        {order.times.shipReminders > 0 && (
                            <Row k="Ship reminders" v={`${order.times.shipReminders} sent to the seller${order.times.lastShipReminder ? `, last ${fmt(order.times.lastShipReminder)}` : ''}${order.times.shipReminders >= 3 ? ' (inbox paged at 72h)' : ''}`} />
                        )}
                    </div>
                </div>
            </div>

            {/* Support history */}
            <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
                <p className="text-[10px] font-bold uppercase text-slate-500">Support history</p>
                {order.tickets.length === 0 && order.threads.length === 0 && (
                    <p className="text-sm text-slate-500">No tickets or support chats with either of them yet.</p>
                )}
                {order.tickets.length > 0 && (
                    <div className="space-y-1">
                        {order.tickets.map(t => (
                            <a
                                key={t.id}
                                href={`/admin/inbox?open=ticket:${t.id}`}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition text-sm"
                            >
                                <i className="fa-solid fa-ticket text-amber-300 text-xs shrink-0" />
                                <span className="truncate flex-1 text-slate-200">{t.subject}</span>
                                {t.aboutThisOrder && <span className="text-[9px] font-black uppercase text-brand-cyan shrink-0">This order</span>}
                                <span className="text-[10px] text-slate-500 shrink-0">
                                    {t.userId === order.buyer?.id ? 'buyer' : t.userId === order.seller?.id ? 'seller' : ''}
                                </span>
                                <StatusChip status={t.status} />
                            </a>
                        ))}
                    </div>
                )}
                {order.threads.length > 0 && (
                    <div className="space-y-1">
                        {order.threads.map(th => (
                            <a
                                key={th.id}
                                href={`/admin/inbox?open=dm:${th.id}`}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition text-sm"
                            >
                                <i className="fa-regular fa-comment text-brand-cyan text-xs shrink-0" />
                                <span className="text-slate-400 shrink-0">
                                    Support chat with {th.personId === order.buyer?.id ? 'the buyer' : 'the seller'}
                                </span>
                                <span className="truncate flex-1 text-slate-500 text-xs">{th.preview ?? ''}</span>
                                {th.unread && <span className="w-2 h-2 rounded-full bg-brand-cyan shrink-0" aria-label="Unread" />}
                                <span className="text-[10px] text-slate-500 shrink-0">{th.lastMessageAt ? new Date(th.lastMessageAt).toLocaleDateString() : ''}</span>
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function contactLine(c: AdminContact | null): string {
    if (!c) return 'unknown'
    const bits = [c.display_name?.trim() || c.username || c.id, c.username ? `@${c.username}` : null, c.email, c.phone].filter(Boolean)
    return bits.join(' · ')
}

function PersonCard({ role, contact, fallbackName, addressLabel, onShowAccount }: {
    role: string
    contact: AdminContact | null
    fallbackName: string
    addressLabel: string
    onShowAccount?: (userId: string) => void
}) {
    const name = contact?.display_name?.trim() || contact?.username || fallbackName
    const banned = !!contact?.bannedAt
    const chatBanned = contact?.chatBannedUntil ? Date.parse(contact.chatBannedUntil) > Date.now() || contact.chatBannedUntil === 'infinity' : false
    return (
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-[11px] font-black text-slate-300 shrink-0">
                    {contact?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={contact.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : initials(name)}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase text-slate-500">{role}</p>
                    <p className="text-sm font-black text-white truncate">{name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                        {contact?.username ? `@${contact.username}` : ''}
                        {contact?.joinedAt ? `${contact?.username ? ' · ' : ''}joined ${new Date(contact.joinedAt).toLocaleDateString()}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                        {banned && <Chip tone="red">Banned</Chip>}
                        {chatBanned && <Chip tone="amber">Chat suspended</Chip>}
                        {contact?.stripe && (
                            contact.stripe.chargesEnabled
                                ? <Chip tone="green">Stripe verified</Chip>
                                : contact.stripe.hasAccount
                                    ? <Chip tone="amber">{contact.stripe.detailsSubmitted ? 'Stripe reviewing' : 'Stripe setup unfinished'}</Chip>
                                    : <Chip tone="slate">No Stripe account</Chip>
                        )}
                    </div>
                </div>
            </div>

            {!contact ? (
                <p className="text-xs text-slate-500">No profile found for this account.</p>
            ) : (
                <div className="space-y-1.5 text-sm">
                    <ContactRow icon="fa-regular fa-envelope" value={contact.email} href={contact.email ? `mailto:${contact.email}` : null} missing="No email on file" />
                    <ContactRow icon="fa-solid fa-phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : null} missing="No phone on file" />
                    <div className="flex items-start gap-2">
                        <i className="fa-solid fa-location-dot text-slate-500 text-xs mt-1 w-3.5 text-center shrink-0" />
                        {contact.address
                            ? <p className="text-xs text-slate-300 leading-relaxed flex-1"><span className="text-slate-500">{addressLabel}: </span>{contact.address}</p>
                            : <p className="text-xs text-slate-600 flex-1">No address on file</p>}
                        {contact.address && <CopyButton text={contact.address} compact />}
                    </div>
                </div>
            )}

            {contact && (
                <div className="flex flex-wrap gap-2 pt-1">
                    {onShowAccount && (
                        <button onClick={() => onShowAccount(contact.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-bold hover:bg-white/10 transition">
                            <i className="fa-regular fa-id-card" />Account
                        </button>
                    )}
                    <a
                        href={`/admin/inbox?dm=${contact.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan/15 border border-brand-cyan/30 text-brand-cyan text-xs font-bold hover:bg-brand-cyan/25 transition"
                    >
                        <i className="fa-regular fa-comment" />Message in support chat
                    </a>
                    {contact.username && (
                        <a href={`/seller/${contact.username}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs font-bold hover:bg-white/10 transition">
                            <i className="fa-solid fa-store" />Shop page
                        </a>
                    )}
                    <a href={`/admin/orders?q=${encodeURIComponent(contact.username || contact.id)}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs font-bold hover:bg-white/10 transition">
                        <i className="fa-solid fa-list" />All their orders
                    </a>
                </div>
            )}
        </div>
    )
}

function ContactRow({ icon, value, href, missing }: { icon: string; value: string | null; href: string | null; missing: string }) {
    return (
        <div className="flex items-center gap-2">
            <i className={`${icon} text-slate-500 text-xs w-3.5 text-center shrink-0`} />
            {value ? (
                <>
                    {href ? <a href={href} className="text-slate-200 hover:text-brand-cyan transition break-all flex-1">{value}</a> : <span className="text-slate-200 break-all flex-1">{value}</span>}
                    <CopyButton text={value} compact />
                </>
            ) : <span className="text-xs text-slate-600">{missing}</span>}
        </div>
    )
}

function Chip({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'slate'; children: ReactNode }) {
    const cls = {
        red: 'bg-brand-red/15 text-rose-300 border-brand-red/30',
        amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        slate: 'bg-white/5 text-slate-400 border-white/10',
    }[tone]
    return <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${cls}`}>{children}</span>
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-lg bg-white/[0.03] px-3 py-2 min-w-0">
            <p className="text-[9px] font-bold uppercase text-slate-500 truncate">{label}</p>
            <p className="text-sm font-bold text-slate-200">{value}</p>
            {hint && <p className="text-[9px] text-slate-600">{hint}</p>}
        </div>
    )
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
    if (!v) return null
    return (
        <p className="text-xs flex gap-2">
            <span className="text-slate-500 w-28 shrink-0">{k}</span>
            <span className="text-slate-300 min-w-0 break-words">{v}</span>
        </p>
    )
}

function CopyLine({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-[11px] min-w-0">
            <span className="text-slate-500">{label}</span>
            <span className={`${mono ? 'font-mono' : ''} ${strong ? 'text-sm font-bold text-white' : 'text-slate-400'} truncate`}>{value}</span>
            <CopyButton text={value} compact />
        </span>
    )
}

function CopyButton({ text, label, icon, compact }: { text: string; label?: string; icon?: string; compact?: boolean }) {
    const [done, setDone] = useState(false)
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setDone(true)
            setTimeout(() => setDone(false), 1500)
        } catch { /* clipboard blocked: nothing to do */ }
    }
    if (compact) {
        return (
            <button onClick={copy} title="Copy" className="text-slate-600 hover:text-brand-cyan transition shrink-0">
                <i className={`${done ? 'fa-solid fa-check text-emerald-300' : 'fa-regular fa-copy'} text-[11px]`} />
            </button>
        )
    }
    return (
        <button onClick={copy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs font-bold hover:bg-white/10 transition shrink-0">
            <i className={done ? 'fa-solid fa-check text-emerald-300' : icon ?? 'fa-regular fa-copy'} />{done ? 'Copied' : label ?? 'Copy'}
        </button>
    )
}
