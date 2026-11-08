'use client'

import { useEffect, useState } from 'react'
import { FLAG_TONE_CLASS, ORDER_STATUS_TONE, personName, statusLabel, type AdminContact, type AdminOrderListItem } from '@/lib/adminOrders'
import { LISTING_STATUS_TONE, type AdminAccountOverview } from '@/lib/adminAccount'
import { Spinner, initials, when } from './inbox/_parts'

// What is going on with a person's account, opened over the inbox or the
// order lookup without leaving the conversation: who they are and how to
// reach them, then their sales, purchases and listings with status. Every
// order links into the order lookup; actions stay where they live.

type Tab = 'sales' | 'purchases' | 'listings'

export function AccountDrawer({ userId, onClose, onOpenOrder }: {
    userId: string
    onClose: () => void
    /** Open an order in place instead of a new tab (the order lookup passes this). */
    onOpenOrder?: (orderId: string) => void
}) {
    const [data, setData] = useState<AdminAccountOverview | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [tab, setTab] = useState<Tab | null>(null)

    useEffect(() => {
        let cancelled = false
        setData(null)
        setError(null)
        setTab(null)
        fetch(`/api/admin/users/${userId}/overview`, { cache: 'no-store' })
            .then(async res => {
                if (cancelled) return
                if (!res.ok) {
                    setError(res.status === 404 ? 'No account found for this person.' : `Could not load the account (${res.status}).`)
                    return
                }
                const body = await res.json()
                if (!cancelled) setData(body.overview)
            })
            .catch(() => { if (!cancelled) setError('Could not load the account.') })
        return () => { cancelled = true }
    }, [userId])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const c = data?.contact
    const name = c?.display_name?.trim() || c?.username || 'Account'
    // Open on whichever side of the marketplace they are active on.
    const activeTab: Tab = tab ?? (data
        ? (data.stats.ordersAsSeller > 0 || data.stats.activeListings > 0 ? 'sales' : data.stats.ordersAsBuyer > 0 ? 'purchases' : 'listings')
        : 'sales')

    return (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`${name} account`}>
            <div className="absolute inset-0 bg-black/60" onClick={onClose} />
            <aside className="relative h-full w-full max-w-2xl bg-brand-darker border-l border-white/10 shadow-2xl flex flex-col animate-fadeIn">
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/5">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-xs font-black text-slate-300 shrink-0">
                            {c?.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : initials(name)}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase text-slate-500">Account</p>
                            <h2 className="text-base font-black text-white truncate">{name}</h2>
                            <p className="text-[11px] text-slate-500 truncate">
                                {c?.username ? `@${c.username}` : ''}
                                {c?.joinedAt ? `${c?.username ? ' · ' : ''}joined ${new Date(c.joinedAt).toLocaleDateString()}` : ''}
                                {c?.role && c.role !== 'user' ? ` · ${c.role}` : ''}
                            </p>
                            {c && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                    {c.bannedAt && <Chip tone="red">Banned</Chip>}
                                    {c.chatBannedUntil && (c.chatBannedUntil === 'infinity' || Date.parse(c.chatBannedUntil) > Date.now()) && <Chip tone="amber">Chat suspended</Chip>}
                                    {c.stripe?.chargesEnabled
                                        ? <Chip tone="green">Stripe verified seller</Chip>
                                        : c.stripe?.hasAccount
                                            ? <Chip tone="amber">{c.stripe.detailsSubmitted ? 'Stripe reviewing' : 'Stripe setup unfinished'}</Chip>
                                            : null}
                                    {data && data.stats.openTickets > 0 && <Chip tone="amber">{data.stats.openTickets} open ticket{data.stats.openTickets === 1 ? '' : 's'}</Chip>}
                                    {data && data.stats.needsAttention > 0 && <Chip tone="red">{data.stats.needsAttention} order{data.stats.needsAttention === 1 ? ' needs' : 's need'} attention</Chip>}
                                </div>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 shrink-0" aria-label="Close">
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
                    {error ? (
                        <p className="text-center text-rose-300 text-sm py-10">{error}</p>
                    ) : !data || !c ? (
                        <Spinner size="h-8 w-8" />
                    ) : (
                        <>
                            <ContactBlock contact={c} supportThreadId={data.supportThreadId} />

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <Stat label="Active listings" value={data.stats.activeListings} />
                                <Stat label="Sold" value={data.stats.soldListings} />
                                <Stat label="Sales" value={data.stats.ordersAsSeller} />
                                <Stat label="Purchases" value={data.stats.ordersAsBuyer} />
                            </div>

                            <div className="flex gap-1.5 flex-wrap">
                                <TabChip active={activeTab === 'sales'} onClick={() => setTab('sales')} label={`Sales (${data.stats.ordersAsSeller})`} />
                                <TabChip active={activeTab === 'purchases'} onClick={() => setTab('purchases')} label={`Purchases (${data.stats.ordersAsBuyer})`} />
                                <TabChip active={activeTab === 'listings'} onClick={() => setTab('listings')} label={`Listings (${data.stats.activeListings} active)`} />
                            </div>

                            {activeTab === 'listings' ? (
                                <ListingList overview={data} />
                            ) : (
                                <OrderList
                                    orders={activeTab === 'sales' ? data.sellerOrders : data.buyerOrders}
                                    total={activeTab === 'sales' ? data.stats.ordersAsSeller : data.stats.ordersAsBuyer}
                                    side={activeTab}
                                    contact={c}
                                    onOpenOrder={onOpenOrder}
                                />
                            )}
                        </>
                    )}
                </div>
            </aside>
        </div>
    )
}

function ContactBlock({ contact: c, supportThreadId }: { contact: AdminContact; supportThreadId: string | null }) {
    return (
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-2">
            <div className="space-y-1.5 text-sm">
                <ContactRow icon="fa-regular fa-envelope" value={c.email} href={c.email ? `mailto:${c.email}` : null} missing="No email on file" />
                <ContactRow icon="fa-solid fa-phone" value={c.phone} href={c.phone ? `tel:${c.phone}` : null} missing="No phone on file" />
                <div className="flex items-start gap-2">
                    <i className="fa-solid fa-location-dot text-slate-500 text-xs mt-1 w-3.5 text-center shrink-0" />
                    {c.address
                        ? <p className="text-xs text-slate-300 leading-relaxed flex-1">{c.address}</p>
                        : <p className="text-xs text-slate-600 flex-1">No address on file</p>}
                    {c.address && <CopyButton text={c.address} />}
                </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
                <a
                    href={supportThreadId ? `/admin/inbox?open=dm:${supportThreadId}` : `/admin/inbox?dm=${c.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan/15 border border-brand-cyan/30 text-brand-cyan text-xs font-bold hover:bg-brand-cyan/25 transition"
                >
                    <i className="fa-regular fa-comment" />{supportThreadId ? 'Open support chat' : 'Message in support chat'}
                </a>
                {c.username && (
                    <a href={`/seller/${c.username}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs font-bold hover:bg-white/10 transition">
                        <i className="fa-solid fa-store" />Shop page
                    </a>
                )}
                <a href={`/admin/orders?q=${encodeURIComponent(c.username || c.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs font-bold hover:bg-white/10 transition">
                    <i className="fa-solid fa-list" />All their orders
                </a>
            </div>
        </div>
    )
}

function OrderList({ orders, total, side, contact, onOpenOrder }: {
    orders: AdminOrderListItem[]
    total: number
    side: 'sales' | 'purchases'
    contact: AdminContact
    onOpenOrder?: (orderId: string) => void
}) {
    if (orders.length === 0) {
        return <p className="text-sm text-slate-500 text-center py-8">{side === 'sales' ? 'Nothing sold yet.' : 'Nothing bought yet.'}</p>
    }
    return (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="divide-y divide-white/5">
                {orders.map(o => {
                    const other = side === 'sales' ? o.buyer : o.seller
                    const inner = (
                        <>
                            <div className="w-9 h-12 rounded bg-white/5 overflow-hidden shrink-0 flex items-center justify-center">
                                {o.itemImage ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={o.itemImage} alt="" className="w-full h-full object-cover" />
                                ) : <i className="fa-regular fa-image text-slate-600 text-xs" />}
                            </div>
                            <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-white font-mono">#{o.shortId}</span>
                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border ${ORDER_STATUS_TONE[o.status] ?? 'bg-white/5 text-slate-400 border-white/10'}`}>{statusLabel(o.status)}</span>
                                    <span className="ml-auto text-[10px] text-slate-500 shrink-0">{when(o.createdAt)}</span>
                                </div>
                                <p className="text-[11px] text-slate-300 truncate">
                                    {o.itemName ?? 'Card order'}{o.checkoutSize > 1 ? ` +${o.checkoutSize - 1} more` : ''}
                                    <span className="text-slate-500"> · {side === 'sales' ? 'to' : 'from'} {personName(other)}</span>
                                </p>
                                {o.flags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {o.flags.map(f => (
                                            <span key={f.code} className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${FLAG_TONE_CLASS[f.tone]}`}>{f.label}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <span className="text-xs font-bold text-slate-200 shrink-0">฿{Math.round(o.totalAmount).toLocaleString()}</span>
                        </>
                    )
                    const cls = 'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition text-left'
                    return onOpenOrder
                        ? <button key={o.id} onClick={() => onOpenOrder(o.id)} className={cls}>{inner}</button>
                        : <a key={o.id} href={`/admin/orders?q=${o.id}`} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
                })}
            </div>
            {total > orders.length && (
                <a href={`/admin/orders?q=${encodeURIComponent(contact.username || contact.id)}`} target="_blank" rel="noopener noreferrer" className="block px-3 py-2 text-center text-[11px] font-bold text-brand-cyan hover:underline border-t border-white/5">
                    Showing the latest {orders.length} of {total}. See all in the order lookup
                </a>
            )}
        </div>
    )
}

function ListingList({ overview }: { overview: AdminAccountOverview }) {
    if (overview.listings.length === 0) return <p className="text-sm text-slate-500 text-center py-8">No listings.</p>
    return (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/5">
            {overview.listings.map(l => (
                <a
                    key={l.id}
                    href={l.cardId ? `/card/${l.cardId}` : '#'}
                    target={l.cardId ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition"
                >
                    <div className="w-9 h-12 rounded bg-white/5 overflow-hidden shrink-0 flex items-center justify-center">
                        {l.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={l.image} alt="" className="w-full h-full object-cover" />
                        ) : <i className="fa-regular fa-image text-slate-600 text-xs" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-200 truncate">{l.name ?? 'Card'}</p>
                        <p className="text-[11px] text-slate-500">
                            {l.condition ?? ''}{l.condition ? ' · ' : ''}listed {new Date(l.createdAt).toLocaleDateString()}{l.soldAt ? ` · sold ${new Date(l.soldAt).toLocaleDateString()}` : ''}
                        </p>
                    </div>
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full border shrink-0 ${LISTING_STATUS_TONE[l.status] ?? 'bg-white/5 text-slate-400 border-white/10'}`}>{l.status}</span>
                    <span className="text-xs font-bold text-slate-200 shrink-0">฿{Math.round(l.price).toLocaleString()}</span>
                </a>
            ))}
            <p className="px-3 py-2 text-[10px] text-slate-600">Drafts are not shown. Remove a listing from User Reports.</p>
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
                    <CopyButton text={value} />
                </>
            ) : <span className="text-xs text-slate-600">{missing}</span>}
        </div>
    )
}

function CopyButton({ text }: { text: string }) {
    const [done, setDone] = useState(false)
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setDone(true)
            setTimeout(() => setDone(false), 1500)
        } catch { /* clipboard blocked */ }
    }
    return (
        <button onClick={copy} title="Copy" className="text-slate-600 hover:text-brand-cyan transition shrink-0">
            <i className={`${done ? 'fa-solid fa-check text-emerald-300' : 'fa-regular fa-copy'} text-[11px]`} />
        </button>
    )
}

function Chip({ tone, children }: { tone: 'red' | 'amber' | 'green'; children: React.ReactNode }) {
    const cls = {
        red: 'bg-brand-red/15 text-rose-300 border-brand-red/30',
        amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    }[tone]
    return <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${cls}`}>{children}</span>
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg bg-white/[0.03] px-3 py-2 min-w-0">
            <p className="text-[9px] font-bold uppercase text-slate-500 truncate">{label}</p>
            <p className="text-sm font-bold text-slate-200">{value.toLocaleString()}</p>
        </div>
    )
}

function TabChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${active
                ? 'bg-brand-cyan/15 border-brand-cyan/40 text-brand-cyan'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'}`}
        >
            {label}
        </button>
    )
}
