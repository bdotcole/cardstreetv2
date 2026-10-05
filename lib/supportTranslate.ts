import { GoogleGenAI, Type } from '@google/genai';

/**
 * Machine translation for support tickets (server-only — uses GEMINI_API_KEY).
 *
 * Most tickets arrive in Thai and are answered by an English-reading team, so
 * the admin console and the support-inbox email both show an English rendering
 * under every customer message, and the console can turn an English draft into
 * the customer's language before it is sent.
 *
 * Fails soft everywhere: a missing key, a timeout or a malformed response
 * yields "no translation", never an error, because a translation is an aid to
 * reading the ticket and must not block reading or answering it.
 */

export type TranslateTarget = 'en' | 'th' | 'ja';

export interface Translation {
    text: string;
    /** ISO 639-1 code Gemini detected for the original (e.g. 'th'). */
    sourceLang: string;
}

// Flash for the same reasons as the scanner and grader: fast, cheap, and the
// output is short structured JSON where Pro's thinking budget buys nothing.
const MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 20_000;

const TARGET_NAMES: Record<TranslateTarget, string> = { en: 'English', th: 'Thai', ja: 'Japanese' };

let _ai: GoogleGenAI | null | undefined;
function getAi(): GoogleGenAI | null {
    if (_ai !== undefined) return _ai;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    _ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
    return _ai;
}

// Warm-instance cache: opening the same ticket twice, or the email alert and
// the console translating the same message, should not pay for Gemini twice.
const CACHE_MAX = 500;
const cache = new Map<string, Translation | null>();
function cacheGet(key: string): Translation | null | undefined {
    if (!cache.has(key)) return undefined;
    const v = cache.get(key)!;
    cache.delete(key);
    cache.set(key, v);
    return v;
}
function cacheSet(key: string, v: Translation | null) {
    cache.set(key, v);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/**
 * Whether a text is worth sending to Gemini for `target`.
 *
 * For English, pure-ASCII text is assumed to be readable already. That skips a
 * model call on every English ticket, at the cost of not translating ASCII-only
 * languages (Malay, Tagalog, Indonesian) — acceptable while every live market
 * writes Thai, and those markets are still dormant in lib/markets.ts.
 */
export function needsTranslation(text: string, target: TranslateTarget): boolean {
    if (!text.trim()) return false;
    if (target === 'en') return /[^\x00-\x7F]/.test(text);
    return true;
}

function buildPrompt(items: { id: string; text: string }[], target: TranslateTarget): string {
    const targetName = TARGET_NAMES[target];
    const register = target === 'en'
        ? 'Plain, natural English.'
        : `Write as the Cardstreet support team: polite, warm and clear. ${target === 'th'
            ? 'Do not use gendered polite particles (ครับ / ค่ะ); use neutral polite phrasing instead.'
            : 'Use polite (desu/masu) Japanese.'}`;
    return `You translate customer-support messages for Cardstreet, a trading-card (mostly Pokémon TCG) marketplace in Thailand. Customers buy and sell cards; parcels ship with Flash Express; payments go through Stripe (cards, PromptPay).

Translate the "text" of every item below into ${targetName}.

Rules:
- Translate faithfully. Do not summarize, answer, add, or drop anything.
- Keep card names, set codes (e.g. SV8a, MA3), card numbers (e.g. 087/198), order IDs, tracking numbers, URLs, email addresses, usernames and prices exactly as written.
- Preserve line breaks.
- ${register}
- sourceLanguage is the ISO 639-1 code of the original text (e.g. "th", "ja", "en"). If an item is already in ${targetName}, return it unchanged.
- Return one result per item, with the same id.

Items (JSON):
${JSON.stringify(items)}`;
}

/**
 * Translate several texts in one model call. Returns a map keyed by the
 * caller's ids; an id maps to null when no translation is needed (already in
 * the target language, or empty) and is absent when translation failed.
 */
export async function translateTexts(
    items: { id: string; text: string }[],
    target: TranslateTarget = 'en',
): Promise<Record<string, Translation | null>> {
    const out: Record<string, Translation | null> = {};
    const pending: { id: string; text: string; key: string }[] = [];

    for (const item of items) {
        const text = (item.text ?? '').trim();
        if (!needsTranslation(text, target)) {
            out[item.id] = null;
            continue;
        }
        const key = `${target}\u0000${text}`;
        const hit = cacheGet(key);
        if (hit !== undefined) {
            out[item.id] = hit;
            continue;
        }
        pending.push({ id: item.id, text, key });
    }
    if (pending.length === 0) return out;

    const ai = getAi();
    if (!ai) {
        console.warn('[supportTranslate] GEMINI_API_KEY is not set; skipping translation');
        return out;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: [{ parts: [{ text: buildPrompt(pending.map(({ id, text }) => ({ id, text })), target) }] }],
            config: {
                abortSignal: ac.signal,
                httpOptions: { timeout: TIMEOUT_MS },
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING },
                            sourceLanguage: { type: Type.STRING },
                            translation: { type: Type.STRING },
                        },
                        required: ['id', 'sourceLanguage', 'translation'],
                    },
                },
            },
        });
        const parsed: unknown = JSON.parse(response.text || '[]');
        if (!Array.isArray(parsed)) return out;

        const byId = new Map(pending.map((p) => [p.id, p]));
        for (const row of parsed as { id?: unknown; sourceLanguage?: unknown; translation?: unknown }[]) {
            const p = typeof row?.id === 'string' ? byId.get(row.id) : undefined;
            if (!p || typeof row.translation !== 'string') continue;
            const sourceLang = typeof row.sourceLanguage === 'string'
                ? row.sourceLanguage.trim().toLowerCase().slice(0, 5)
                : '';
            const translated = row.translation.trim();
            // Already in the target language: nothing to show beside the original.
            const value: Translation | null = !translated || sourceLang === target || translated === p.text
                ? null
                : { text: translated, sourceLang };
            out[p.id] = value;
            cacheSet(p.key, value);
        }
    } catch (e) {
        console.warn('[supportTranslate] translation failed:', e instanceof Error ? e.message : e);
    } finally {
        clearTimeout(timer);
    }
    return out;
}
