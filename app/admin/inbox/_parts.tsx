'use client'

import { useState, type ReactNode } from 'react'
import { languageName } from '@/lib/languageNames'
import type { InboxKind } from '@/lib/supportInbox'
import { requestTranslations, type ReplyLang } from '../_translation'

export const KIND_META: Record<InboxKind, { label: string; icon: string; tone: string }> = {
    dm: { label: 'Message', icon: 'fa-regular fa-comment', tone: 'text-brand-cyan bg-brand-cyan/10 border-brand-cyan/25' },
    ticket: { label: 'Ticket', icon: 'fa-solid fa-ticket', tone: 'text-amber-300 bg-amber-400/10 border-amber-400/25' },
    report: { label: 'Report', icon: 'fa-solid fa-flag', tone: 'text-rose-300 bg-rose-500/10 border-rose-400/25' },
}

const STATUS_TONES: Record<string, string> = {
    Open: 'bg-brand-red/15 text-brand-red border-brand-red/30',
    'In Progress': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    Reviewed: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    Resolved: 'bg-brand-green/15 text-brand-green border-brand-green/30',
    Dismissed: 'bg-white/5 text-slate-400 border-white/10',
}

export function StatusChip({ status }: { status: string }) {
    if (!status) return null
    return (
        <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${STATUS_TONES[status] ?? 'bg-white/5 text-slate-400 border-white/10'}`}>
            {status}
        </span>
    )
}

export function KindChip({ kind }: { kind: InboxKind }) {
    const meta = KIND_META[kind]
    return (
        <span className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${meta.tone}`}>
            <i className={meta.icon} />{meta.label}
        </span>
    )
}

export function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase()
}

export function when(iso: string | null | undefined): string {
    if (!iso) return ''
    const d = new Date(iso)
    const sameDay = d.toDateString() === new Date().toDateString()
    return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function Spinner({ size = 'h-6 w-6' }: { size?: string }) {
    return (
        <div className="flex items-center justify-center py-10">
            <div className={`animate-spin ${size} border-2 border-white/10 border-t-brand-cyan rounded-full`} />
        </div>
    )
}

/**
 * The reply box every conversation shares. With auto-translate on and a
 * customer who writes Thai or Japanese, Send translates the English draft and
 * sends "<their language>, then the English original", so they can read it and
 * anyone can check it. "Translate to …" shows that text first instead.
 */
export function Composer({
    draft, setDraft, maxChars, replyLang, auto, label, hint, onSend, sendLabel = 'Send', allowEmpty = false, disabled = false, extra,
}: {
    draft: string
    setDraft: (value: string) => void
    maxChars: number
    replyLang: ReplyLang | null
    auto: boolean
    label: string
    hint: string
    /** Resolves to an error message, or null once it is sent. */
    onSend: (body: string) => Promise<string | null>
    sendLabel?: string
    /** Send with an empty draft (a ticket status change). */
    allowEmpty?: boolean
    disabled?: boolean
    extra?: ReactNode
}) {
    const [beforeTranslate, setBeforeTranslate] = useState<string | null>(null)
    const [translating, setTranslating] = useState(false)
    const [sending, setSending] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)

    const text = draft.trim()
    const langName = replyLang ? languageName(replyLang) : ''
    const willAutoTranslate = auto && !!replyLang && beforeTranslate === null && !!text

    const showTranslation = async () => {
        if (!text || !replyLang) return
        setTranslating(true)
        setNotice(null)
        try {
            const result = await requestTranslations([{ id: 'reply', text }], replyLang)
            const tr = result?.reply
            if (tr === undefined) setNotice('Translation failed. Try again, or send in English.')
            else if (tr === null) setNotice(`The draft is already in ${langName}.`)
            else {
                setBeforeTranslate(draft)
                setDraft(`${tr.text}\n\n${text}`)
            }
        } finally {
            setTranslating(false)
        }
    }

    const send = async () => {
        if (sending || disabled || (!text && !allowEmpty)) return
        setSending(true)
        setNotice(null)
        try {
            let body = text
            if (willAutoTranslate) {
                const result = await requestTranslations([{ id: 'reply', text }], replyLang!)
                const tr = result?.reply
                if (tr === undefined) {
                    setNotice(`Could not translate to ${langName}. Press Send again to retry, or turn auto-translate off to send in English.`)
                    return
                }
                if (tr) body = `${tr.text}\n\n${text}`
            }
            if (body.length > maxChars) {
                if (body !== text) {
                    // Show what would have gone out so it can be shortened.
                    setBeforeTranslate(draft)
                    setDraft(body)
                }
                setNotice(`Too long to send (${body.length} of ${maxChars} characters). Shorten it and send again.`)
                return
            }
            const error = await onSend(body)
            if (error) {
                setNotice(error)
                return
            }
            setDraft('')
            setBeforeTranslate(null)
        } finally {
            setSending(false)
        }
    }

    const over = text.length > maxChars

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase text-slate-500">{label}</p>
                {replyLang && (
                    beforeTranslate !== null ? (
                        <button
                            onClick={() => { setDraft(beforeTranslate); setBeforeTranslate(null); setNotice(null) }}
                            className="text-[10px] font-bold text-slate-400 hover:text-slate-200 transition"
                        >
                            Undo translation
                        </button>
                    ) : (
                        <button
                            onClick={showTranslation}
                            disabled={translating || sending || !text}
                            className="text-[10px] font-bold text-brand-cyan hover:underline disabled:opacity-40 disabled:no-underline transition"
                        >
                            <i className="fa-solid fa-language mr-1" />
                            {translating ? 'Translating…' : `Translate to ${langName}`}
                        </button>
                    )
                )}
            </div>
            <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
                rows={beforeTranslate !== null ? 7 : 3}
                disabled={disabled}
                placeholder={replyLang ? `Write in English${auto ? `; it goes out in ${langName} too` : `, then translate to ${langName}`}…` : 'Type your reply…'}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-cyan/50 resize-none disabled:opacity-50"
            />
            {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
            {beforeTranslate !== null && (
                <p className="text-[10px] text-slate-500">Machine translation: check names and amounts before sending. Your English stays under it.</p>
            )}
            {willAutoTranslate && (
                <p className="text-[10px] text-brand-cyan/80">
                    <i className="fa-solid fa-language mr-1" />Auto-translate is on: this goes out in {langName}, with your English underneath.
                </p>
            )}
            <div className="flex items-center justify-between gap-3">
                <p className={`text-[10px] ${over ? 'text-rose-300' : 'text-slate-600'}`}>
                    {text.length} / {maxChars} · {hint} · Ctrl+Enter sends
                </p>
                <div className="flex items-center gap-2 shrink-0">
                    {extra}
                    <button
                        onClick={send}
                        disabled={sending || disabled || over || (!text && !allowEmpty)}
                        className="px-5 py-2.5 bg-brand-cyan text-brand-darker font-black text-sm rounded-xl hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                    >
                        {sending ? (willAutoTranslate ? 'Translating…' : 'Sending…') : sendLabel}
                    </button>
                </div>
            </div>
        </div>
    )
}
