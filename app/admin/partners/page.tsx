'use client'

import { useEffect, useState, useCallback } from 'react'

interface PartnerRow {
    id: string
    display_name: string | null
    email: string
    avatar_url: string | null
    total_downloads: number
    partner_level: number | null
    partner_fee: number | null
    partner_joined_at: string | null
}

const TIER_INFO: Record<number, { name: string; emoji: string; color: string }> = {
    1: { name: 'Bronze Rare', emoji: '🟤', color: '#d97706' },
    2: { name: 'Silver Rare', emoji: '⚪', color: '#94a3b8' },
    3: { name: 'Gold Rare', emoji: '🟡', color: '#eab308' },
    4: { name: 'Platinum Rare', emoji: '🔷', color: '#e2e8f0' },
    5: { name: 'Sapphire Rare', emoji: '💎', color: '#60a5fa' },
    6: { name: 'Ruby Rare', emoji: '🔴', color: '#f87171' },
    7: { name: 'Emerald Rare', emoji: '🟢', color: '#4ade80' },
    8: { name: 'Diamond Rare', emoji: '💠', color: '#06b6d4' },
    9: { name: 'Pink Diamond Rare', emoji: '🩷', color: '#f472b6' },
}

export default function PartnersPage() {
    const [partners, setPartners] = useState<PartnerRow[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [removing, setRemoving] = useState<string | null>(null)

    const fetchPartners = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ page: String(page), role: 'partner' })
            if (search) params.set('search', search)
            const res = await fetch(`/api/admin/users?${params}`)
            const data = await res.json()
            setPartners(data.users ?? [])
            setTotal(data.total ?? 0)
        } finally {
            setLoading(false)
        }
    }, [page, search])

    useEffect(() => { fetchPartners() }, [fetchPartners])

    const removePartner = async (partner: PartnerRow) => {
        setRemoving(partner.id)
        try {
            const res = await fetch(`/api/admin/users/${partner.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'user' }),
            })
            if (res.ok) {
                setPartners(prev => prev.filter(p => p.id !== partner.id))
                setTotal(prev => prev - 1)
            }
        } finally {
            setRemoving(null)
        }
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        setSearch(searchInput)
        setPage(1)
    }

    const totalPages = Math.ceil(total / 50)
    const totalDownloads = partners.reduce((s, p) => s + (p.total_downloads ?? 0), 0)

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-black text-white italic">Partners</h1>
                    <p className="text-slate-500 text-sm">{total.toLocaleString()} partners · {totalDownloads.toLocaleString()} total downloads</p>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder="Search partners…"
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50 w-52"
                    />
                    <button type="submit" className="px-4 py-2 bg-brand-cyan text-brand-darker font-bold text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all">Search</button>
                    {search && (
                        <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
                            className="px-3 py-2 bg-white/5 text-slate-400 font-bold text-sm rounded-xl hover:bg-white/10 transition">✕</button>
                    )}
                </form>
            </div>

            {/* Table */}
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
                                    <th className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Partner</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Tier</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Downloads</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Seller Fee</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Partner Since</th>
                                    <th className="px-6 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">Remove</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {partners.map((p, i) => {
                                    const tier = TIER_INFO[p.partner_level ?? 1]
                                    return (
                                        <tr key={p.id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative shrink-0">
                                                        <img
                                                            src={p.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`}
                                                            alt=""
                                                            className="w-8 h-8 rounded-full bg-white/5"
                                                        />
                                                        {i < 3 && (
                                                            <span className="absolute -top-1 -right-1 text-[9px]">
                                                                {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-200">{p.display_name ?? 'Unnamed'}</p>
                                                        <p className="text-[10px] text-slate-500">{p.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-sm font-semibold" style={{ color: tier?.color }}>
                                                    {tier?.emoji} {tier?.name}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <span className="text-sm font-black text-brand-green">
                                                    {(p.total_downloads ?? 0).toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <span className="text-sm font-semibold text-slate-200">{p.partner_fee ?? 5.0}%</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-xs text-slate-500">
                                                    {p.partner_joined_at ? new Date(p.partner_joined_at).toLocaleDateString() : '—'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => removePartner(p)}
                                                    disabled={removing === p.id}
                                                    className="flex items-center gap-1.5 mx-auto px-3 py-1.5 bg-brand-red/10 border border-brand-red/20 text-brand-red text-[10px] font-black uppercase rounded-full hover:bg-brand-red/20 transition disabled:opacity-30"
                                                    title="Remove partner status"
                                                >
                                                    {removing === p.id
                                                        ? <div className="animate-spin h-3 w-3 border border-brand-red/30 border-t-brand-red rounded-full" />
                                                        : <i className="fa-solid fa-xmark text-[9px]" />
                                                    }
                                                    Remove
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                                {partners.length === 0 && !loading && (
                                    <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">No partners yet. Promote users from the <a href="/admin/users" className="text-brand-cyan hover:underline">Users section</a>.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                        <p className="text-xs text-slate-500">Page {page} of {totalPages} · {total.toLocaleString()} partners</p>
                        <div className="flex gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition">← Prev</button>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                                className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition">Next →</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
