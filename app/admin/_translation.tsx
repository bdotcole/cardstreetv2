'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { languageName } from '@/lib/languageNames'

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

const MAX_BATCH_ITEMS = 60
const MAX_BATCH_CHARS = 30_000

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
        if (!res.ok) return null
        const data = await res.json()
        return data.translations ?? null
    } catch {
        return null
    }
}

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
 * The inbox's auto-translate switch, remembered per browser. null until the
 * saved choice is read, so nothing is translated before it is known.
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
 * auto-translate is on, behind a Translate link when it is off.
 */
export function TranslationBlock({ id, text, translator, auto }: {
    id: string
    text: string | null | undefined
    translator: Translator
    auto: boolean
}) {
    if (!needsEnglish(text)) return null
    const translation = translator.map[id]
    const visible = auto || translator.manual.has(id)
    if (translator.pending.has(id) && visible) {
        return <p className="text-[10px] text-slate-500 mt-2 italic">Translating to English…</p>
    }
    if (!visible || translation === undefined) {
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
