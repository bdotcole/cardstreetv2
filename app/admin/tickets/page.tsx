'use client'

import { useEffect, useState, useCallback } from 'react'

interface Ticket {
    id: string
    subject: string
    description: string
    category: string
    status: string
    admin_reply: string | null
    replied_at: string | null
    created_at: string
    user_id: string
    profiles: { display_name: string | null; avatar_url: string | null } | null
}

interface TicketMessage {
    id: string
    ticket_id: string
    sender_id: string | null
    sender_role: 'user' | 'admin'
    body: string
    created_at: string
}

interface DisputeInfo {
    id: string
    status: string
    total_amount: number
    dispute_reason: string | null
    dispute_details: string | null
    dispute_opened_at: string | null
    dispute_outcome: string | null
    dispute_resolved_at: string | null
}

const STATUS_OPTIONS = ['All', 'Open', 'In Progress', 'Resolved']
const CATEGORY_OPTIONS = ['All', 'Order', 'Technical', 'Billing', 'Card Valuation', 'General']

const STATUS_COLORS: Record<string, string> = {
    'Open': 'bg-brand-red/20 text-brand-red border-brand-red/30',
    'In Progress': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'Resolved': 'bg-brand-green/20 text-brand-green border-brand-green/30',
}

const CATEGORY_ICONS: Record<string, string> = {
    Order: 'fa-solid fa-box-open',
    Technical: 'fa-solid fa-screwdriver-wrench',
    Billing: 'fa-solid fa-credit-card',
    'Card Valuation': 'fa-solid fa-scale-balanced',
    General: 'fa-regular fa-circle-question',
}

export default function TicketsPage() {
    const [tickets, setTickets] = useState<Ticket[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState('All')
    const [categoryFilter, setCategoryFilter] = useState('All')
    const [selected, setSelected] = useState<Ticket | null>(null)
    const [thread, setThread] = useState<TicketMessage[]>([])
    const [threadLoading, setThreadLoading] = useState(false)
    const [replyText, setReplyText] = useState('')
    const [replyStatus, setReplyStatus] = useState('')
    const [saving, setSaving] = useState(false)
    // Buyer problem report linked to the selected ticket, if any.
    const [dispute, setDispute] = useState<DisputeInfo | null>(null)
    const [resolving, setResolving] = useState<string | null>(null)

    const resolveDispute = async (outcome: 'refunded' | 'rejected' | 'resolved') => {
        if (!dispute || !selected) return
        const labels = { refunded: 'refund the buyer (mark cancelled)', rejected: 'reject the report', resolved: 'mark resolved' }
        if (!window.confirm(`This will ${labels[outcome]} and close the ticket. Continue?`)) return
        setResolving(outcome)
        try {
            const res = await fetch(`/api/admin/orders/${dispute.id}/dispute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outcome, note: replyText.trim() }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                window.alert(data.error || `Server returned ${res.status}`)
                return
            }
            setDispute(prev => prev ? { ...prev, status: data.status, dispute_outcome: outcome, dispute_resolved_at: new Date().toISOString() } : prev)
            setTickets(prev => prev.map(t => t.id === selected.id ? { ...t, status: 'Resolved' } : t))
            setSelected(prev => prev ? { ...prev, status: 'Resolved' } : prev)
            setReplyStatus('Resolved')
            setReplyText('')
            // Re-pull the thread so the closing reply shows.
            const fresh = await fetch(`/api/admin/tickets/${selected.id}`)
            if (fresh.ok) {
                const d = await fresh.json()
                setThread(d.messages ?? [])
            }
        } finally {
            setResolving(null)
        }
    }

    const fetchTickets = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== 'All') params.set('status', statusFilter)
            if (categoryFilter !== 'All') params.set('category', categoryFilter)
            const res = await fetch(`/api/admin/tickets?${params}`)
            const data = await res.json()
            setTickets(data.tickets ?? [])
            setTotal(data.total ?? 0)
        } finally {
            setLoading(false)
        }
    }, [statusFilter, categoryFilter])

    useEffect(() => { fetchTickets() }, [fetchTickets])

    const openTicket = async (ticket: Ticket) => {
        setSelected(ticket)
        setReplyText('')
        setReplyStatus(ticket.status)
        setThread([])
        setDispute(null)
        setThreadLoading(true)
        try {
            const res = await fetch(`/api/admin/tickets/${ticket.id}`)
            if (res.ok) {
                const data = await res.json()
                setThread(data.messages ?? [])
                setDispute(data.dispute ?? null)
            }
        } finally {
            setThreadLoading(false)
        }
    }

    const saveReply = async () => {
        if (!selected) return
        setSaving(true)
        try {
            const res = await fetch(`/api/admin/tickets/${selected.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: replyStatus, admin_reply: replyText.trim() || undefined }),
            })
            if (res.ok) {
                const updated = await res.json()
                setTickets(prev => prev.map(t => t.id === selected.id ? { ...t, ...updated.ticket } : t))
                setSelected(prev => prev ? { ...prev, ...updated.ticket } : null)
                if (updated.message) setThread(prev => [...prev, updated.message])
                setReplyText('')
            }
        } finally {
            setSaving(false)
        }
    }

    const hasAdminMessage = thread.some(m => m.sender_role === 'admin')
    const userName = selected?.profiles?.display_name ?? 'User'

    return (
        <div className="flex gap-6 h-full animate-fadeIn">
            {/* Ticket List */}
            <div className={`flex flex-col space-y-4 transition-all duration-300 ${selected ? 'w-1/2' : 'w-full'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-black text-white italic">Support Tickets</h1>
                        <p className="text-slate-500 text-sm">{total} tickets</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-brand-cyan/40"
                        >
                            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <select
                            value={categoryFilter}
                            onChange={e => setCategoryFilter(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-brand-cyan/40"
                        >
                            {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                <div className="glass rounded-2xl border border-white/10 overflow-hidden flex-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="animate-spin h-8 w-8 border-2 border-white/10 border-t-brand-cyan rounded-full" />
                        </div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {tickets.length === 0 && (
                                <p className="px-6 py-16 text-center text-slate-500 text-sm">No tickets match your filters</p>
                            )}
                            {tickets.map(ticket => (
                                <button
                                    key={ticket.id}
                                    onClick={() => openTicket(ticket)}
                                    className={`w-full text-left px-6 py-4 hover:bg-white/5 transition-all ${selected?.id === ticket.id ? 'bg-brand-cyan/5 border-l-2 border-brand-cyan' : ''}`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <i className={`${CATEGORY_ICONS[ticket.category] ?? CATEGORY_ICONS.General} text-slate-500 mt-0.5 shrink-0`} />
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-200 truncate">{ticket.subject}</p>
                                                <p className="text-[10px] text-slate-500 mt-0.5">
                                                    {ticket.profiles?.display_name ?? 'Unknown'} · {ticket.category} · {new Date(ticket.created_at).toLocaleDateString()}
                                                </p>
                                                {!selected && (
                                                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{ticket.description}</p>
                                                )}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-1 rounded-full border ${STATUS_COLORS[ticket.status] ?? ''}`}>
                                            {ticket.status}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Ticket Detail Pane */}
            {selected && (
                <div className="w-1/2 flex flex-col space-y-4 animate-fadeIn">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-black text-white uppercase tracking-wide italic">Ticket Detail</h2>
                        <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300 transition text-xs font-bold">
                            Close ✕
                        </button>
                    </div>

                    <div className="glass rounded-2xl border border-white/10 p-6 space-y-5 flex-1 overflow-y-auto">
                        {/* Header */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${STATUS_COLORS[selected.status] ?? ''}`}>{selected.status}</span>
                                <span className="text-[9px] font-bold text-slate-500 uppercase bg-white/5 px-2 py-1 rounded-full">{selected.category}</span>
                            </div>
                            <h3 className="text-lg font-black text-white">{selected.subject}</h3>
                            <p className="text-[11px] text-slate-500">
                                From: <span className="text-slate-400 font-semibold">{selected.profiles?.display_name ?? 'Unknown'}</span>
                                {' · '}{new Date(selected.created_at).toLocaleString()}
                            </p>
                        </div>

                        {/* Buyer problem report: the order this ticket put on hold, and
                            the three ways to close it. The refund itself happens in the
                            Stripe dashboard (or from CardStreet funds); this records the
                            outcome, restores or cancels the order, and closes the ticket
                            with the reply text above as the buyer-facing answer. */}
                        {dispute && (
                            <div className="rounded-xl border border-brand-red/30 bg-brand-red/5 p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-bold uppercase text-rose-300">
                                        Problem report · order #{dispute.id.slice(0, 8).toUpperCase()}
                                    </p>
                                    <a href={`/orders/${dispute.id}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-brand-cyan hover:underline">
                                        Open order ↗
                                    </a>
                                </div>
                                <p className="text-sm text-slate-300">
                                    ฿{Math.round(Number(dispute.total_amount) || 0).toLocaleString()} · {dispute.dispute_reason ?? 'reason not recorded'} · status <span className="font-mono">{dispute.status}</span>
                                </p>
                                {dispute.dispute_details && (
                                    <p className="text-xs text-slate-400 whitespace-pre-wrap">{dispute.dispute_details}</p>
                                )}
                                {dispute.dispute_outcome ? (
                                    <p className="text-xs text-emerald-300">
                                        Closed: {dispute.dispute_outcome}
                                        {dispute.dispute_resolved_at ? ` · ${new Date(dispute.dispute_resolved_at).toLocaleString()}` : ''}
                                    </p>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => resolveDispute('refunded')}
                                            disabled={!!resolving}
                                            className="px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-400/40 text-rose-200 text-xs font-bold hover:bg-rose-500/30 disabled:opacity-50"
                                        >
                                            {resolving === 'refunded' ? 'Working…' : 'Refunded the buyer → cancel order'}
                                        </button>
                                        <button
                                            onClick={() => resolveDispute('resolved')}
                                            disabled={!!resolving}
                                            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-bold hover:bg-white/10 disabled:opacity-50"
                                        >
                                            {resolving === 'resolved' ? 'Working…' : 'Resolved another way → keep order'}
                                        </button>
                                        <button
                                            onClick={() => resolveDispute('rejected')}
                                            disabled={!!resolving}
                                            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 disabled:opacity-50"
                                        >
                                            {resolving === 'rejected' ? 'Working…' : 'Reject report'}
                                        </button>
                                    </div>
                                )}
                                <p className="text-[10px] text-slate-500">
                                    Type the reply the buyer should see below first; closing sends it and marks the ticket Resolved.
                                </p>
                            </div>
                        )}

                        {/* Conversation thread */}
                        <div className="space-y-3">
                            <div className="bg-white/5 rounded-xl p-4">
                                <p className="text-[10px] font-bold uppercase text-slate-500 mb-2">{userName}</p>
                                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{selected.description}</p>
                                <p className="text-[10px] text-slate-600 mt-2">{new Date(selected.created_at).toLocaleString()}</p>
                            </div>

                            {threadLoading ? (
                                <div className="flex items-center justify-center py-4">
                                    <div className="animate-spin h-5 w-5 border-2 border-white/10 border-t-brand-cyan rounded-full" />
                                </div>
                            ) : (
                                <>
                                    {thread.map(msg => msg.sender_role === 'admin' ? (
                                        <div key={msg.id} className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-4">
                                            <p className="text-[10px] font-bold uppercase text-brand-cyan mb-2">CardStreet Team</p>
                                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                                            <p className="text-[10px] text-slate-600 mt-2">{new Date(msg.created_at).toLocaleString()}</p>
                                        </div>
                                    ) : (
                                        <div key={msg.id} className="bg-white/5 rounded-xl p-4">
                                            <p className="text-[10px] font-bold uppercase text-slate-500 mb-2">{userName}</p>
                                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                                            <p className="text-[10px] text-slate-600 mt-2">{new Date(msg.created_at).toLocaleString()}</p>
                                        </div>
                                    ))}

                                    {/* Legacy single-shot reply, shown only until the
                                        20260724 migration backfills it into the thread. */}
                                    {!hasAdminMessage && selected.admin_reply && (
                                        <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-4">
                                            <p className="text-[10px] font-bold uppercase text-brand-cyan mb-2">CardStreet Team</p>
                                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{selected.admin_reply}</p>
                                            {selected.replied_at && (
                                                <p className="text-[10px] text-slate-600 mt-2">{new Date(selected.replied_at).toLocaleString()}</p>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Reply composer */}
                        <div className="space-y-3">
                            <p className="text-[10px] font-bold uppercase text-slate-500">Reply</p>
                            <textarea
                                value={replyText}
                                onChange={e => setReplyText(e.target.value)}
                                rows={4}
                                maxLength={5000}
                                placeholder="Type your response here…"
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/50 resize-none"
                            />
                        </div>

                        {/* Status + Send */}
                        <div className="flex items-center gap-3">
                            <select
                                value={replyStatus}
                                onChange={e => setReplyStatus(e.target.value)}
                                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-300 focus:outline-none focus:border-brand-cyan/40"
                            >
                                {['Open', 'In Progress', 'Resolved'].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button
                                onClick={saveReply}
                                disabled={saving || (!replyText.trim() && replyStatus === selected.status)}
                                className="px-5 py-2.5 bg-brand-cyan text-brand-darker font-black text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                            >
                                {saving ? 'Sending…' : replyText.trim() ? 'Send Reply' : 'Update Status'}
                            </button>
                        </div>

                        {selected.replied_at && (
                            <p className="text-[10px] text-slate-600">Last replied {new Date(selected.replied_at).toLocaleString()}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
