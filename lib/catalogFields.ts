/**
 * Pure field helpers shared by the admin catalog API routes.
 *
 * Kept dependency-free so both Route Handlers and (if needed) client validation
 * can import them.
 */

import { GAMES } from '@/lib/games';

export const VALID_GAME_IDS = new Set(GAMES.map((g) => g.id));

/**
 * Map the UI language code ('en' | 'jp' | 'th') to the DB code. The catalog
 * stores Japanese as 'ja' (see app/api/sets/route.ts); everything else is 1:1.
 */
export function dbLanguage(uiLang: string | null | undefined): string {
    if (uiLang === 'jp' || uiLang === 'ja') return 'ja';
    if (uiLang === 'th') return 'th';
    return 'en';
}

/** Trim a value to a non-empty string, or null. */
export function cleanStr(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length ? s : null;
}

/** Parse to a finite integer, or null. */
export function toIntOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
}

/** Split a comma-separated string into a trimmed TEXT[] (null when empty). */
export function csvToArray(v: unknown): string[] | null {
    const s = cleanStr(v);
    if (!s) return null;
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    return arr.length ? arr : null;
}
