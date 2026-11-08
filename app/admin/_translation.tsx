'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { languageName } from '@/lib/languageNames'
import type { TranslateError } from '@/lib/supportTranslate'

// Machine translation for the admin support inbox. Everything goes through the
// admin-gated /api/admin/tickets/translate (lib/supportTranslate, Gemini).

export interface Translation {
    text: string
    sourceLang: string
}

// Mirrors needsTranslation() in lib/supportTranslate.ts: pure-ASCII text is
// read as English already, so only the rest is sent to be translated.
export const needsEnglish = (text: string | null | undefined) => !!text && /[^\x00-\x7F]/.test(text)

export type ReplyLang = 'th' | 'ja'

/**
 * The language a reply should be translated into, read from the script the
 * customer writes in. No API call, so it works with auto-translate off.
 * Kana only for Japanese: kanji alone could just as well be Chinese.
 */
export function scriptLang(text: string | null | undefined): ReplyLang | null {
    if (!text) return null
    if (/[฀-๿]/.test(text)) return 'th'
    if (/[぀-ヿ]/.test(text)) return 'ja'
    return null
}

// ─── Service status ──────────────────────────────────────────────────────────
//
// Why the inbox ever fell silent: on 2026-11-08 Gemini refused every call
// (402, prepaid credits used up) and the inbox simply showed the originals
// with a Translate link that did nothing. The route now reports why a batch
// failed and the last answer is kept here, so the page can say so.

let translateStatus: TranslateError | null = null
const statusListeners = new Set<() => void>()
function setTranslateStatus(next: TranslateError | null) {
    if (next?.code === translateStatus?.code && next?.message === translateStatus?.message) return
    translateStatus = next
    for (const l of statusListeners) l()
}
const subscribeStatus = (l: () => void) => { statusListeners.add(l); return () => { statusListeners.delete(l) } }
const getStatus = () => translateStatus
const getServerStatus = () => null

/** The last translation failure, or null while the service answers. */
export function useTranslationStatus(): TranslateError | null {
    return useSyncExternalStore(subscribeStatus, getStatus, getServerStatus)
}

/** One line for the team, with what to do about it. */
export function describeTranslateError(err: TranslateError): string {
    switch (err.code) {
        case 'billing':
            return 'Gemini prepaid credits are used up. Top up in Google AI Studio (ai.studio/projects, Billing). Card scanning uses the same account, so it is affected too.'
        case 'rate_limit':
            return 'Gemini quota or rate limit reached. It usually clears within a minute.'
        case 'no_key':
            return 'GEMINI_API_KEY is not set on the server.'
        default:
            return err.message || 'The translation service is not answering.'
    }
}

/**
 * Translates a batch. Per id: a Translation, null when the text needs none,
 * absent when that item failed. The whole call returns null on failure.
 */
export async function requestTranslations(
    items: { id: string; text: string }[],
    target: 'en' | ReplyLang = 'en',
): Promise<Record<string, Translation | null> | null> {
    try {
        const res = await fetch('/api/admin/tickets/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, target }),
        })
        if (!res.ok) {
            setTranslateStatus({ code: 'unavailable', message: `The translation request failed (${res.status}).` })
            return null
        }
        const data = await res.json()
        setTranslateStatus(data.error ?? null)
        return data.translations ?? null
    } catch {
        setTranslateStatus({ code: 'unavailable', message: 'Could not reach the translation service.' })
        return null
    }
}

const MAX_BATCH_ITEMS = 60
const MAX_BATCH_CHARS = 30_000

// The route caps a call at 60 items and 40k characters.
function chunk(items: { id: string; text: string }[]) {
    const batches: { id: string; text: string }[][] = []
    let current: { id: string; text: string }[] = []
    let chars = 0
    for (const item of items) {
        const text = item.text.slice(0, 5000)
        if (current.length >= MAX_BATCH_ITEMS || (current.length > 0 && chars + text.length > MAX_BATCH_CHARS)) {
            batches.push(current)
            current = []
            chars = 0
        }
        current.push({ id: item.id, text })
        chars += text.length
    }
    if (current.length > 0) batches.push(current)
    return batches
}

const AUTO_TRANSLATE_KEY = 'cs_admin_auto_translate'

/**
 * Whether the inbox offers automatic translation at all. Off since 2026-11-08
 * (founder: "just remove the auto translate for now") while the Gemini billing
 * is sorted out: nothing is translated unless someone presses a Translate
 * link, and the switch is hidden. Flip to true to bring the switch back; the
 * per-browser choice is still remembered underneath.
 */
export const AUTO_TRANSLATE_AVAILABLE = false

/**
 * The inbox's auto-translate switch, remembered per browser. null until the
 * saved choice is read, so nothing is translated before it is known. Always
 * off while AUTO_TRANSLATE_AVAILABLE is false.
 */
export function useAutoTranslate(): [boolean | null, (on: boolean) => void] {
    const [on, setOn] = useState<boolean | null>(null)
    useEffect(() => {
        let saved: string | null = null
        try { saved = window.localStorage.getItem(AUTO_TRANSLATE_KEY) } catch { /* private window */ }
        setOn(saved !== '0')
    }, [])
    const set = useCallback((value: boolean) => {
        setOn(value)
        try { window.localStorage.setItem(AUTO_TRANSLATE_KEY, value ? '1' : '0') } catch { /* private window */ }
    }, [])
    if (!AUTO_TRANSLATE_AVAILABLE) return [false, set]
    return [on, set]
}

/**
 * English for customer text, one map per conversation (mount it under a key
 * per conversation). `manual` marks what the admin asked for by hand, which
 * stays visible with auto-translate off.
 */
export function useTranslator() {
    const [map, setMap] = useState<Record<string, Translation | null>>({})
    const [pending, setPending] = useState<Set<string>>(() => new Set())
    const [manual, setManual] = useState<Set<string>>(() => new Set())
    const asked = useRef<Set<string>>(new Set())

    const translate = useCallback(async (items: { id: string; text: string }[], opts?: { manual?: boolean }) => {
        const wanted = items.filter(i => needsEnglish(i.text))
        if (opts?.manual && wanted.length > 0) setManual(prev => new Set([...prev, ...wanted.map(i => i.id)]))
        const todo = wanted.filter(i => !asked.current.has(i.id))
        if (todo.length === 0) return
        for (const i of todo) asked.current.add(i.id)
        setPending(prev => new Set([...prev, ...todo.map(i => i.id)]))
        const results = await Promise.all(chunk(todo).map(batch => requestTranslations(batch)))
        const merged: Record<string, Translation | null> = {}
        for (const r of results) if (r) Object.assign(merged, r)
        setMap(prev => ({ ...prev, ...merged }))
        // A failed item may be asked for again (the Translate link comes back).
        for (const i of todo) if (!(i.id in merged)) asked.current.delete(i.id)
        setPending(prev => {
            const next = new Set(prev)
            for (const i of todo) next.delete(i.id)
            return next
        })
    }, [])

    return { map, pending, manual, translate }
}

export type Translator = ReturnType<typeof useTranslator>

/**
 * The English under a customer message: shown automatically when
 * auto-translate is on, behind a Translate link when it is off. When the
 * service is failing it says so instead of offering a link that does nothing.
 */
export function TranslationBlock({ id, text, translator, auto }: {
    id: string
    text: string | null | undefined
    translator: Translator
    auto: boolean
}) {
    const status = useTranslationStatus()
    if (!needsEnglish(text)) return null
    const translation = translator.map[id]
    const visible = auto || translator.manual.has(id)
    if (translator.pending.has(id) && visible) {
        return <p className="text-[10px] text-slate-500 mt-2 italic">Translating to English…</p>
    }
    if (!visible || translation === undefined) {
        if (visible && status) {
            return (
                <p className="mt-2 text-[10px] text-amber-300/90">
                    <i className="fa-solid fa-triangle-exclamation mr-1" />
                    Not translated: {describeTranslateError(status)}{' '}
                    <button onClick={() => translator.translate([{ id, text: text! }], { manual: true })} className="font-bold underline hover:text-amber-200">
                        Try again
                    </button>
                </p>
            )
        }
        return (
            <button
                onClick={() => translator.translate([{ id, text: text! }], { manual: true })}
                className="mt-2 text-[10px] font-bold text-brand-cyan/80 hover:text-brand-cyan hover:underline"
            >
                <i className="fa-solid fa-language mr-1" />Translate to English
            </button>
        )
    }
    if (!translation) return null
    return (
        <div className="mt-2.5 border-l-2 border-brand-cyan/40 pl-3">
            <p className="text-[9px] font-bold uppercase tracking-wide text-brand-cyan/80 mb-1">
                <i className="fa-solid fa-language mr-1" />
                English · translated from {languageName(translation.sourceLang)}
            </p>
            <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap break-words">{translation.text}</p>
        </div>
    )
}

/** The banner the inbox and the composer show while translation is failing. */
export function TranslationStatusNotice({ auto }: { auto: boolean }) {
    const status = useTranslationStatus()
    if (!status) return null
    return (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
            <i className="fa-solid fa-triangle-exclamation mt-0.5 shrink-0" />
            <p>
                <span className="font-bold">{auto ? 'Auto-translate is on but translation is not working.' : 'Translation is not working.'}</span>{' '}
                {describeTranslateError(status)} Messages show in their original language until it is fixed.
            </p>
        </div>
    )
}
