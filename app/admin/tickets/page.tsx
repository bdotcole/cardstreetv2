'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { languageName } from '@/lib/languageNames'

interface Translation {
    text: string
    sourceLang: string
}

// Mirrors needsTranslation() in lib/supportTranslate.ts: pure-ASCII text is
// read as English already, so only the rest is sent to be translated.
const needsEnglish = (text: string | null | undefined) => !!text && /[^\x00-\x7F]/.test(text)

// Languages the reply composer can translate a draft into.
const REPLY_TARGETS = ['th', 'ja']

async function requestTranslations(
    items: { id: string; text: string }[],
    target: 'en' | 'th' | 'ja' = 'en',
): Promise<Record<string, Translation | null> | null> {
    try {
        const res = await fetch('/api/admin/tickets/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, target }),
        })
        if (!res.ok) return null
        const data = await res.json()
        return data.translations ?? null
    } catch {
        return null
    }
}

function TranslationBlock({ translation, pending }: { translation: Translation | null | undefined; pending: boolean }) {
    if (pending && translation === undefined) {
        return <p className="text-[10px] text-slate-500 mt-3 italic">Translating to English…</p>
    }
    if (!translation) return null
    return (
        <div className="mt-3 border-l-2 border-brand-cyan/40 pl-3">
            <p className="text-[9px] font-bold uppercase tracking-wide text-brand-cyan/80 mb-1">
                <i className="fa-solid fa-language mr-1" />
                English · auto-translated from {languageName(translation.sourceLang)}
            </p>
            <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">{translation.text}</p>
        </div>
    )
}

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
    // English renderings of customer text. List keys: `subject:<id>` and
    // `desc:<id>`; thread keys: 'subject', 'description', `msg:<messageId>`.
    // undefined = not translated (yet), null = already English.
    const [listTr, setListTr] = useState<Record<string, Translation | null>>({})
    const [threadTr, setThreadTr] = useState<Record<string, Translation | null>>({})
    const [threadTranslating, setThreadTranslating] = useState(false)
    // Reply composer translation: the English draft is kept so it can be restored.
    const [replyTranslating, setReplyTranslating] = useState(false)
    const [draftBeforeTranslate, setDraftBeforeTranslate] = useState<string | null>(null)
    const [replyNotice, setReplyNotice] = useState<string | null>(null)
    // Guards async results against the admin having moved to another ticket.
    const openIdRef = useRef<string | null>(null)
    // ?ticket=<id> from the support-inbox email, opened once the list loads.
    const deepLinkRef = useRef<string | null>(null)

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
            const list: Ticket[] = data.tickets ?? []
            setTickets(list)
            setTotal(data.total ?? 0)
            return list
        } finally {
            setLoading(false)
        }
    }, [statusFilter, categoryFilter])

    // English subjects and previews for the list, in one batch. Previews are
    // clipped because the list only shows two lines of them anyway.
    const translateList = useCallback(async (list: Ticket[]) => {
        const items: { id: string; text: string }[] = []
        for (const t of list.slice(0, 30)) {
            if (needsEnglish(t.subject)) items.push({ id: `subject:${t.id}`, text: t.subject })
            if (needsEnglish(t.description)) items.push({ id: `desc:${t.id}`, text: t.description.slice(0, 300) })
        }
        const todo = items.filter(i => !(i.id in listTr))
        if (todo.length === 0) return
        const result = await requestTranslations(todo)
        if (result) setListTr(prev => ({ ...prev, ...result }))
    }, [listTr])

    useEffect(() => {
        let cancelled = false
        fetchTickets().then(list => {
            if (cancelled) return
            translateList(list)
            const wanted = deepLinkRef.current
            if (wanted) {
                deepLinkRef.current = null
                const found = list.find(t => t.id === wanted)
                if (found) openTicket(found)
                else openTicketById(wanted)
            }
        })
        return () => { cancelled = true }
        // translateList is deliberately left out: it changes as translations
        // arrive, and re-fetching the list on every translation would loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchTickets])

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const id = params.get('ticket')
        if (id && /^[0-9a-f-]{36}$/i.test(id)) deepLinkRef.current = id
        if (id) {
            params.delete('ticket')
            const rest = params.toString()
            window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`)
        }
    }, [])

    const translateThread = async (ticket: Ticket, messages: TicketMessage[]) => {
        const items = [
            { id: 'subject', text: ticket.subject },
            { id: 'description', text: ticket.description },
            ...messages.filter(m => m.sender_role === 'user').map(m => ({ id: `msg:${m.id}`, text: m.body })),
        ].filter(i => needsEnglish(i.text))
        if (items.length === 0) return
        setThreadTranslating(true)
        try {
            const result = await requestTranslations(items)
            if (result && openIdRef.current === ticket.id) setThreadTr(prev => ({ ...prev, ...result }))
        } finally {
            if (openIdRef.current === ticket.id) setThreadTranslating(false)
        }
    }

    const loadThread = async (ticket: Ticket) => {
        setThreadLoading(true)
        let messages: TicketMessage[] = []
        try {
            const res = await fetch(`/api/admin/tickets/${ticket.id}`)
            if (res.ok) {
                const data = await res.json()
                if (openIdRef.current !== ticket.id) return
                messages = data.messages ?? []
                setThread(messages)
                setDispute(data.dispute ?? null)
            }
        } finally {
            if (openIdRef.current === ticket.id) setThreadLoading(false)
        }
        translateThread(ticket, messages)
    }

    const resetPane = (ticket: Ticket) => {
        openIdRef.current = ticket.id
        setSelected(ticket)
        setReplyText('')
        setReplyStatus(ticket.status)
        setThread([])
        setDispute(null)
        setThreadTr({})
        setThreadTranslating(false)
        setDraftBeforeTranslate(null)
        setReplyNotice(null)
    }

    const openTicket = async (ticket: Ticket) => {
        resetPane(ticket)
        await loadThread(ticket)
    }

    // Deep link to a ticket the current filters hide: the detail endpoint
    // returns the ticket itself along with its thread.
    const openTicketById = async (id: string) => {
        const res = await fetch(`/api/admin/tickets/${id}`)
        if (!res.ok) return
        const data = await res.json()
        if (!data.ticket) return
        const ticket = data.ticket as Ticket
        resetPane(ticket)
        setThread(data.messages ?? [])
        setDispute(data.dispute ?? null)
        translateThread(ticket, data.messages ?? [])
    }

    // The customer's language, from the most recent translated customer text.
    const customerLang = (() => {
        const userMsgs = thread.filter(m => m.sender_role === 'user').reverse()
        for (const m of userMsgs) {
            const tr = threadTr[`msg:${m.id}`]
            if (tr?.sourceLang) return tr.sourceLang
        }
        return threadTr.description?.sourceLang ?? threadTr.subject?.sourceLang ?? null
    })()
    const replyTarget = customerLang && REPLY_TARGETS.includes(customerLang) ? customerLang as 'th' | 'ja' : null

    // Turns the English draft into "<customer's language>, then the English
    // original" so the customer can read it and the team can still check it.
    const translateReply = async () => {
        const draft = replyText.trim()
        if (!draft || !replyTarget) return
        setReplyTranslating(true)
        setReplyNotice(null)
        try {
            const result = await requestTranslations([{ id: 'reply', text: draft }], replyTarget)
            const tr = result?.reply
            if (tr === undefined) {
                setReplyNotice('Translation failed. Try again, or send in English.')
            } else if (tr === null) {
                setReplyNotice(`The draft is already in ${languageName(replyTarget)}.`)
            } else {
                setDraftBeforeTranslate(replyText)
                setReplyText(`${tr.text}\n\n—\n${draft}`)
            }
        } finally {
            setReplyTranslating(false)
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
                setDraftBeforeTranslate(null)
                setReplyNotice(null)
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
                            {tickets.map(ticket => {
                                const subjectTr = listTr[`subject:${ticket.id}`]
                                const descTr = listTr[`desc:${ticket.id}`]
                                return (
                                <button
                                    key={ticket.id}
                                    onClick={() => openTicket(ticket)}
                                    className={`w-full text-left px-6 py-4 hover:bg-white/5 transition-all ${selected?.id === ticket.id ? 'bg-brand-cyan/5 border-l-2 border-brand-cyan' : ''}`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <i className={`${CATEGORY_ICONS[ticket.category] ?? CATEGORY_ICONS.General} text-slate-500 mt-0.5 shrink-0`} />
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-200 truncate">{subjectTr?.text ?? ticket.subject}</p>
                                                {subjectTr && (
                                                    <p className="text-[10px] text-slate-500 truncate" title={`Original (${languageName(subjectTr.sourceLang)})`}>
                                                        <i className="fa-solid fa-language mr-1 text-brand-cyan/60" />{ticket.subject}
                                                    </p>
                                                )}
                                                <p className="text-[10px] text-slate-500 mt-0.5">
                                                    {ticket.profiles?.display_name ?? 'Unknown'} · {ticket.category} · {new Date(ticket.created_at).toLocaleDateString()}
                                                </p>
                                                {!selected && (
                                                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{descTr?.text ?? ticket.description}</p>
                                                )}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-1 rounded-full border ${STATUS_COLORS[ticket.status] ?? ''}`}>
                                            {ticket.status}
                                        </span>
                                    </div>
                                </button>
                                )
                            })}
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
                            {threadTr.subject && (
                                <p className="text-sm font-semibold text-brand-cyan/90">
                                    <i className="fa-solid fa-language mr-1.5" />
                                    {threadTr.subject.text}
                                </p>
                            )}
                            <p className="text-[11px] text-slate-500">
                                From: <span className="text-slate-400 font-semibold">{selected.profiles?.display_name ?? 'Unknown'}</span>
                                {' · '}{new Date(selected.created_at).toLocaleString()}
                            </p>
                        </div>

                        {/* Buyer problem report: the order this ticket put on hold, and
                            the three ways to close it. The refund itself happens in the
                            Stripe dashboard (or from Cardstreet funds); this records the
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
                                <TranslationBlock
                                    translation={threadTr.description}
                                    pending={threadTranslating && needsEnglish(selected.description)}
                                />
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
                                            <p className="text-[10px] font-bold uppercase text-brand-cyan mb-2">Cardstreet Team</p>
                                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                                            <p className="text-[10px] text-slate-600 mt-2">{new Date(msg.created_at).toLocaleString()}</p>
                                        </div>
                                    ) : (
                                        <div key={msg.id} className="bg-white/5 rounded-xl p-4">
                                            <p className="text-[10px] font-bold uppercase text-slate-500 mb-2">{userName}</p>
                                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                                            <TranslationBlock
                                                translation={threadTr[`msg:${msg.id}`]}
                                                pending={threadTranslating && needsEnglish(msg.body)}
                                            />
                                            <p className="text-[10px] text-slate-600 mt-2">{new Date(msg.created_at).toLocaleString()}</p>
                                        </div>
                                    ))}

                                    {/* Legacy single-shot reply, shown only until the
                                        20260724 migration backfills it into the thread. */}
                                    {!hasAdminMessage && selected.admin_reply && (
                                        <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-4">
                                            <p className="text-[10px] font-bold uppercase text-brand-cyan mb-2">Cardstreet Team</p>
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
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[10px] font-bold uppercase text-slate-500">Reply</p>
                                {replyTarget && (
                                    draftBeforeTranslate !== null ? (
                                        <button
                                            onClick={() => { setReplyText(draftBeforeTranslate); setDraftBeforeTranslate(null) }}
                                            className="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition"
                                        >
                                            Undo translation
                                        </button>
                                    ) : (
                                        <button
                                            onClick={translateReply}
                                            disabled={replyTranslating || !replyText.trim()}
                                            className="text-[10px] font-bold text-brand-cyan hover:underline disabled:opacity-40 disabled:no-underline transition"
                                        >
                                            <i className="fa-solid fa-language mr-1" />
                                            {replyTranslating ? 'Translating…' : `Translate to ${languageName(replyTarget)}`}
                                        </button>
                                    )
                                )}
                            </div>
                            <textarea
                                value={replyText}
                                onChange={e => setReplyText(e.target.value)}
                                rows={draftBeforeTranslate !== null ? 8 : 4}
                                maxLength={5000}
                                placeholder={replyTarget ? `Write in English, then translate to ${languageName(replyTarget)}…` : 'Type your response here…'}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/50 resize-none"
                            />
                            {replyNotice && <p className="text-[10px] text-amber-300">{replyNotice}</p>}
                            {draftBeforeTranslate !== null && (
                                <p className="text-[10px] text-slate-500">Machine translation: check names and amounts before sending. The English original stays below it.</p>
                            )}
                            <p className="text-[10px] text-slate-600">The customer gets your reply by email and in the app.</p>
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
