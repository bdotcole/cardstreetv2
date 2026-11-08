'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    FLAG_TONE_CLASS, ORDER_STATUS_TONE, personName, statusLabel, worstTone, type AdminOrderListItem,
} from '@/lib/adminOrders'
import { Spinner, when } from '../inbox/_parts'
import { OrderPane } from './_OrderPane'

// The order lookup for the support team: paste whatever the buyer or seller
// gave you (an order #, a waybill, their name, email or phone) and open the
// order with both parties' contact details. Without a search it lists the
// open orders that need someone: a problem report, a parcel not shipped, a
// courier that never came, a parcel that stopped moving.

type View = 'attention' | 'recent' | 'search'

export default function AdminOrdersPage() {
    return (
        <Suspense fallback={<Spinner size="h-8 w-8" />}>
            <OrdersLookup />
        </Suspense>
    )
}

function OrdersLookup() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const q = (searchParams?.get('q') ?? '').trim()
    const urlView: View = searchParams?.get('view') === 'recent' ? 'recent' : 'attention'

    const [input, setInput] = useState(q)
    const [view, setView] = useState<View>(q ? 'search' : urlView)
    const [items, setItems] = useState<AdminOrderListItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [openId, setOpenId] = useState<string | null>(null)
    const requestRef = useRef(0)

    const load = useCallback(async (query: string, wanted: View) => {
        const seq = ++requestRef.current
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams()
            if (query) params.set('q', query)
            else params.set('view', wanted === 'recent' ? 'recent' : 'attention')
            const res = await fetch(`/api/admin/orders?${params}`, { cache: 'no-store' })
            if (seq !== requestRef.current) return
            if (!res.ok) {
                setError(`Could not load orders (${res.status})`)
                setItems([])
                return
            }
            const data = await res.json()
            if (seq !== requestRef.current) return
            const list: AdminOrderListItem[] = data.items ?? []
            setItems(list)
            setView(data.view ?? wanted)
            // One hit (an id or a waybill) opens itself.
            if (query && list.length === 1) setOpenId(list[0].id)
        } catch {
            if (seq === requestRef.current) setError('Could not load orders')
        } finally {
            if (seq === requestRef.current) setLoading(false)
        }
    }, [])

    // The URL is the source of truth (?q= for a search, ?view=recent), so the
    // header search box and alert emails (/admin/orders?q=<id>) land here the
    // same way and the back button works.
    useEffect(() => {
        setInput(q)
        setOpenId(null)
        load(q, q ? 'search' : urlView)
    }, [q, urlView, load])

    const submit = (e: React.FormEvent) => {
        e.preventDefault()
        const next = input.trim()
        if (next === q) { load(q, 'search'); return }
        router.push(next ? `/admin/orders?q=${encodeURIComponent(next)}` : '/admin/orders')
    }

    const showView = (wanted: 'attention' | 'recent') => {
        setOpenId(null)
        setInput('')
        const target = wanted === 'recent' ? '/admin/orders?view=recent' : '/admin/orders'
        if (q || wanted !== urlView) router.push(target)
        else load('', wanted)
    }

    const subtitle = loading
        ? 'Loading…'
        : view === 'search'
            ? `${items.length} order${items.length === 1 ? '' : 's'} for “${q}”`
            : view === 'recent'
                ? 'Latest orders, any status'
                : `${items.length} open order${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} someone`

    return (
        <div className="flex flex-col lg:flex-row gap-6 animate-fadeIn lg:h-[calc(100vh-10.5rem)]">
            <div className={`flex-col space-y-3 lg:w-[24rem] lg:shrink-0 lg:flex min-h-0 ${openId ? 'hidden' : 'flex'}`}>
                <div>
                    <h1 className="text-xl font-black text-white italic">Orders</h1>
                    <p className="text-slate-500 text-sm">{subtitle}</p>
                </div>

                <form onSubmit={submit} className="flex gap-2">
                    <div className="relative flex-1">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs" />
                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder="Order #, waybill, name, email or phone"
                            className="w-full bg-white/5 border border-white/10 rounded-xl pl-8 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/50"
                        />
                    </div>
                    <button type="submit" className="px-4 py-2.5 bg-brand-cyan text-brand-darker font-black text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all">
                        Find
                    </button>
                </form>

                <div className="flex flex-wrap items-center gap-1.5">
                    <ViewChip active={view === 'attention'} onClick={() => showView('attention')} icon="fa-solid fa-triangle-exclamation" label="Needs attention" />
                    <ViewChip active={view === 'recent'} onClick={() => showView('recent')} icon="fa-regular fa-clock" label="Recent" />
                    {view === 'search' && (
                        <button onClick={() => showView('attention')} className="ml-auto text-[11px] font-bold text-slate-500 hover:text-slate-300 transition">
                            <i className="fa-solid fa-xmark mr-1" />Clear search
                        </button>
                    )}
                </div>

                <div className="glass rounded-2xl border border-white/10 overflow-hidden flex-1 min-h-0 overflow-y-auto">
                    {loading ? <Spinner size="h-8 w-8" /> : error ? (
                        <p className="px-6 py-16 text-center text-rose-300 text-sm">{error}</p>
                    ) : items.length === 0 ? (
                        <div className="px-6 py-16 text-center space-y-1">
                            <p className="text-slate-400 text-sm font-semibold">
                                {view === 'search' ? 'No order matches that' : view === 'attention' ? 'Nothing needs attention right now' : 'No orders yet'}
                            </p>
                            {view === 'search' && (
                                <p className="text-slate-600 text-xs">Try the 8-character order number from the buyer&apos;s receipt, the Flash waybill, or the person&apos;s username.</p>
                            )}
                        </div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {items.map(item => (
                                <OrderRow key={item.id} item={item} active={openId === item.id} onOpen={() => setOpenId(item.id)} />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {openId ? (
                <div className="flex-1 flex flex-col min-h-0 min-w-0 space-y-3 animate-fadeIn">
                    <button onClick={() => setOpenId(null)} className="self-start text-slate-500 hover:text-slate-300 transition text-xs font-bold">
                        <i className="fa-solid fa-arrow-left mr-1" />
                        <span className="lg:hidden">Back</span>
                        <span className="hidden lg:inline">Close</span>
                    </button>
                    <OrderPane key={openId} orderId={openId} onOpenOrder={setOpenId} />
                </div>
            ) : (
                <div className="hidden lg:flex flex-1 flex-col items-center justify-center gap-2 glass rounded-2xl border border-white/10 text-center px-8">
                    <i className="fa-solid fa-box-open text-2xl text-slate-600" />
                    <p className="text-slate-500 text-sm">Pick an order to see the parcel, the buyer and the seller with their contact details.</p>
                </div>
            )}
        </div>
    )
}

function ViewChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
    return (
        <button
            onClick={onClick}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition inline-flex items-center gap-1.5 ${active
                ? 'bg-brand-cyan/15 border-brand-cyan/40 text-brand-cyan'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'}`}
        >
            <i className={`${icon} text-[10px]`} />{label}
        </button>
    )
}

function OrderRow({ item, active, onOpen }: { item: AdminOrderListItem; active: boolean; onOpen: () => void }) {
    const tone = worstTone(item.flags)
    const dot = tone === 'red' ? 'bg-brand-red' : tone === 'amber' ? 'bg-amber-400' : null
    return (
        <button
            onClick={onOpen}
            className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-white/5 transition-all ${active ? 'bg-brand-cyan/5 border-l-2 border-brand-cyan' : ''}`}
        >
            <div className="w-10 h-14 rounded-md bg-white/5 overflow-hidden shrink-0 flex items-center justify-center">
                {item.itemImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.itemImage} alt="" className="w-full h-full object-cover" />
                ) : (
                    <i className={`${item.isBreakOrder ? 'fa-solid fa-tower-broadcast' : 'fa-regular fa-image'} text-slate-600 text-sm`} />
                )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-white font-mono">#{item.shortId}</p>
                    <span className="text-[10px] text-slate-500 shrink-0">{when(item.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${ORDER_STATUS_TONE[item.status] ?? 'bg-white/5 text-slate-400 border-white/10'}`}>
                        {statusLabel(item.status)}
                    </span>
                    <p className="text-[11px] text-slate-300 truncate flex-1">
                        {item.itemName ?? 'Card order'}{item.checkoutSize > 1 ? ` +${item.checkoutSize - 1} more` : ''}
                    </p>
                    <span className="text-[11px] font-bold text-slate-300 shrink-0">฿{Math.round(item.totalAmount).toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-slate-500 truncate">
                    <span className="text-slate-400">{personName(item.buyer)}</span>
                    <i className="fa-solid fa-arrow-right-long mx-1.5 text-[9px] text-slate-600" />
                    <span className="text-slate-400">{personName(item.seller)}</span>
                    {item.parcel?.trackingNumber && item.parcel.trackingNumber !== 'PENDING' && (
                        <span className="ml-2 font-mono text-slate-600">{item.parcel.handoffTrackingNumber || item.parcel.trackingNumber}</span>
                    )}
                </p>
                {item.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                        {item.flags.map(f => (
                            <span key={f.code} className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${FLAG_TONE_CLASS[f.tone]}`}>
                                {dot && f === item.flags[0] && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
                                {f.label}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </button>
    )
}
