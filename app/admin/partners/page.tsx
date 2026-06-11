'use client'

import { useEffect, useState, useCallback } from 'react'

interface PartnerRow {
    id: string
    display_name: string | null
    email: string
    avatar_url: string | null
    role: string
    total_downloads: number
    partner_level: number | null
    partner_fee: number | null
    partner_joined_at: string | null
    partner_qr_slug: string | null
}

// Printed QR codes must always point at production, regardless of where the
// admin panel happens to be running.
const joinLink = (slug: string) => `https://cardstreet.app/join/${slug}`

async function downloadQr(slug: string) {
    const QRCode = (await import('qrcode')).default
    const dataUrl = await QRCode.toDataURL(joinLink(slug), {
        width: 512,
        margin: 2,
        color: { dark: '#0f1419', light: '#ffffff' },
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `cardstreet-qr-${slug}.png`
    a.click()
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
    9: { name: 'Black Opal Rare', emoji: '🌌', color: '#a78bfa' },
}

export default function PartnersPage() {
    const [partners, setPartners] = useState<PartnerRow[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [removing, setRemoving] = useState<string | null>(null)
    const [copiedId, setCopiedId] = useState<string | null>(null)

    // Add Partner (pre-provisioned shop accounts for welcome packages)
    const [showAdd, setShowAdd] = useState(false)
    const [addName, setAddName] = useState('')
    const [addEmail, setAddEmail] = useState('')
    const [addLevel, setAddLevel] = useState(1)
    const [addLoading, setAddLoading] = useState(false)
    const [addError, setAddError] = useState<string | null>(null)
    const [addedPartner, setAddedPartner] = useState<{ shopName: string; email: string; slug: string; link: string } | null>(null)

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
                // Partner status lives in partner_joined_at; clearing it removes the
                // partner. Only the legacy partner role is downgraded — an admin who
                // is also a partner keeps their admin role.
                body: JSON.stringify({
                    partner_joined_at: null,
                    ...(partner.role === 'partner' ? { role: 'user' } : {}),
                }),
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

    const copyJoinLink = (id: string, slug: string) => {
        navigator.clipboard.writeText(joinLink(slug))
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const handleAddPartner = async (e: React.FormEvent) => {
        e.preventDefault()
        setAddLoading(true)
        setAddError(null)
        try {
            const res = await fetch('/api/admin/partners', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shopName: addName, email: addEmail, level: addLevel }),
            })
            const data = await res.json()
            if (!res.ok) {
                setAddError(data.error ?? 'Failed to create partner')
                return
            }
            setAddedPartner({ shopName: data.shopName, email: data.email, slug: data.slug, link: joinLink(data.slug) })
            setAddName('')
            setAddEmail('')
            setAddLevel(1)
            fetchPartners()
        } catch {
            setAddError('Network error — try again')
        } finally {
            setAddLoading(false)
        }
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
                    <button
                        type="button"
                        onClick={() => { setShowAdd(v => !v); setAddError(null); setAddedPartner(null) }}
                        className="px-4 py-2 bg-brand-green text-brand-darker font-bold text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all whitespace-nowrap"
                    >
                        + Add Partner
                    </button>
                </form>
            </div>

            {/* Add Partner — pre-provision a shop account so its QR/link can be
                printed for the welcome package before the shop ever signs in. */}
            {showAdd && (
                <div className="glass rounded-2xl border border-white/10 p-6 space-y-4">
                    <div>
                        <h2 className="text-sm font-black text-white uppercase tracking-wide">Add Partner</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Creates the shop&apos;s account and referral link immediately — print the QR for the
                            welcome package. The shop activates by tapping <span className="text-slate-300">Sign In → Forgot password?</span> with
                            this email and setting their own password.
                        </p>
                    </div>
                    <form onSubmit={handleAddPartner} className="flex flex-col sm:flex-row gap-3">
                        <input
                            type="text"
                            value={addName}
                            onChange={e => setAddName(e.target.value)}
                            placeholder="Shop name"
                            required
                            minLength={2}
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50"
                        />
                        <input
                            type="email"
                            value={addEmail}
                            onChange={e => setAddEmail(e.target.value)}
                            placeholder="shop@email.com"
                            required
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50"
                        />
                        <select
                            value={addLevel}
                            onChange={e => setAddLevel(Number(e.target.value))}
                            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-brand-cyan/50 [&>option]:bg-slate-900"
                        >
                            {Object.entries(TIER_INFO).map(([lvl, t]) => (
                                <option key={lvl} value={lvl}>{t.name}</option>
                            ))}
                        </select>
                        <button
                            type="submit"
                            disabled={addLoading}
                            className="px-5 py-2.5 bg-brand-cyan text-brand-darker font-bold text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap"
                        >
                            {addLoading ? 'Creating…' : 'Create Partner'}
                        </button>
                    </form>
                    {addError && (
                        <p className="text-sm text-red-300 bg-brand-red/10 border border-brand-red/20 rounded-xl px-4 py-3">{addError}</p>
                    )}
                    {addedPartner && (
                        <div className="bg-brand-green/10 border border-brand-green/20 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-brand-green">{addedPartner.shopName} created</p>
                                <p className="text-xs text-slate-400 font-mono truncate">{addedPartner.link}</p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <button
                                    onClick={() => copyJoinLink('new', addedPartner.slug)}
                                    className="px-3 py-2 bg-white/10 text-slate-200 text-xs font-bold rounded-lg hover:bg-white/20 transition"
                                >
                                    {copiedId === 'new' ? 'Copied!' : 'Copy Link'}
                                </button>
                                <button
                                    onClick={() => downloadQr(addedPartner.slug)}
                                    className="px-3 py-2 bg-brand-cyan text-brand-darker text-xs font-bold rounded-lg hover:brightness-110 transition"
                                >
                                    <i className="fa-solid fa-qrcode mr-1.5" />Download QR
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

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
                                    <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">QR / Link</th>
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
                                            <td className="px-4 py-4 text-center">
                                                {p.partner_qr_slug ? (
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        <button
                                                            onClick={() => copyJoinLink(p.id, p.partner_qr_slug!)}
                                                            title={joinLink(p.partner_qr_slug)}
                                                            className="px-2.5 py-1.5 bg-white/5 text-slate-300 text-[10px] font-bold rounded-lg hover:bg-white/15 transition whitespace-nowrap"
                                                        >
                                                            {copiedId === p.id ? 'Copied!' : <><i className="fa-regular fa-copy mr-1" />Link</>}
                                                        </button>
                                                        <button
                                                            onClick={() => downloadQr(p.partner_qr_slug!)}
                                                            title="Download printable QR code"
                                                            className="px-2.5 py-1.5 bg-brand-cyan/15 text-brand-cyan text-[10px] font-bold rounded-lg hover:bg-brand-cyan/30 transition whitespace-nowrap"
                                                        >
                                                            <i className="fa-solid fa-qrcode mr-1" />QR
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-slate-600">—</span>
                                                )}
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
                                    <tr><td colSpan={7} className="px-6 py-16 text-center text-slate-500 text-sm">No partners yet. Promote users from the <a href="/admin/users" className="text-brand-cyan hover:underline">Users section</a>.</td></tr>
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
