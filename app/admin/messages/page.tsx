'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { languageName } from '@/lib/languageNames'
import { CHAT_MAX_CHARS, type AdminChatMessage, type AdminChatThread } from '@/lib/chat'
import { REPLY_TARGETS, TranslationBlock, needsEnglish, requestTranslations, type Translation } from '../_translation'

// The support account's chat inbox. The team messages users from the
// "Cardstreet TCG Marketplace" shop, users answer it like any other shop, and
// those answers land here (and as an email to the support inbox).

const POLL_MS = 10_000

const nameOf = (t: AdminChatThread | null) => t?.other.display_name?.trim() || t?.other.username || 'Unknown user'

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

function when(iso: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    const sameDay = d.toDateString() === new Date().toDateString()
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export default function AdminMessagesPage() {
    const [threads, setThreads] = useState<AdminChatThread[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [listError, setListError] = useState<string | null>(null)
    const [selected, setSelected] = useState<AdminChatThread | null>(null)
    const [messages, setMessages] = useState<AdminChatMessage[]>([])
    const [threadLoading, setThreadLoading] = useState(false)
    // English for the other side's messages (`msg:<id>`) and list previews
    // (`preview:<threadId>`). undefined = not translated yet, null = already English.
    const [threadTr, setThreadTr] = useState<Record<string, Translation | null>>({})
    const [listTr, setListTr] = useState<Record<string, Translation | null>>({})
    const [translating, setTranslating] = useState(false)
    const [draft, setDraft] = useState('')
    const [draftBeforeTranslate, setDraftBeforeTranslate] = useState<string | null>(null)
    const [replyTranslating, setReplyTranslating] = useState(false)
    const [sending, setSending] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)
    // The open conversation: state for rendering, the ref to guard async
    // results against the admin having moved to another one meanwhile.
    const [openId, setOpenId] = useState<string | null>(null)
    const openIdRef = useRef<string | null>(null)
    const messagesRef = useRef<AdminChatMessage[]>([])
    const deepLinkRef = useRef<string | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const listTrRef = useRef(listTr)
    listTrRef.current = listTr
    messagesRef.current = messages

    const translatePreviews = useCallback(async (list: AdminChatThread[]) => {
        const items = list
            .slice(0, 40)
            .filter(t => !t.lastSenderIsSupport && needsEnglish(t.lastMessagePreview))
            .map(t => ({ id: `preview:${t.id}:${t.lastMessageAt}`, text: t.lastMessagePreview! }))
            .filter(i => !(i.id in listTrRef.current))
        if (items.length === 0) return
        const result = await requestTranslations(items)
        if (result) setListTr(prev => ({ ...prev, ...result }))
    }, [])

    const fetchList = useCallback(async (): Promise<AdminChatThread[] | null> => {
        try {
            const res = await fetch('/api/admin/messages', { cache: 'no-store' })
            if (!res.ok) {
                setListError(`Could not load messages (${res.status})`)
                return null
            }
            const data = await res.json()
            const list: AdminChatThread[] = data.threads ?? []
            setThreads(list)
            setUnreadCount(data.unreadCount ?? 0)
            setListError(null)
            translatePreviews(list)
            return list
        } catch {
            setListError('Could not load messages')
            return null
        } finally {
            setLoading(false)
        }
    }, [translatePreviews])

    const translateMessages = useCallback(async (threadId: string, list: AdminChatMessage[]) => {
        const items = list
            .filter(m => !m.fromSupport && needsEnglish(m.body))
            .map(m => ({ id: `msg:${m.id}`, text: m.body }))
        if (items.length === 0) return
        setTranslating(true)
        try {
            const result = await requestTranslations(items)
            if (result && openIdRef.current === threadId) setThreadTr(prev => ({ ...prev, ...result }))
        } finally {
            if (openIdRef.current === threadId) setTranslating(false)
        }
    }, [])

    const openThread = useCallback(async (id: string, summary?: AdminChatThread) => {
        openIdRef.current = id
        setOpenId(id)
        setSelected(summary ?? null)
        setMessages([])
        setThreadTr({})
        setTranslating(false)
        setDraft('')
        setDraftBeforeTranslate(null)
        setNotice(null)
        setThreadLoading(true)
        try {
            const res = await fetch(`/api/admin/messages/${id}`, { cache: 'no-store' })
            if (openIdRef.current !== id) return
            if (!res.ok) {
                setNotice(res.status === 404 ? 'That conversation is not in the support inbox.' : `Could not load the conversation (${res.status}).`)
                return
            }
            const data = await res.json()
            const list: AdminChatMessage[] = data.messages ?? []
            setSelected(data.thread)
            setMessages(list)
            // Opening it read it: clear the unread mark without waiting for the poll.
            setThreads(prev => prev.map(t => t.id === id ? { ...t, unread: false } : t))
            setUnreadCount(prev => (summary?.unread ? Math.max(0, prev - 1) : prev))
            translateMessages(id, list)
        } finally {
            if (openIdRef.current === id) setThreadLoading(false)
        }
    }, [translateMessages])

    const pollThread = useCallback(async () => {
        const id = openIdRef.current
        const last = messagesRef.current[messagesRef.current.length - 1]
        if (!id || !last) return
        try {
            const res = await fetch(`/api/admin/messages/${id}?after=${encodeURIComponent(last.createdAt)}`, { cache: 'no-store' })
            if (!res.ok || openIdRef.current !== id) return
            const data = await res.json()
            const fresh: AdminChatMessage[] = (data.messages ?? []).filter(
                (m: AdminChatMessage) => !messagesRef.current.some(x => x.id === m.id),
            )
            if (fresh.length === 0) return
            setMessages(prev => [...prev, ...fresh])
            translateMessages(id, fresh)
        } catch {
            // The next poll tries again.
        }
    }, [translateMessages])

    // ?thread=<id> from the chat email's "Reply in admin" button.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const id = params.get('thread')
        if (id && /^[0-9a-f-]{36}$/i.test(id)) deepLinkRef.current = id
        if (id) {
            params.delete('thread')
            for (const k of [...params.keys()]) if (k.startsWith('utm_')) params.delete(k)
            const rest = params.toString()
            window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`)
        }
        fetchList().then(list => {
            const wanted = deepLinkRef.current
            if (!wanted) return
            deepLinkRef.current = null
            openThread(wanted, list?.find(t => t.id === wanted))
        })
    }, [fetchList, openThread])

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return
            fetchList()
            pollThread()
        }, POLL_MS)
        return () => window.clearInterval(timer)
    }, [fetchList, pollThread])

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages.length, selected?.id])

    // The user's language, from the most recent translated message of theirs.
    const userLang = (() => {
        for (const m of [...messages].reverse()) {
            const tr = !m.fromSupport ? threadTr[`msg:${m.id}`] : undefined
            if (tr?.sourceLang) return tr.sourceLang
        }
        return null
    })()
    const replyTarget = userLang && REPLY_TARGETS.includes(userLang) ? userLang as 'th' | 'ja' : null

    // "<their language>, then the English original", the way the team writes
    // to Thai sellers, so they can read it and anyone can check it.
    const translateDraft = async () => {
        const text = draft.trim()
        if (!text || !replyTarget) return
        setReplyTranslating(true)
        setNotice(null)
        try {
            const result = await requestTranslations([{ id: 'reply', text }], replyTarget)
            const tr = result?.reply
            if (tr === undefined) setNotice('Translation failed. Try again, or send in English.')
            else if (tr === null) setNotice(`The draft is already in ${languageName(replyTarget)}.`)
            else {
                setDraftBeforeTranslate(draft)
                setDraft(`${tr.text}\n\n${text}`)
            }
        } finally {
            setReplyTranslating(false)
        }
    }

    const send = async () => {
        const id = openIdRef.current
        const body = draft.trim()
        if (!id || !body || sending) return
        setSending(true)
        setNotice(null)
        try {
            const res = await fetch(`/api/admin/messages/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setNotice(data.error || `Send failed (${res.status}).`)
                return
            }
            if (openIdRef.current === id && data.message) setMessages(prev => [...prev, data.message])
            setDraft('')
            setDraftBeforeTranslate(null)
            fetchList()
        } catch {
            setNotice('Send failed. Check the connection and try again.')
        } finally {
            setSending(false)
        }
    }

    const over = draft.trim().length > CHAT_MAX_CHARS

    return (
        <div className="flex flex-col lg:flex-row gap-6 animate-fadeIn lg:h-[calc(100vh-10.5rem)]">
            {/* Conversation list */}
            <div className={`flex-col space-y-4 lg:w-[22rem] lg:shrink-0 lg:flex min-h-0 ${openId ? 'hidden' : 'flex'}`}>
                <div>
                    <h1 className="text-xl font-black text-white italic">Messages</h1>
                    <p className="text-slate-500 text-sm">
                        {threads.length} conversations{unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                        Chats with the Cardstreet TCG Marketplace shop. Users see your replies as messages from that shop.
                    </p>
                </div>

                <div className="glass rounded-2xl border border-white/10 overflow-hidden flex-1 min-h-0 overflow-y-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="animate-spin h-8 w-8 border-2 border-white/10 border-t-brand-cyan rounded-full" />
                        </div>
                    ) : listError ? (
                        <p className="px-6 py-16 text-center text-rose-300 text-sm">{listError}</p>
                    ) : threads.length === 0 ? (
                        <p className="px-6 py-16 text-center text-slate-500 text-sm">No conversations yet</p>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {threads.map(t => {
                                const name = nameOf(t)
                                const previewTr = listTr[`preview:${t.id}:${t.lastMessageAt}`]
                                const active = selected?.id === t.id
                                return (
                                    <button
                                        key={t.id}
                                        onClick={() => openThread(t.id, t)}
                                        className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-white/5 transition-all ${active ? 'bg-brand-cyan/5 border-l-2 border-brand-cyan' : ''}`}
                                    >
                                        <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-black text-slate-300 shrink-0">
                                            {initials(name)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className={`text-sm truncate ${t.unread ? 'font-black text-white' : 'font-semibold text-slate-200'}`}>{name}</p>
                                                <span className="text-[10px] text-slate-500 shrink-0">{when(t.lastMessageAt)}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <p className={`text-[11px] truncate flex-1 ${t.unread ? 'text-slate-200' : 'text-slate-500'}`}>
                                                    {t.lastSenderIsSupport ? 'You: ' : ''}{previewTr?.text ?? t.lastMessagePreview ?? ''}
                                                </p>
                                                {t.unread && <span className="w-2 h-2 rounded-full bg-brand-cyan shrink-0" aria-label="Unread" />}
                                            </div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Conversation */}
            {openId ? (
                <div className="flex-1 flex flex-col min-h-0 min-w-0 space-y-3 animate-fadeIn">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <button
                                onClick={() => { openIdRef.current = null; setOpenId(null); setSelected(null); setMessages([]); setNotice(null) }}
                                className="text-slate-500 hover:text-slate-300 transition text-xs font-bold"
                            >
                                <i className="fa-solid fa-arrow-left mr-1" />
                                <span className="lg:hidden">Back</span>
                                <span className="hidden lg:inline">Close</span>
                            </button>
                            <div className="min-w-0">
                                <p className="text-sm font-black text-white truncate">{nameOf(selected)}</p>
                                {selected?.other.username && (
                                    <p className="text-[11px] text-slate-500 truncate">@{selected.other.username}</p>
                                )}
                            </div>
                        </div>
                        {selected?.other.username && (
                            <a
                                href={`/seller/${encodeURIComponent(selected.other.username)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-bold text-brand-cyan hover:underline shrink-0"
                            >
                                View shop ↗
                            </a>
                        )}
                    </div>

                    <div ref={scrollRef} className="glass rounded-2xl border border-white/10 p-4 space-y-3 flex-1 min-h-[16rem] overflow-y-auto">
                        {threadLoading ? (
                            <div className="flex items-center justify-center py-10">
                                <div className="animate-spin h-6 w-6 border-2 border-white/10 border-t-brand-cyan rounded-full" />
                            </div>
                        ) : messages.length === 0 ? (
                            <p className="text-center text-slate-500 text-sm py-10">No messages</p>
                        ) : messages.map(m => (
                            <div key={m.id} className={`flex ${m.fromSupport ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-xl p-3 ${m.fromSupport ? 'bg-brand-cyan/5 border border-brand-cyan/20' : 'bg-white/5'}`}>
                                    <p className={`text-[10px] font-bold uppercase mb-1 ${m.fromSupport ? 'text-brand-cyan' : 'text-slate-500'}`}>
                                        {m.fromSupport ? 'Cardstreet Team' : nameOf(selected)}
                                    </p>
                                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                                    {!m.fromSupport && (
                                        <TranslationBlock translation={threadTr[`msg:${m.id}`]} pending={translating && needsEnglish(m.body)} />
                                    )}
                                    <p className="text-[10px] text-slate-600 mt-1.5">{new Date(m.createdAt).toLocaleString()}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Composer */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-[10px] font-bold uppercase text-slate-500">Reply as Cardstreet TCG Marketplace</p>
                            {replyTarget && (
                                draftBeforeTranslate !== null ? (
                                    <button
                                        onClick={() => { setDraft(draftBeforeTranslate); setDraftBeforeTranslate(null) }}
                                        className="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition"
                                    >
                                        Undo translation
                                    </button>
                                ) : (
                                    <button
                                        onClick={translateDraft}
                                        disabled={replyTranslating || !draft.trim()}
                                        className="text-[10px] font-bold text-brand-cyan hover:underline disabled:opacity-40 disabled:no-underline transition"
                                    >
                                        <i className="fa-solid fa-language mr-1" />
                                        {replyTranslating ? 'Translating…' : `Translate to ${languageName(replyTarget)}`}
                                    </button>
                                )
                            )}
                        </div>
                        <textarea
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
                            rows={draftBeforeTranslate !== null ? 7 : 3}
                            disabled={!selected}
                            placeholder={replyTarget ? `Write in English, then translate to ${languageName(replyTarget)}…` : 'Type your reply…'}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/50 resize-none disabled:opacity-50"
                        />
                        {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
                        {draftBeforeTranslate !== null && (
                            <p className="text-[10px] text-slate-500">Machine translation: check names and amounts before sending. The English original stays below it.</p>
                        )}
                        <div className="flex items-center justify-between gap-3">
                            <p className={`text-[10px] ${over ? 'text-rose-300' : 'text-slate-600'}`}>
                                {draft.trim().length} / {CHAT_MAX_CHARS} · Goes to their in-app chat with a push or email alert · Ctrl+Enter sends
                            </p>
                            <button
                                onClick={send}
                                disabled={sending || !draft.trim() || over || !selected}
                                className="px-5 py-2.5 bg-brand-cyan text-brand-darker font-black text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 shrink-0"
                            >
                                {sending ? 'Sending…' : 'Send'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="hidden lg:flex flex-1 items-center justify-center glass rounded-2xl border border-white/10">
                    <p className="text-slate-500 text-sm">Pick a conversation</p>
                </div>
            )}
        </div>
    )
}
