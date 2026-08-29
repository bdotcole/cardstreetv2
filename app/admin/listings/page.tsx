'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import BanUserModal, { type BanTarget } from '../_BanUserModal'

interface ListingRow {
    id: string
    card_id: string | null
    status: string
    price: number
    condition: string | null
    is_graded: boolean | null
    grading_company: string | null
    grade: string | null
    created_at: string
    card_name: string | null
    catalog_image: string | null
    photo_front: string | null
    seller: {
        id: string
        display_name: string | null
        username: string | null
        banned_at: string | null
    }
}

const STATUS_TABS = ['active', 'draft', 'sold', 'cancelled', 'removed', 'all'] as const

const STATUS_COLORS: Record<string, string> = {
    active: 'bg-brand-green/20 text-brand-green border-brand-green/30',
    draft: 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30',
    sold: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    cancelled: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    removed: 'bg-brand-red/20 text-brand-red border-brand-red/30',
}

function ListingsBrowser() {
    const searchParams = useSearchParams()
    const [listings, setListings] = useState<ListingRow[]>([])
    const [total, setTotal] = useState(0)
    const [pageSize, setPageSize] = useState(50)
    const [page, setPage] = useState(1)
    const [status, setStatus] = useState<string>(searchParams?.get('status') ?? 'active')
    const [seller, setSeller] = useState<string>(searchParams?.get('seller') ?? '')
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [banTarget, setBanTarget] = useState<BanTarget | null>(null)

    const fetchListings = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ page: String(page), status })
            if (search) params.set('search', search)
            if (seller) params.set('seller', seller)
            const res = await fetch(`/api/admin/listings?${params}`)
            const data = await res.json().catch(() => ({}))
            setListings(data.listings ?? [])
            setTotal(data.total ?? 0)
            if (data.pageSize) setPageSize(data.pageSize)
        } finally {
            setLoading(false)
        }
    }, [page, status, search, seller])

    useEffect(() => { fetchListings() }, [fetchListings])

    const removeListing = async (listing: ListingRow) => {
        if (!window.confirm(`Take "${listing.card_name ?? listing.id}" off the marketplace?`)) return
        setBusyId(listing.id)
        try {
            const res = await fetch(`/api/admin/listings/${listing.id}`, { method: 'DELETE' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                window.alert(data?.error ?? 'Failed to remove listing')
                return
            }
            await fetchListings()
        } finally {
            setBusyId(null)
        }
    }

    const unbanSeller = async (listing: ListingRow) => {
        const name = listing.seller.display_name ?? listing.seller.username ?? listing.seller.id
        if (!window.confirm(`Lift the ban on ${name}? Removed listings stay removed.`)) return
        setBusyId(listing.id)
        try {
            const res = await fetch(`/api/admin/users/${listing.seller.id}/ban`, { method: 'DELETE' })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                window.alert(data?.error ?? 'Failed to unban')
            }
            await fetchListings()
        } finally {
            setBusyId(null)
        }
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Listings</h1>
                    <p className="text-slate-500 text-sm mt-1">{total.toLocaleString()} listing{total === 1 ? '' : 's'} · moderation view</p>
                </div>
                <form
                    onSubmit={e => { e.preventDefault(); setSearch(searchInput); setPage(1) }}
                    className="flex gap-2"
                >
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder="Search card name…"
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50 w-52"
                    />
                    <button type="submit" className="px-4 py-2 bg-brand-cyan text-brand-darker font-bold text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all">Search</button>
                    {search && (
                        <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
                            className="px-3 py-2 bg-white/5 text-slate-400 font-bold text-sm rounded-xl hover:bg-white/10 transition">✕</button>
                    )}
                </form>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {STATUS_TABS.map(s => (
                    <button
                        key={s}
                        onClick={() => { setStatus(s); setPage(1) }}
                        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg border transition ${status === s
                            ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30'
                            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                            }`}
                    >
                        {s}
                    </button>
                ))}
                {seller && (
                    <button
                        onClick={() => { setSeller(''); setPage(1) }}
                        className="px-3 py-1.5 text-[10px] font-bold rounded-lg border bg-brand-purple/10 text-brand-purple border-brand-purple/30 hover:bg-brand-purple/20 transition"
                    >
                        Seller filter: {listings[0]?.seller?.display_name ?? seller.slice(0, 8)} ✕
                    </button>
                )}
            </div>

            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin h-8 w-8 border-2 border-white/10 border-t-brand-cyan rounded-full" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/5">
                                    <th className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Listing</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Price</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Seller</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Listed</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Status</th>
                                    <th className="px-6 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {listings.map(listing => {
                                    const busy = busyId === listing.id
                                    const live = ['active', 'draft'].includes(listing.status)
                                    return (
                                        <tr key={listing.id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-3">
                                                <div className="flex items-center gap-3">
                                                    {(listing.photo_front || listing.catalog_image) ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            src={listing.photo_front ?? listing.catalog_image ?? ''}
                                                            alt=""
                                                            className="w-9 h-12 object-cover rounded bg-white/5 shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-9 h-12 rounded bg-white/5 shrink-0" />
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-slate-200 truncate max-w-[220px]">{listing.card_name ?? 'Unknown card'}</p>
                                                        <p className="text-[10px] text-slate-500">
                                                            {listing.condition ?? '—'}
                                                            {listing.is_graded ? ` · ${listing.grading_company ?? 'Graded'} ${listing.grade ?? ''}` : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-sm font-bold text-slate-200">฿{Number(listing.price).toLocaleString()}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => { setSeller(listing.seller.id); setStatus('all'); setPage(1) }}
                                                        className="text-xs font-semibold text-slate-300 hover:text-brand-cyan transition text-left"
                                                        title="Filter to this seller"
                                                    >
                                                        {listing.seller.display_name ?? 'Unnamed'}
                                                        {listing.seller.username && <span className="text-slate-500 font-normal"> @{listing.seller.username}</span>}
                                                    </button>
                                                    {listing.seller.banned_at && (
                                                        <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-brand-red/20 text-brand-red border border-brand-red/30">Banned</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-xs text-slate-500">{new Date(listing.created_at).toLocaleDateString()}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${STATUS_COLORS[listing.status] ?? STATUS_COLORS.cancelled}`}>
                                                    {listing.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3">
                                                <div className="flex items-center justify-end gap-2">
                                                    {listing.card_id && (
                                                        <a
                                                            href={`/card/${listing.card_id}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title="Open card page"
                                                            className="px-2.5 py-1.5 text-[10px] font-bold text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition"
                                                        >
                                                            <i className="fa-solid fa-arrow-up-right-from-square" />
                                                        </a>
                                                    )}
                                                    <button
                                                        onClick={() => removeListing(listing)}
                                                        disabled={busy || !live}
                                                        title={live ? 'Remove from marketplace' : `Listing is ${listing.status}`}
                                                        className="px-2.5 py-1.5 text-[10px] font-black uppercase text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-lg hover:bg-brand-red/20 transition disabled:opacity-30"
                                                    >
                                                        {busy ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-trash" />}
                                                    </button>
                                                    {listing.seller.banned_at ? (
                                                        <button
                                                            onClick={() => unbanSeller(listing)}
                                                            disabled={busy}
                                                            title="Unban seller"
                                                            className="px-2.5 py-1.5 text-[10px] font-bold text-slate-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition disabled:opacity-30"
                                                        >
                                                            Unban
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => setBanTarget({ id: listing.seller.id, display_name: listing.seller.display_name, username: listing.seller.username, email: null })}
                                                            disabled={busy}
                                                            title="Ban seller account"
                                                            className="px-2.5 py-1.5 text-[10px] font-black uppercase text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-lg hover:bg-brand-red/20 transition disabled:opacity-30"
                                                        >
                                                            <i className="fa-solid fa-ban" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                                {listings.length === 0 && (
                                    <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">No listings found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                        <p className="text-xs text-slate-500">Page {page} of {totalPages} · {total.toLocaleString()} listings</p>
                        <div className="flex gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition">← Prev</button>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                                className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition">Next →</button>
                        </div>
                    </div>
                )}
            </div>

            <BanUserModal
                target={banTarget}
                onClose={() => setBanTarget(null)}
                onBanned={fetchListings}
            />
        </div>
    )
}

export default function AdminListingsPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center py-20">
                <div className="animate-spin h-8 w-8 border-2 border-white/10 border-t-brand-cyan rounded-full" />
            </div>
        }>
            <ListingsBrowser />
        </Suspense>
    )
}
