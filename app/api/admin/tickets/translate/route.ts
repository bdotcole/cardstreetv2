import { requireAdmin } from '@/lib/adminAuth'
import { translateTextsDetailed, type TranslateTarget } from '@/lib/supportTranslate'
import { NextResponse } from 'next/server'

const TARGETS: TranslateTarget[] = ['en', 'th', 'ja']
const MAX_ITEMS = 60
const MAX_TOTAL_CHARS = 40_000

// POST /api/admin/tickets/translate — admin only.
// Body: { items: [{ id, text }], target?: 'en' | 'th' | 'ja' }
// Returns { translations: { [id]: { text, sourceLang } | null }, error? }; null
// means no translation is needed, a missing id means translation failed, and
// `error` says why the batch failed (billing, quota, no key) so the inbox can
// tell the team instead of showing originals silently.
// Admin-gated so it is never an open Gemini proxy.
export async function POST(request: Request) {
    const gate = await requireAdmin()
    if (gate) return gate

    const body = await request.json().catch(() => ({}))
    const target: TranslateTarget = TARGETS.includes(body?.target) ? body.target : 'en'
    const raw: unknown[] = Array.isArray(body?.items) ? body.items : []
    const items = raw
        .filter((i): i is { id: string; text: string } =>
            !!i && typeof (i as { id?: unknown }).id === 'string' && typeof (i as { text?: unknown }).text === 'string')
        .slice(0, MAX_ITEMS)
        .map((i) => ({ id: i.id.slice(0, 100), text: i.text.slice(0, 5000) }))

    if (items.reduce((n, i) => n + i.text.length, 0) > MAX_TOTAL_CHARS) {
        return NextResponse.json({ error: 'too much text' }, { status: 413 })
    }

    const { translations, error } = await translateTextsDetailed(items, target)
    return NextResponse.json(error ? { translations, error } : { translations })
}
