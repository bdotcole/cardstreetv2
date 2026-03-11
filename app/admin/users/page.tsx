'use client'

import { useEffect, useState, useCallback } from 'react'

interface UserRow {
    id: string
    display_name: string | null
    email: string
    avatar_url: string | null
    role: string
    total_downloads: number
    partner_level: number | null
    partner_fee: number | null
    partner_joined_at: string | null
    created_at: string
}

const TIER_INFO: Record<number, { name: string; emoji: string }> = {
    1: { name: 'Bronze Rare', emoji: '🟤' }, 2: { name: 'Silver Rare', emoji: '⚪' },
    3: { name: 'Gold Rare', emoji: '🟡' }, 4: { name: 'Platinum Rare', emoji: '🔷' },
    5: { name: 'Sapphire Rare', emoji: '💎' }, 6: { name: 'Ruby Rare', emoji: '🔴' },
    7: { name: 'Emerald Rare', emoji: '🟢' }, 8: { name: 'Diamond Rare', emoji: '💠' },
    9: { name: 'Pink Diamond Rare', emoji: '🩷' },
}

const ROLE_COLORS: Record<string, string> = {
    admin: 'bg-brand-red/20 text-brand-red border-brand-red/30',
    partner: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    user: 'bg-white/5 text-slate-400 border-white/10',
}

type Tab = 'users' | 'partners'

export default function UsersPage() {
    const [tab, setTab] = useState<Tab>('users')
    const [users, setUsers] = useState<UserRow[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [toggling, setToggling] = useState<string | null>(null)

    const fetchUsers = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ page: String(page) })
            if (search) params.set('search', search)
            // Pass role filter based on active tab
            if (tab === 'partners') params.set('role', 'partner')
            else params.set('role', 'non-partner') // users + admins
            const res = await fetch(`/api/admin/users?${params}`)
            const data = await res.json()
            setUsers(data.users ?? [])
            setTotal(data.total ?? 0)
        } finally {
            setLoading(false)
        }
    }, [page, search, tab])

    // Reset page when switching tabs
    const switchTab = (t: Tab) => {
        setTab(t)
        setPage(1)
        setSearch('')
        setSearchInput('')
    }

    useEffect(() => { fetchUsers() }, [fetchUsers])

    const togglePartner = async (user: UserRow) => {
        const newRole = user.role === 'partner' ? 'user' : 'partner'
        setToggling(user.id)
        try {
            const updates: Record<string, unknown> = { role: newRole }
            if (newRole === 'partner' && !user.partner_joined_at) {
                updates.partner_joined_at = new Date().toISOString()
                updates.partner_level = 1
                updates.partner_fee = 5.0
            }
            const res = await fetch(`/api/admin/users/${user.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            })
            if (res.ok) {
                // Remove from current tab list since role changed
                setUsers(prev => prev.filter(u => u.id !== user.id))
                setTotal(prev => prev - 1)
            }
        } finally {
            setToggling(null)
        }
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        setSearch(searchInput)
        setPage(1)
    }

    const totalPages = Math.ceil(total / 50)

    const TAB_CONFIG: { key: Tab; label: string; icon: string }[] = [
        { key: 'users', label: 'Users', icon: 'fa-solid fa-user' },
        { key: 'partners', label: 'Partners', icon: 'fa-solid fa-handshake' },
    ]

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-black text-white italic">
                        {tab === 'partners' ? 'Partner Management' : 'User Management'}
                    </h1>
                    <p className="text-slate-500 text-sm">{total.toLocaleString()} {tab === 'partners' ? 'partners' : 'users'}</p>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder={`Search ${tab}…`}
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50 w-52"
                    />
                    <button type="submit" className="px-4 py-2 bg-brand-cyan text-brand-darker font-bold text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all">
                        Search
                    </button>
                    {search && (
                        <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
                            className="px-3 py-2 bg-white/5 text-slate-400 font-bold text-sm rounded-xl hover:bg-white/10 transition">
                            ✕
                        </button>
                    )}
                </form>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 bg-white/5 rounded-2xl w-fit border border-white/5">
                {TAB_CONFIG.map(t => (
                    <button
                        key={t.key}
                        onClick={() => switchTab(t.key)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${tab === t.key
                            ? 'bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20'
                            : 'text-slate-500 hover:text-slate-300'
                            }`}
                    >
                        <i className={`${t.icon} text-xs`} />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin h-8 w-8 border-2 border-white/10 border-t-brand-cyan rounded-full" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        {tab === 'users' ? (
                            /* ── USERS TABLE ── */
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/5">
                                        <th className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">User</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Role</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Joined</th>
                                        <th className="px-6 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">Make Partner</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {users.map(user => (
                                        <tr key={user.id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <img
                                                        src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`}
                                                        alt=""
                                                        className="w-8 h-8 rounded-full bg-white/5 shrink-0"
                                                    />
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-200">{user.display_name ?? 'Unnamed'}</p>
                                                        <p className="text-[10px] text-slate-500">{user.email}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${ROLE_COLORS[user.role] ?? ROLE_COLORS.user}`}>
                                                    {user.role}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-xs text-slate-500">{new Date(user.created_at).toLocaleDateString()}</span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => togglePartner(user)}
                                                    disabled={toggling === user.id || user.role === 'admin'}
                                                    className="relative inline-flex h-6 w-11 items-center rounded-full bg-white/10 transition-colors duration-300 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/20"
                                                    title={user.role === 'admin' ? 'Cannot change admin role' : 'Promote to partner'}
                                                >
                                                    <span className="inline-block h-4 w-4 translate-x-1 transform rounded-full bg-white shadow transition-transform duration-300" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {users.length === 0 && (
                                        <tr><td colSpan={4} className="px-6 py-16 text-center text-slate-500 text-sm">No users found</td></tr>
                                    )}
                                </tbody>
                            </table>
                        ) : (
                            /* ── PARTNERS TABLE ── */
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
                                    {users.map(user => {
                                        const tier = TIER_INFO[user.partner_level ?? 1]
                                        return (
                                            <tr key={user.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <img
                                                            src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`}
                                                            alt=""
                                                            className="w-8 h-8 rounded-full bg-white/5 shrink-0"
                                                        />
                                                        <div>
                                                            <p className="text-sm font-semibold text-slate-200">{user.display_name ?? 'Unnamed'}</p>
                                                            <p className="text-[10px] text-slate-500">{user.email}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="text-sm font-semibold text-slate-200">
                                                        {tier?.emoji} {tier?.name ?? 'Bronze Rare'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <span className="text-sm font-black text-brand-green">
                                                        {(user.total_downloads ?? 0).toLocaleString()}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <span className="text-sm font-semibold text-slate-200">{user.partner_fee ?? 5.0}%</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="text-xs text-slate-500">
                                                        {user.partner_joined_at ? new Date(user.partner_joined_at).toLocaleDateString() : '—'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button
                                                        onClick={() => togglePartner(user)}
                                                        disabled={toggling === user.id}
                                                        className="relative inline-flex h-6 w-11 items-center rounded-full bg-yellow-500 transition-colors duration-300 focus:outline-none disabled:opacity-40 hover:bg-yellow-600"
                                                        title="Remove partner status"
                                                    >
                                                        <span className="inline-block h-4 w-4 translate-x-6 transform rounded-full bg-white shadow transition-transform duration-300" />
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {users.length === 0 && (
                                        <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">No partners yet</td></tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                        <p className="text-xs text-slate-500">Page {page} of {totalPages} · {total.toLocaleString()} results</p>
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
