'use client'

import { useEffect, useState } from 'react'
import { TranslationBlock, scriptLang, useTranslator } from '../_translation'
import { Composer, Spinner, StatusChip } from './_parts'

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

const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved']
// support_tickets.admin_reply / support_ticket_messages.body
const TICKET_MAX_CHARS = 5000

/** A support ticket (Profile → Support) or a buyer's problem report on an order. */
export function TicketPane({ ticketId, auto, onChanged }: { ticketId: string; auto: boolean; onChanged: () => void }) {
    const [ticket, setTicket] = useState<Ticket | null>(null)
    const [thread, setThread] = useState<TicketMessage[]>([])
    const [dispute, setDispute] = useState<DisputeInfo | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState('')
    const [nextStatus, setNextStatus] = useState('')
    const [resolving, setResolving] = useState<string | null>(null)
    const translator = useTranslator()
    const { translate } = translator

    const load = async () => {
        const res = await fetch(`/api/admin/tickets/${ticketId}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(res.status === 404 ? 'That ticket was not found.' : `Could not load the ticket (${res.status}).`)
        const data = await res.json()
        setTicket(data.ticket)
        setThread(data.messages ?? [])
        setDispute(data.dispute ?? null)
        return data.ticket as Ticket
    }

    useEffect(() => {
        let cancelled = false
        load()
            .then(t => { if (!cancelled) setNextStatus(t.status) })
            .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the ticket.') })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticketId])

    useEffect(() => {
        if (!auto || !ticket) return
        translate([
            { id: 'subject', text: ticket.subject },
            { id: 'description', text: ticket.description },
            ...thread.filter(m => m.sender_role === 'user').slice(-58).map(m => ({ id: `msg:${m.id}`, text: m.body })),
        ])
    }, [auto, ticket, thread, translate])

    const replyLang = (() => {
        const userTexts = [ticket?.description, ticket?.subject, ...thread.filter(m => m.sender_role === 'user').map(m => m.body)].reverse()
        for (const text of userTexts) {
            const lang = scriptLang(text)
            if (lang) return lang
        }
        return null
    })()

    const send = async (body: string): Promise<string | null> => {
        if (!ticket) return 'The ticket is not loaded.'
        try {
            const res = await fetch(`/api/admin/tickets/${ticket.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: nextStatus, admin_reply: body || undefined }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) return data.error || `Could not save (${res.status}).`
            setTicket(prev => (prev ? { ...prev, ...data.ticket } : prev))
            if (data.message) setThread(prev => [...prev, data.message])
            onChanged()
            return null
        } catch {
            return 'Could not save. Check the connection and try again.'
        }
    }

    // The order this report put on hold, and the three ways to close it. The
    // refund itself happens in the Stripe dashboard; this records the outcome,
    // restores or cancels the order, and closes the ticket with the draft as
    // the buyer-facing answer.
    const resolveDispute = async (outcome: 'refunded' | 'rejected' | 'resolved') => {
        if (!dispute || !ticket) return
        const labels = { refunded: 'refund the buyer (mark cancelled)', rejected: 'reject the report', resolved: 'mark resolved' }
        if (!window.confirm(`This will ${labels[outcome]} and close the ticket. Continue?`)) return
        setResolving(outcome)
        try {
            const res = await fetch(`/api/admin/orders/${dispute.id}/dispute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outcome, note: draft.trim() }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                window.alert(data.error || `Server returned ${res.status}`)
                return
            }
            setDraft('')
            await load().then(t => setNextStatus(t.status)).catch(() => {})
            onChanged()
        } finally {
            setResolving(null)
        }
    }

    if (loading) return <div className="flex-1"><Spinner /></div>
    if (error || !ticket) return <p className="flex-1 text-center text-rose-300 text-sm py-10">{error ?? 'Ticket not found.'}</p>

    const userName = ticket.profiles?.display_name ?? 'User'
    const hasAdminMessage = thread.some(m => m.sender_role === 'admin')
    const subjectTr = translator.map.subject
    const statusChanged = nextStatus !== ticket.status

    return (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 space-y-3">
            <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <StatusChip status={ticket.status} />
                    <span className="text-[9px] font-bold text-slate-500 uppercase bg-white/5 px-2 py-0.5 rounded-full">{ticket.category}</span>
                    <span className="text-[10px] text-slate-500">#{ticket.id.slice(0, 8).toUpperCase()}</span>
                </div>
                <h2 className="text-base font-black text-white break-words">{ticket.subject}</h2>
                {subjectTr && (auto || translator.manual.has('subject')) && (
                    <p className="text-sm font-semibold text-brand-cyan/90"><i className="fa-solid fa-language mr-1.5" />{subjectTr.text}</p>
                )}
                <p className="text-[11px] text-slate-500">
                    From <span className="text-slate-400 font-semibold">{userName}</span> · {new Date(ticket.created_at).toLocaleString()}
                </p>
            </div>

            <div className="glass rounded-2xl border border-white/10 p-4 space-y-3 flex-1 min-h-[16rem] overflow-y-auto">
                {dispute && (
                    <div className="rounded-xl border border-brand-red/30 bg-brand-red/5 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-[10px] font-bold uppercase text-rose-300">
                                Problem report · order #{dispute.id.slice(0, 8).toUpperCase()}
                            </p>
                            <a href={`/admin/orders?q=${dispute.id}`} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-brand-cyan hover:underline">
                                Open order (contacts, parcel) ↗
                            </a>
                        </div>
                        <p className="text-sm text-slate-300">
                            ฿{Math.round(Number(dispute.total_amount) || 0).toLocaleString()} · {dispute.dispute_reason ?? 'reason not recorded'} · status <span className="font-mono">{dispute.status}</span>
                        </p>
                        {dispute.dispute_details && <p className="text-xs text-slate-400 whitespace-pre-wrap">{dispute.dispute_details}</p>}
                        {dispute.dispute_outcome ? (
                            <p className="text-xs text-emerald-300">
                                Closed: {dispute.dispute_outcome}
                                {dispute.dispute_resolved_at ? ` · ${new Date(dispute.dispute_resolved_at).toLocaleString()}` : ''}
                            </p>
                        ) : (
                            <>
                                <div className="flex flex-wrap gap-2">
                                    <button onClick={() => resolveDispute('refunded')} disabled={!!resolving} className="px-3 py-2 rounded-lg bg-rose-500/20 border border-rose-400/40 text-rose-200 text-xs font-bold hover:bg-rose-500/30 disabled:opacity-50">
                                        {resolving === 'refunded' ? 'Working…' : 'Refunded the buyer → cancel order'}
                                    </button>
                                    <button onClick={() => resolveDispute('resolved')} disabled={!!resolving} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-200 text-xs font-bold hover:bg-white/10 disabled:opacity-50">
                                        {resolving === 'resolved' ? 'Working…' : 'Resolved another way → keep order'}
                                    </button>
                                    <button onClick={() => resolveDispute('rejected')} disabled={!!resolving} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-xs font-bold hover:bg-white/10 disabled:opacity-50">
                                        {resolving === 'rejected' ? 'Working…' : 'Reject report'}
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-500">
                                    Type the reply the buyer should see below first; closing sends it as written and marks the ticket Resolved.
                                </p>
                            </>
                        )}
                    </div>
                )}

                <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">{userName}</p>
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{ticket.description}</p>
                    <TranslationBlock id="description" text={ticket.description} translator={translator} auto={auto} />
                    <p className="text-[10px] text-slate-600 mt-1.5">{new Date(ticket.created_at).toLocaleString()}</p>
                </div>

                {thread.map(m => m.sender_role === 'admin' ? (
                    <div key={m.id} className="flex justify-end">
                        <div className="max-w-[85%] bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-3">
                            <p className="text-[10px] font-bold uppercase text-brand-cyan mb-1">Cardstreet Team</p>
                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                            <p className="text-[10px] text-slate-600 mt-1.5">{new Date(m.created_at).toLocaleString()}</p>
                        </div>
                    </div>
                ) : (
                    <div key={m.id} className="bg-white/5 rounded-xl p-3 max-w-[85%]">
                        <p className="text-[10px] font-bold uppercase text-slate-500 mb-1">{userName}</p>
                        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                        <TranslationBlock id={`msg:${m.id}`} text={m.body} translator={translator} auto={auto} />
                        <p className="text-[10px] text-slate-600 mt-1.5">{new Date(m.created_at).toLocaleString()}</p>
                    </div>
                ))}

                {/* A ticket answered before threads existed keeps its one reply on the row. */}
                {!hasAdminMessage && ticket.admin_reply && (
                    <div className="flex justify-end">
                        <div className="max-w-[85%] bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl p-3">
                            <p className="text-[10px] font-bold uppercase text-brand-cyan mb-1">Cardstreet Team</p>
                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{ticket.admin_reply}</p>
                            {ticket.replied_at && <p className="text-[10px] text-slate-600 mt-1.5">{new Date(ticket.replied_at).toLocaleString()}</p>}
                        </div>
                    </div>
                )}
            </div>

            <Composer
                draft={draft}
                setDraft={setDraft}
                maxChars={TICKET_MAX_CHARS}
                replyLang={replyLang}
                auto={auto}
                label="Reply on the ticket"
                hint="They get it by email and in the app"
                onSend={send}
                sendLabel={draft.trim() ? 'Send' : 'Update status'}
                allowEmpty={statusChanged}
                extra={
                    <select
                        value={nextStatus}
                        onChange={e => setNextStatus(e.target.value)}
                        aria-label="Ticket status"
                        className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-slate-300 focus:outline-none focus:border-brand-cyan/40"
                    >
                        {TICKET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                }
            />
        </div>
    )
}
