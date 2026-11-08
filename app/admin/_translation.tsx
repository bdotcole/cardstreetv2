'use client'

import { languageName } from '@/lib/languageNames'

// Machine translation shared by the admin Tickets and Messages pages. Both go
// through the admin-gated /api/admin/tickets/translate (lib/supportTranslate).

export interface Translation {
    text: string
    sourceLang: string
}

// Mirrors needsTranslation() in lib/supportTranslate.ts: pure-ASCII text is
// read as English already, so only the rest is sent to be translated.
export const needsEnglish = (text: string | null | undefined) => !!text && /[^\x00-\x7F]/.test(text)

// Languages a reply composer can translate a draft into.
export const REPLY_TARGETS = ['th', 'ja']

/**
 * Translates a batch. Per id: a Translation, null when the text needs none,
 * absent when that item failed. The whole call returns null on failure.
 */
export async function requestTranslations(
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

export function TranslationBlock({ translation, pending }: { translation: Translation | null | undefined; pending: boolean }) {
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
