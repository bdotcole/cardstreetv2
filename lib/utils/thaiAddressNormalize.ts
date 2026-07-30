/**
 * Normalization for Thai administrative-area names, shared by the server-side
 * dataset helpers (lib/thaiAdminAreas.ts) and the client address selects
 * (components/ThaiAddressFields.tsx). Deliberately dependency- and data-free
 * so the client bundle doesn't pull the 484 KB area dataset.
 *
 * Matching is prefix-insensitive: users and older profile rows write the same
 * place as "บางเขน", "เขตบางเขน", or "Khet Bang Khen" interchangeably.
 */

const TH_PREFIX = /^(เขต|อำเภอ|กิ่งอำเภอ|ตำบล|แขวง|จังหวัด|อ\.|ต\.|จ\.)\s*/;
const EN_PREFIX = /^(khet|amphoe|king amphoe|tambon|khwaeng|changwat)\s+/i;
// Zero-width characters (ZWSP/ZWNJ/ZWJ/BOM) mobile keyboards sprinkle into
// Thai text, plus NBSP — a real profile audit found otherwise-valid rows
// failing purely on these.
const INVISIBLES = /[​‌‍﻿]/g;
const NBSP = / /g;

/** Trim, strip administrative prefixes, collapse whitespace. Keeps เมือง — it
 * is part of real district names (เมืองเชียงใหม่). Also folds the common
 * Thai-typing variant of two เ for แ ("เเม่นาเรือ" -> "แม่นาเรือ"). */
export function normalizeThaiAreaName(input: string | null | undefined): string {
    let s = (input || '')
        .replace(INVISIBLES, '')
        .replace(NBSP, ' ')
        .replace(/เเ/g, 'แ') // เเ -> แ
        .trim();
    s = s.replace(TH_PREFIX, '').replace(EN_PREFIX, '');
    return s.replace(/\s+/g, ' ').trim();
}

/** Case-folded key for comparisons (Thai is caseless; English names aren't). */
export function areaMatchKey(input: string | null | undefined): string {
    return normalizeThaiAreaName(input).toLowerCase();
}

/**
 * Prefix-insensitive name equality, tolerating spacing differences in
 * romanized names ("BangKhuWiang" == "Bang Khu Wiang"). Empty never matches.
 */
export function areaNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    const ka = areaMatchKey(a);
    const kb = areaMatchKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    return ka.replace(/ /g, '') === kb.replace(/ /g, '');
}

/** All the Bangkok spellings we see in real profile data. */
export function isBangkokLike(input: string | null | undefined): boolean {
    const s = (input || '').trim().toLowerCase();
    if (!s) return false;
    return s.includes('กรุงเทพ') || s.includes('กทม') || s.includes('bangkok') || s.includes('krung thep');
}

/** The province name Flash's region table and our dataset both use. */
export const BANGKOK_CANONICAL = 'กรุงเทพมหานคร';
