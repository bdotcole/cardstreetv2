'use client'

import { useEffect, useState, useCallback } from 'react'

interface UserRow {
    id: string
    display_name: string | null
    email: string
    avatar_url: string | null
    role: string
    created_at: string
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
    const [promoting, setPromoting] = useState<string | null>(null)

    const fetchUsers = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ page: String(page), role: 'non-partner' })
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

    const promoteToPartner = async (user: UserRow) => {
        setPromoting(user.id)
        try {
            const res = await fetch(`/api/admin/users/${user.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: 'partner',
                    partner_joined_at: new Date().toISOString(),
                    partner_level: 1,
                    partner_fee: 5.0,
                }),
            })
            if (res.ok) {
                setUsers(prev => prev.filter(u => u.id !== user.id))
                setTotal(prev => prev - 1)
            }
        } finally {
            setPromoting(null)
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
                    <h1 className="text-xl font-black text-white italic">Users</h1>
                    <p className="text-slate-500 text-sm">{total.toLocaleString()} registered users</p>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder="Search by name…"
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-cyan/50 w-52"
                    />
                    <button type="submit" className="px-4 py-2 bg-brand-cyan text-brand-darker font-bold text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all">Search</button>
                    {search && (
                        <button type="button" onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
                            className="px-3 py-2 bg-white/5 text-slate-400 font-bold text-sm rounded-xl hover:bg-white/10 transition">✕</button>
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
                                                onClick={() => promoteToPartner(user)}
                                                disabled={promoting === user.id || user.role === 'admin'}
                                                title={user.role === 'admin' ? 'Cannot change admin role' : 'Promote to partner'}
                                                className="flex items-center gap-1.5 mx-auto px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px] font-black uppercase rounded-full hover:bg-yellow-500/20 transition disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                {promoting === user.id
                                                    ? <div className="animate-spin h-3 w-3 border border-yellow-400/30 border-t-yellow-400 rounded-full" />
                                                    : <i className="fa-solid fa-handshake text-[10px]" />
                                                }
                                                Partner
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {users.length === 0 && !loading && (
                                    <tr><td colSpan={4} className="px-6 py-16 text-center text-slate-500 text-sm">No users found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                        <p className="text-xs text-slate-500">Page {page} of {totalPages} · {total.toLocaleString()} users</p>
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
