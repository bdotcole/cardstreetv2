'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_MAX_CHARS, type AdminChatMessage, type AdminChatThread } from '@/lib/chat'
import { personName, type InboxPerson } from '@/lib/supportInbox'
import { TranslationBlock, scriptLang, useTranslator } from '../_translation'
import { Composer, Spinner } from './_parts'

const POLL_MS = 10_000

/**
 * A chat with the support shop. With no threadId it is a new conversation:
 * nothing exists until the first message, which creates it.
 */
export function DmPane({ threadId, person: initialPerson, auto, onChanged, onStarted }: {
    threadId: string | null
    person: InboxPerson | null
    auto: boolean
    onChanged: () => void
    onStarted: (threadId: string) => void
}) {
    const [person, setPerson] = useState<InboxPerson | null>(initialPerson)
    const [messages, setMessages] = useState<AdminChatMessage[]>([])
    const [loading, setLoading] = useState(!!threadId)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState('')
    const translator = useTranslator()
    const messagesRef = useRef<AdminChatMessage[]>([])
    messagesRef.current = messages
    const scrollRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!threadId) return
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetch(`/api/admin/messages/${threadId}`, { cache: 'no-store' })
                if (cancelled) return
                if (!res.ok) {
                    setError(res.status === 404 ? 'That conversation is not in the support inbox.' : `Could not load the conversation (${res.status}).`)
                    return
                }
                const data = await res.json()
                const thread = data.thread as AdminChatThread
                setPerson(thread.other)
                setMessages(data.messages ?? [])
                // Opening it marked it read on the server.
                onChanged()
            } catch {
                if (!cancelled) setError('Could not load the conversation.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
        // onChanged only refreshes the list; re-running on its identity would reload the thread.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [threadId])

    const poll = useCallback(async () => {
        const last = messagesRef.current[messagesRef.current.length - 1]
        if (!threadId || !last || document.visibilityState !== 'visible') return
        try {
            const res = await fetch(`/api/admin/messages/${threadId}?after=${encodeURIComponent(last.createdAt)}`, { cache: 'no-store' })
            if (!res.ok) return
            const data = await res.json()
            const fresh: AdminChatMessage[] = (data.messages ?? []).filter(
                (m: AdminChatMessage) => !messagesRef.current.some(x => x.id === m.id),
            )
            if (fresh.length > 0) setMessages(prev => [...prev, ...fresh])
        } catch {
            // The next poll tries again.
        }
    }, [threadId])

    useEffect(() => {
        const timer = window.setInterval(poll, POLL_MS)
        return () => window.clearInterval(timer)
    }, [poll])

    const { translate } = translator
    useEffect(() => {
        if (!auto) return
        translate(messages.filter(m => !m.fromSupport).slice(-60).map(m => ({ id: `msg:${m.id}`, text: m.body })))
    }, [auto, messages, translate])

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages.length])

    const replyLang = (() => {
        for (const m of [...messages].reverse()) {
            if (m.fromSupport) continue
            const lang = scriptLang(m.body)
            if (lang) return lang
        }
        return null
    })()

    const send = async (body: string): Promise<string | null> => {
        try {
            if (!threadId) {
                if (!person) return 'Nobody to send to.'
                const res = await fetch('/api/admin/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toUserId: person.id, body }),
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok) return data.error || `Send failed (${res.status}).`
                onStarted(data.threadId)
                return null
            }
            const res = await fetch(`/api/admin/messages/${threadId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) return data.error || `Send failed (${res.status}).`
            if (data.message) setMessages(prev => (prev.some(m => m.id === data.message.id) ? prev : [...prev, data.message]))
            onChanged()
            return null
        } catch {
            return 'Send failed. Check the connection and try again.'
        }
    }

    const name = personName(person)

    return (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-black text-white truncate">{name}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                        {person?.username ? `@${person.username} · ` : ''}Chat with the Cardstreet TCG Marketplace shop
                    </p>
                </div>
                {person?.username && (
                    <a
                        href={`/seller/${encodeURIComponent(person.username)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-bold text-brand-cyan hover:underline shrink-0"
                    >
                        View shop ↗
                    </a>
                )}
            </div>

            <div ref={scrollRef} className="glass rounded-2xl border border-white/10 p-4 space-y-3 flex-1 min-h-[16rem] overflow-y-auto">
                {loading ? <Spinner /> : error ? (
                    <p className="text-center text-rose-300 text-sm py-10">{error}</p>
                ) : messages.length === 0 ? (
                    <p className="text-center text-slate-500 text-sm py-10">
                        {threadId ? 'No messages' : `New conversation. ${name} sees it as a message from the Cardstreet TCG Marketplace shop.`}
                    </p>
                ) : messages.map(m => (
                    <div key={m.id} className={`flex ${m.fromSupport ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-xl p-3 ${m.fromSupport ? 'bg-brand-cyan/5 border border-brand-cyan/20' : 'bg-white/5'}`}>
                            <p className={`text-[10px] font-bold uppercase mb-1 ${m.fromSupport ? 'text-brand-cyan' : 'text-slate-500'}`}>
                                {m.fromSupport ? 'Cardstreet Team' : name}
                            </p>
                            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                            {!m.fromSupport && <TranslationBlock id={`msg:${m.id}`} text={m.body} translator={translator} auto={auto} />}
                            <p className="text-[10px] text-slate-600 mt-1.5">{new Date(m.createdAt).toLocaleString()}</p>
                        </div>
                    </div>
                ))}
            </div>

            <Composer
                draft={draft}
                setDraft={setDraft}
                maxChars={CHAT_MAX_CHARS}
                replyLang={replyLang}
                auto={auto}
                label="Reply as Cardstreet TCG Marketplace"
                hint="Goes to their in-app chat with a push or email alert"
                onSend={send}
                disabled={!!error || (!threadId && !person)}
            />
        </div>
    )
}
