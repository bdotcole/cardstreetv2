'use client'

import { useRef, useState } from 'react'
import type { SoldListingRow, SoldListingsPage } from '@/lib/adminSales.server'

// Order fulfillment stages: yellow = awaiting shipment, cyan = moving, green = done.
const ORDER_STAGE_COLORS: Record<string, string> = {
    paid: 'bg-yellow-500/20 text-yellow-400',
    label_generated: 'bg-yellow-500/20 text-yellow-400',
    shipped: 'bg-brand-cyan/20 text-brand-cyan',
    in_transit: 'bg-brand-cyan/20 text-brand-cyan',
    out_for_delivery: 'bg-brand-cyan/20 text-brand-cyan',
    delivered: 'bg-brand-green/20 text-brand-green',
    completed: 'bg-brand-green/20 text-brand-green',
}

// Fixed locale and time zone: the first page renders on the server (UTC) and
// again in the browser, and both must print the same Bangkok date.
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })
const baht = (n: number) => `฿${n.toLocaleString('en-US')}`

const PAGER_BUTTON = 'px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:hover:bg-white/5 transition'

export default function SoldListings({ initial }: { initial: SoldListingsPage | { error: string } }) {
    const first = 'error' in initial ? null : initial
    const [rows, setRows] = useState<SoldListingRow[]>(first?.rows ?? [])
    const [total, setTotal] = useState(first?.total ?? 0)
    const [page, setPage] = useState(first?.page ?? 1)
    const [pageSize, setPageSize] = useState(first?.pageSize ?? 20)
    const [loading, setLoading] = useState(false)
    // The page that failed rides along so Retry asks for it again, not the one on screen.
    const [error, setError] = useState<{ message: string; page: number } | null>('error' in initial ? { message: initial.error, page: 1 } : null)
    // A slow page must not overwrite a newer one when the pager is clicked fast.
    const latestRequest = useRef(0)

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const load = async (next: number) => {
        const requestId = ++latestRequest.current
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/admin/sales?page=${next}`)
            const data = await res.json().catch(() => ({}))
            if (requestId !== latestRequest.current) return
            if (!res.ok) {
                setError({ message: data?.error ?? 'Could not load sales', page: next })
                return
            }
            setRows(data.rows ?? [])
            setTotal(data.total ?? 0)
            if (data.pageSize) setPageSize(data.pageSize)
            setPage(next)
        } catch {
            if (requestId === latestRequest.current) setError({ message: 'Could not load sales', page: next })
        } finally {
            if (requestId === latestRequest.current) setLoading(false)
        }
    }

    const goTo = (target: number) => {
        const next = Math.min(Math.max(1, target), totalPages)
        if (next !== page) load(next)
    }

    const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1
    const lastRow = Math.min(page * pageSize, total)

    return (
        <div className="glass rounded-2xl border border-white/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between gap-3">
                <h2 className="font-black text-white text-sm uppercase tracking-wide italic">Sold Listings</h2>
                {total > 0 && <p className="text-[10px] text-slate-500 font-bold uppercase">{total.toLocaleString('en-US')} sales</p>}
            </div>
            {rows.length === 0 ? (
                !error && <p className="px-6 py-8 text-center text-slate-500 text-sm">No sales yet</p>
            ) : (
                <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-40 pointer-events-none' : ''}`}>
                    <table className="w-full text-left">
                        <thead>
                            <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-white/5">
                                <th className="px-6 py-3">Card</th>
                                <th className="px-4 py-3">Seller</th>
                                <th className="px-4 py-3">Buyer</th>
                                <th className="px-4 py-3 text-right">Sold Price</th>
                                <th className="px-4 py-3">Order Stage</th>
                                <th className="px-6 py-3 text-right">Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {rows.map((o) => (
                                <tr key={o.id} className="hover:bg-white/5 transition-colors">
                                    <td className="px-6 py-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {o.image && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={o.image} alt="" className="w-8 h-11 object-contain rounded shrink-0" />
                                            )}
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-200 truncate max-w-[220px]">{o.cardName ?? 'Unknown card'}</p>
                                                {o.cardNumber && <p className="text-[10px] text-slate-500">#{o.cardNumber}</p>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{o.seller ?? 'Unknown'}</td>
                                    <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{o.buyer ?? 'Unknown'}</td>
                                    <td className="px-4 py-3 text-sm font-black text-brand-green text-right whitespace-nowrap">{baht(o.totalAmount)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-block text-[9px] font-black uppercase px-2 py-1 rounded-full whitespace-nowrap ${ORDER_STAGE_COLORS[o.status] ?? 'bg-white/10 text-slate-400'}`}>
                                            {o.status.replace(/_/g, ' ')}
                                        </span>
                                    </td>
                                    <td className="px-6 py-3 text-[11px] text-slate-500 text-right whitespace-nowrap" title={dateTimeFmt.format(new Date(o.createdAt))}>
                                        {dateFmt.format(new Date(o.createdAt))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {(totalPages > 1 || error) && (
                <div className="px-6 py-4 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                        {error
                            ? <><span className="text-brand-red">{error.message}</span>{' '}<button onClick={() => load(error.page)} disabled={loading} className="font-bold text-brand-cyan hover:underline disabled:opacity-30">Retry</button></>
                            : <>Page {page} of {totalPages} · {firstRow.toLocaleString('en-US')}–{lastRow.toLocaleString('en-US')} of {total.toLocaleString('en-US')}</>}
                    </p>
                    <div className="flex gap-2">
                        <button onClick={() => goTo(1)} disabled={loading || page === 1} className={PAGER_BUTTON} aria-label="First page">« First</button>
                        <button onClick={() => goTo(page - 1)} disabled={loading || page === 1} className={PAGER_BUTTON}>← Prev</button>
                        <button onClick={() => goTo(page + 1)} disabled={loading || page === totalPages} className={PAGER_BUTTON}>Next →</button>
                        <button onClick={() => goTo(totalPages)} disabled={loading || page === totalPages} className={PAGER_BUTTON} aria-label="Last page">Last »</button>
                    </div>
                </div>
            )}
        </div>
    )
}
