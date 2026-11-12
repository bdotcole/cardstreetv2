'use client'

import { useEffect, useRef, useState } from 'react'
import { CHAT_MAX_CHARS } from '@/lib/chat'

// Write to a buyer or seller from the support shop without leaving the page
// you are on (an order, mostly). It posts to the same route the Support inbox
// uses, so the message lands in their Cardstreet chat with a push and email,
// and the conversation carries on in /admin/inbox. The box opens with the
// order reference already typed: a support chat has no order attached, and a
// seller with several open sales cannot tell which one "your order" means.

export function SupportMessageBox({ toUserId, toName, prefix, onSent, onClose }: {
    toUserId: string
    toName: string
    /** Typed into the box on open, e.g. "Order #D15B78DB (Raikou): ". */
    prefix?: string
    onSent?: () => void
    onClose: () => void
}) {
    const [body, setBody] = useState(prefix ?? '')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sentThread, setSentThread] = useState<string | null>(null)
    const boxRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        const el = boxRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
    }, [])

    const text = body.trim()
    // The reference alone is not a message.
    const empty = !text || text === (prefix ?? '').trim()

    const send = async () => {
        if (busy || empty) return
        setBusy(true)
        setError(null)
        try {
            const res = await fetch('/api/admin/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toUserId, body: text }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setError(data?.error || `Could not send (${res.status})`)
                return
            }
            setSentThread(data.threadId ?? '')
            setBody(prefix ?? '')
            onSent?.()
        } catch {
            setError('Could not send. Check the connection and try again.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="rounded-xl border border-brand-cyan/20 bg-black/20 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase text-slate-500">
                Message {toName} from the Cardstreet support shop
            </p>
            <textarea
                ref={boxRef}
                value={body}
                onChange={e => { setBody(e.target.value); setSentThread(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }}
                rows={4}
                maxLength={CHAT_MAX_CHARS}
                placeholder="Write your message"
                className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-brand-cyan/50 resize-y"
            />
            {error && <p className="text-xs text-rose-300">{error}</p>}
            {sentThread !== null && (
                <p className="text-xs text-emerald-300">
                    <i className="fa-solid fa-check mr-1.5" />Sent. They get a push and an email.
                    {sentThread && (
                        <>
                            {' '}
                            <a href={`/admin/inbox?open=dm:${sentThread}`} target="_blank" rel="noopener noreferrer" className="font-bold text-brand-cyan hover:underline">Open the conversation</a>
                        </>
                    )}
                </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <button
                    onClick={send}
                    disabled={busy || empty}
                    className="h-8 px-4 rounded-lg bg-brand-cyan text-brand-darker text-xs font-black hover:brightness-110 transition disabled:opacity-40"
                >
                    {busy ? 'Sending…' : 'Send'}
                </button>
                <button onClick={onClose} disabled={busy} className="h-8 px-2 text-xs font-bold text-slate-400 hover:text-white transition">
                    Close
                </button>
                <a
                    href={`/admin/inbox?dm=${toUserId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-[11px] font-bold text-slate-500 hover:text-brand-cyan transition"
                >
                    Full chat history <i className="fa-solid fa-arrow-up-right-from-square text-[9px]" />
                </a>
            </div>
        </div>
    )
}
