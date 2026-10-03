/**
 * Text normalization for catalog search.
 *
 * Two kinds of output, and they must not be mixed up:
 *
 * - KEYS (foldKey, looseKey) are for comparing strings in JS: dictionary
 *   lookup, typo matching and ranking. They are lossy on purpose (no spaces,
 *   no punctuation, hiragana folded to katakana, Thai tone marks dropped) and
 *   are never sent to the database.
 * - DB TERMS (widthFold, sanitizeTerm) are what goes inside a PostgREST
 *   `ilike` pattern. They stay as close to the typed or printed text as
 *   possible, because the catalog stores names as printed.
 *
 * Why NFKC is a key-only step: NFKC decomposes Thai SARA AM (U+0E33) into
 * NIKHAHIT + SARA AA, and the catalog stores the precomposed form, so an
 * NFKC'd query would stop matching ดำ / น้ำ / คำ in ILIKE. Comparing two keys
 * is fine because both sides go through the same fold.
 *
 * Bump FOLD_VERSION whenever foldKey's output changes: the generated alias
 * dictionary stores precomputed keys and is rebuilt at runtime when the
 * versions disagree.
 */

export const FOLD_VERSION = 1;

export type Script = 'latin' | 'thai' | 'kana' | 'han' | 'hangul' | 'mixed' | 'none';

// Encoding damage seen in the catalog's english_name column (UTF-8 read as
// Latin-1 somewhere upstream): "FlabÃ©bÃ©", "Nidoranâ™‚".
const MOJIBAKE: Array<[RegExp, string]> = [
    [/Ã©/g, 'é'],
    [/â™€/g, '♀'],
    [/â™‚/g, '♂'],
];

// Thai MAITAIKHU, the four tone marks, THANTHAKHAT and YAMAKKAN. Users drop or
// swap them freely (คอยคิ่ง / คอยคิง), and pg_trgm treats them as word breaks.
// Folding them away produced zero species collisions across the catalog.
const THAI_DROPPED_MARKS = /[็-์๎]/g;

// Only the Latin combining block. Kana voicing marks (U+3099/309A) and Thai
// vowel signs are also combining marks, but stripping those merges distinct
// names (カラカラ Cubone / ガラガラ Marowak).
const LATIN_COMBINING = /[̀-ͯ]/g;

const NOT_KEY_CHAR = /[^\p{L}\p{N}\p{M}]/gu;

export function hiraganaToKatakana(s: string): string {
    return s.replace(/[ぁ-ゖゝゞ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/**
 * The comparison key: case-, width-, accent-, kana-, spacing- and
 * punctuation-insensitive. "Mr. Mime" / "mr mime" -> "mrmime",
 * "こいきんぐ" / "ｺｲｷﾝｸﾞ" -> "コイキング", "Nidoran♀" -> "nidoranf",
 * "Pikachu δ" -> "pikachudelta", "ลิซาร์ดอน ex" -> "ลิซารดอนex".
 */
export function foldKey(input: string | null | undefined): string {
    if (!input) return '';
    let s = input;
    for (const [re, rep] of MOJIBAKE) s = s.replace(re, rep);
    s = s.replace(/♀/g, 'f').replace(/♂/g, 'm').replace(/[δΔ]/g, 'delta');
    s = s.normalize('NFKC').toLowerCase();
    s = s.normalize('NFD').replace(LATIN_COMBINING, '').normalize('NFC');
    s = hiraganaToKatakana(s);
    s = s.replace(THAI_DROPPED_MARKS, '');
    return s.replace(NOT_KEY_CHAR, '');
}

// Thai letters that sound alike and get swapped when people spell a Pokémon
// name by ear (ปิกาจู for the printed พิคาชู, ลิซาดอน for ลิซาร์ดอน), plus long/
// short vowel pairs and the often-dropped SARA A.
const THAI_LOOSE: Record<string, string> = {
    'ศ': 'ซ', 'ษ': 'ซ', 'ส': 'ซ',
    'ธ': 'ท', 'ฑ': 'ท', 'ฒ': 'ท',
    'ฏ': 'ต', 'ฅ': 'ค', 'ฆ': 'ค', 'ภ': 'พ', 'ฬ': 'ล', 'ณ': 'น', 'ฎ': 'ด', 'ญ': 'ย', 'ฐ': 'ถ',
    'ป': 'พ', 'ก': 'ค', 'จ': 'ช',
    'ี': 'ิ', 'ู': 'ุ', 'ื': 'ึ',
    'ะ': '',
};

/**
 * A deliberately lossier key for the typo tier only. It merges some genuinely
 * different names (Cubone/Marowak in Thai), so callers must treat a loose hit
 * as a candidate, never as proof.
 */
export function looseKey(input: string | null | undefined): string {
    const k = foldKey(input);
    let out = '';
    for (const ch of k) out += THAI_LOOSE[ch] ?? ch;
    return out.replace(/([a-z])\1+/g, '$1');
}

/**
 * Half-width katakana and full-width Latin to their normal forms, touching
 * nothing else. Safe for DB terms: it never reaches Thai text, so SARA AM
 * survives.
 */
export function widthFold(s: string): string {
    return s.replace(/[　！-￯]+/g, (m) => m.normalize('NFKC'));
}

/**
 * Longest query search reads, in code points. No card name comes close; the
 * cap bounds what a pasted paragraph costs, because resolution does work per
 * word and per character (GET /api/listings runs it for anyone, unthrottled).
 */
export const MAX_QUERY_CHARS = 120;

/** The query cut to MAX_QUERY_CHARS code points (never splitting a surrogate pair). */
export function clipQuery(q: string | null | undefined): string {
    const s = typeof q === 'string' ? q : '';
    if (s.length <= MAX_QUERY_CHARS) return s;
    const cps = Array.from(s);
    return cps.length > MAX_QUERY_CHARS ? cps.slice(0, MAX_QUERY_CHARS).join('') : s;
}

// PostgREST or() delimiters (, ( )), LIKE wildcards (% * _), the LIKE escape
// (\) and the quote PostgREST uses for quoted values. None can be escaped
// inside an or() string, so they are replaced with spaces.
const DB_UNSAFE = /[,()%*_\\"]/g;

/**
 * A user- or dictionary-supplied term made safe for an ILIKE leg. Width-folds
 * first, because full-width ，（）％ only become delimiters after folding.
 * Returns '' when nothing searchable is left; callers must then skip the leg,
 * since an empty pattern ("%%") matches every row.
 */
export function sanitizeTerm(term: string | null | undefined): string {
    if (!term) return '';
    return widthFold(term).replace(DB_UNSAFE, ' ').replace(/\s+/g, ' ').trim();
}

const SCRIPT_TESTS: Array<[Exclude<Script, 'mixed' | 'none'>, RegExp]> = [
    ['latin', /[a-z0-9]/],
    ['thai', /[฀-๿]/],
    ['kana', /[぀-ヿㇰ-ㇿ]/],
    ['han', /[㐀-䶿一-鿿]/],
    ['hangul', /[가-힯ᄀ-ᇿ㄰-㆏]/],
];

/** Dominant script of a folded key. Kana wins over han when both occur (Japanese). */
export function scriptOf(key: string): Script {
    if (!key) return 'none';
    const counts: Partial<Record<Script, number>> = {};
    for (const ch of key) {
        for (const [script, re] of SCRIPT_TESTS) {
            if (re.test(ch)) {
                counts[script] = (counts[script] || 0) + 1;
                break;
            }
        }
    }
    if (counts.kana && counts.han) {
        counts.kana += counts.han;
        delete counts.han;
    }
    const entries = Object.entries(counts) as Array<[Script, number]>;
    if (entries.length === 0) return 'none';
    entries.sort((a, b) => b[1] - a[1]);
    if (entries.length > 1 && entries[1][1] / key.length > 0.3) return 'mixed';
    return entries[0][0];
}

/**
 * Split a query into words. Splits on whitespace and on the punctuation
 * that joins words in card names ("Blue-Eyes", "Monkey.D.Luffy", "Type: Null"),
 * but keeps apostrophes inside a word ("Farfetch'd", "Rocket's").
 */
export function tokenize(q: string): string[] {
    return widthFold(q)
        .split(/[\s\-.:/,·・&+()（）]+/)
        .map((t) => t.trim())
        .filter(Boolean);
}
