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

const TIER_NAMES: Record<number, { name: string; emoji: string }> = {
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

export default function UsersPage() {
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
            const res = await fetch(`/api/admin/users?${params}`)
            const data = await res.json()
            setUsers(data.users ?? [])
            setTotal(data.total ?? 0)
        } finally {
            setLoading(false)
        }
    }, [page, search])

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
                setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: newRole } : u))
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

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-black text-white italic">Users & Partner Management</h1>
                    <p className="text-slate-500 text-sm">{total.toLocaleString()} total users</p>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder="Search by name…"
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50 w-56"
                    />
                    <button type="submit" className="px-4 py-2 bg-brand-cyan text-brand-darker font-bold text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all">
                        Search
                    </button>
                    {search && (
                        <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
                            className="px-3 py-2 bg-white/5 text-slate-400 font-bold text-sm rounded-xl hover:bg-white/10 transition">
                            Clear
                        </button>
                    )}
                </form>
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
                                    <th className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">User</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Role</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Tier</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Downloads</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Fee</th>
                                    <th className="px-6 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">Partner</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {users.map(user => {
                                    const tier = TIER_NAMES[user.partner_level ?? 1]
                                    const isPartner = user.role === 'partner'
                                    const isToggling = toggling === user.id
                                    return (
                                        <tr key={user.id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <img
                                                        src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`}
                                                        alt={user.display_name ?? ''}
                                                        className="w-8 h-8 rounded-full bg-white/5"
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
                                                {isPartner ? (
                                                    <span className="text-xs text-slate-300 font-semibold">
                                                        {tier?.emoji} {tier?.name ?? 'Bronze Rare'}
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-600">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <span className="text-sm font-black text-brand-green">
                                                    {isPartner ? (user.total_downloads ?? 0).toLocaleString() : '—'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <span className="text-sm font-semibold text-slate-300">
                                                    {isPartner ? `${user.partner_fee ?? 5.0}%` : '—'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => togglePartner(user)}
                                                    disabled={isToggling || user.role === 'admin'}
                                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${isPartner ? 'bg-yellow-500' : 'bg-white/10'}`}
                                                    title={user.role === 'admin' ? 'Cannot change admin role here' : isPartner ? 'Remove partner' : 'Make partner'}
                                                >
                                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-300 ${isPartner ? 'translate-x-6' : 'translate-x-1'}`} />
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                                {users.length === 0 && !loading && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">
                                            No users found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                        <p className="text-xs text-slate-500">
                            Page {page} of {totalPages} · {total.toLocaleString()} users
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition"
                            >← Prev</button>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 rounded-lg disabled:opacity-30 transition"
                            >Next →</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
