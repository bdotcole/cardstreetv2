/**
 * Builds lib/search/data/pokemonNames.json: every Pokémon species with the
 * names it goes by, so search can tell that Magikarp = コイキング = คอยคิง =
 * Koiking. Shape: SearchDictionaryFile in lib/search/types.ts.
 *
 *   npx tsx scripts/build-search-aliases.ts [--refresh-catalog] [--refresh-sources] [--cache-dir <dir>] [--out <file>]
 *   npx tsx scripts/build-search-aliases.ts --check [--cached-catalog] [--refresh-sources] </dev/null
 *
 * --check is the drift check to run after Thai/Japanese sets are ingested (or
 * english_name is relabelled in bulk): it re-exports the catalog (unless
 * --cached-catalog), rebuilds in memory and compares with the committed file,
 * ignoring "built". Nothing committed is touched; the would-be file goes to
 * <cache>/pokemonNames.next.json and the would-be label-conflict report to
 * <cache>/catalog-label-conflicts.next.json. Exit 0 = up to date, 3 = stale
 * (rebuild with --refresh-catalog and commit), 1 = error.
 *
 * Inputs are cached in scripts/out/search-aliases/ (gitignored) and downloaded
 * only when missing (--refresh-sources re-downloads them, --refresh-catalog
 * re-exports the catalog):
 *
 *   PokeAPI species names, BSD-3-Clause (the names themselves are Nintendo trademarks):
 *     https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv
 *     https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/languages.csv
 *   Official Thai Pokédex; the page embeds every entry as JSON:
 *     https://th.portal-pokemon.com/pokedex/
 *   Historical official Thai spellings (Trivia tables of Bulbapedia's list; the
 *   HTML is behind Cloudflare, the MediaWiki API is not):
 *     https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=List_of_Thai_Pok%C3%A9mon_names&prop=wikitext&format=json
 *   Thai Wikipedia: the species list page (รายชื่อโปเกมอน) and the redirect titles
 *   of a few species articles whose redirects were checked by hand:
 *     https://th.wikipedia.org/w/api.php
 *   The catalog: distinct (language, name, english_name) of Pokémon cards, every
 *   English card name of every game, and set names. Read-only anon PostgREST
 *   GETs (URL + anon key from .env.local), paged 1000 rows at a time because
 *   PostgREST caps responses at 1000.
 *
 * Outputs:
 *   lib/search/data/pokemonNames.json (committed)
 *   scripts/out/search-aliases/catalog-label-conflicts.json: catalog rows whose
 *   english_name looks wrong, for the DB manager to relabel.
 *
 * The build fails (exit 1, nothing written) if any spelling that becomes an
 * ILIKE leg (en, enDb, ja, th) is shorter than 2 characters, contains a
 * PostgREST/LIKE metacharacter or a parenthetical, or if a source looks
 * truncated.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { FOLD_VERSION, foldKey, tokenize, widthFold } from '../lib/search/normalize';
import { MODIFIERS, STOPWORDS } from '../lib/search/modifiers';
import type { SearchDictionaryFile } from '../lib/search/types';

// ---------------------------------------------------------------------------
// Paths and flags

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : null;
};
const CACHE = option('--cache-dir') || path.join(ROOT, 'scripts', 'out', 'search-aliases');
const DEFAULT_OUT = path.join(ROOT, 'lib', 'search', 'data', 'pokemonNames.json');
// --out exists so a from-scratch test build does not overwrite the committed file.
// Under --check it is the file compared against instead.
const OUT_FILE = option('--out') || DEFAULT_OUT;
const CHECK = flag('--check');
// A drift check against a stale export would answer the wrong question, so
// --check re-exports by default; --cached-catalog is for offline runs.
const REFRESH_CATALOG = flag('--refresh-catalog') || (CHECK && !flag('--cached-catalog'));
const REFRESH_SOURCES = flag('--refresh-sources');
const CONFLICTS_FILE = path.join(CACHE, 'catalog-label-conflicts.json');
const NEXT_FILE = path.join(CACHE, 'pokemonNames.next.json');
const CONFLICTS_NEXT_FILE = path.join(CACHE, 'catalog-label-conflicts.next.json');
/** Exit code for "the committed dictionary is stale", distinct from 1 (error) so automation can branch on it. */
const EXIT_STALE = 3;
/** Repo-relative (absolute outside the repo), forward slashes: printed paths get pasted into Git Bash. */
const rel = (p: string) => {
    const r = path.relative(ROOT, p);
    return (r.startsWith('..') || path.isAbsolute(r) ? p : r).split(path.sep).join('/');
};

const POKEAPI_CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const THAI_PORTAL_URL = 'https://th.portal-pokemon.com/pokedex/';
const BULBAPEDIA_URL = 'https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=List_of_Thai_Pok%C3%A9mon_names&prop=wikitext&format=json';
const THWIKI_API = 'https://th.wikipedia.org/w/api.php';
const THWIKI_LIST_PAGE = 'รายชื่อโปเกมอน';
const USER_AGENT = 'CardStreetSearchAliasBuild/1.0 (catalog search dictionary; contact via cardstreet.app)';

// Thai Wikipedia redirects onto these species' articles were read one by one:
// they are alternate spellings of the species. Redirects onto other articles
// were left out because many point at unrelated topics (Persian the cat breed,
// an electrode, a bird genus) or at the species list page.
const THWIKI_VETTED_REDIRECT_DEX = [4, 6, 24, 25, 26, 76, 94, 131, 144, 166, 282, 390, 566];

/**
 * English names written in Thai script, the way Thai players who learned the
 * games in English type them. Resolution-only (never sent to the DB). Every
 * entry is a transliteration of the English name that is not itself a Thai
 * word; kept short on purpose and meant to grow from search telemetry. Left
 * out: เมาท์ for Meowth (Thai slang for "gossip"). Japanese-derived fan
 * spellings (ปิกาจู, ลิซาดอน) come from Thai Wikipedia instead, and most
 * one-letter variants are left to the loose/fuzzy tiers.
 */
const CURATED_THAI_ENGLISH: Array<[number, string[]]> = [
    [1, ['บัลบาซอร์']],
    [4, ['ชาร์มันเดอร์', 'ชาแมนเดอร์']],
    [6, ['ชาริซาร์ด']],
    [7, ['สไควร์เทิล']],
    [25, ['ปิกาจู']],
    [94, ['เกนการ์']],
    [133, ['อีวี่', 'อีวี']],
    [197, ['อัมเบรออน']],
    [282, ['การ์เดวัวร์', 'กาดีวัวร์']],
    [384, ['เรย์ควอซา']],
    [448, ['ลูคาริโอ']],
    [658, ['เกรนินจา']],
    [700, ['ซิลเวียน']],
];

/**
 * Late (romaji / European) names that are everyday English words but happen
 * not to occur in any catalog card name, so the catalog-word filter misses
 * them. Found by reading the short late names; extend when telemetry shows a
 * query wrongly turning into a species.
 */
const LATE_ENGLISH_WORDS = ['Showers', 'Freezer', 'Gallop', 'Dolman'];

/**
 * Catalog English spellings that should map to a species. foldKey already
 * folds all of these onto PokeAPI's key; they are listed so a future change to
 * foldKey cannot silently drop them.
 */
const KNOWN_EN_VARIANTS: Array<[string, number]> = [
    ['Nidoran F', 29],
    ['Nidoran M', 32],
    ['Ho-oh', 250],
    ['Farfetch’d', 83],
];

// ---------------------------------------------------------------------------
// Small utilities

type Lang = 'ja' | 'th';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, value: unknown, pretty = true) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, pretty ? JSON.stringify(value, null, 1) : JSON.stringify(value));
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers } });
            if (res.status === 429 || res.status >= 500) {
                lastErr = new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
            } else {
                return res;
            }
        } catch (err) {
            lastErr = err;
        }
        await sleep(1000 * 2 ** attempt);
    }
    throw lastErr;
}

async function httpText(url: string): Promise<string> {
    const res = await httpGet(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}`);
    return res.text();
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
    return out;
}

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF). */
function parseCsv(text: string): Array<Record<string, string>> {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift() || [];
    return rows
        .filter((r) => r.length === header.length)
        .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/**
 * Undo UTF-8 that was decoded as Windows-1252 somewhere upstream ("FlabÃ©bÃ©",
 * "Nidoranâ™‚"). Only applied when the whole string round-trips, so a genuine
 * "Flabébé" (whose é alone is not valid UTF-8) is left alone.
 */
const CP1252_HIGH = '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178';
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
function fixMojibake(s: string): string {
    if (!/[ÃÂâ]/.test(s)) return s;
    const bytes: number[] = [];
    for (const ch of s) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
        else {
            const i = CP1252_HIGH.indexOf(ch);
            if (i < 0) return s;
            bytes.push(0x80 + i);
        }
    }
    try {
        const fixed = utf8Strict.decode(new Uint8Array(bytes));
        return fixed !== s ? fixed : s;
    } catch {
        return s;
    }
}

/** Optimal string alignment (Damerau with adjacent swaps) distance over code points. */
function osa(a: string, b: string): number {
    const s = [...a];
    const t = [...b];
    if (!s.length) return t.length;
    if (!t.length) return s.length;
    let prev2: number[] = new Array(t.length + 1).fill(0);
    let prev: number[] = Array.from({ length: t.length + 1 }, (_, j) => j);
    let cur: number[] = new Array(t.length + 1).fill(0);
    for (let i = 1; i <= s.length; i++) {
        cur[0] = i;
        for (let j = 1; j <= t.length; j++) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur[j] = v;
        }
        [prev2, prev, cur] = [prev, cur, prev2];
    }
    return prev[t.length];
}

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const BRACKETED = /\s*(?:\([^)]*\)|（[^）]*）|\[[^\]]*\]|［[^］]*］|<[^>]*>|＜[^＞]*＞|\{[^}]*\})\s*/g;
const NUMBER_TAIL = /[\s\-]+#?\d{1,4}\/\d{1,4}$/;
const KANA = /[\u3040-\u30FF\u31F0-\u31FF\uFF66-\uFF9F]/;
const THAI = /[\u0E00-\u0E7F]/;
const LATIN_LETTER = /[A-Za-z]/;

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** What can safely become `name.ilike.%s%` inside a PostgREST or() string. */
function dbSafetyProblem(s: string): string | null {
    if ([...s].length < 2) return 'shorter than 2 characters';
    if (s !== s.trim() || /\s{2,}|[\t\n\r]/.test(s)) return 'stray whitespace';
    if (/[,()%*_\\"]/.test(widthFold(s))) return 'PostgREST/LIKE metacharacter';
    if (/[（）\[\]［］<>＜＞{}]/.test(s)) return 'parenthetical';
    return null;
}

// ---------------------------------------------------------------------------
// Base-name extraction: "Team Rocket's Mewtwo ex" -> "Mewtwo",
// "มิวทูex ของแก๊งร็อกเกต" -> "มิวทู", "アローラ ロコンVSTAR" -> "ロコン"

interface FormWord {
    en: string;
    ja: string[];
    th: string[];
    jaPos: 'prefix' | 'suffix';
    thPos: 'prefix' | 'suffix';
    leading: RegExp;
    trailing: RegExp | null;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Native spellings the catalog uses beyond lib/search/modifiers.ts: vintage
// machine-translated Japanese (暗い, 軽い), katakana renderings, and the Thai
// เมกะ / M prefixes on Mega cards.
const EXTRA_NATIVE: Record<string, { ja?: string[]; th?: string[] }> = {
    mega: { ja: ['M'], th: ['เมกะ', 'M'] },
    radiant: { ja: ['カガヤク'] },
    shining: { ja: ['ヒカル'], th: ['ไชนิง'] },
    dark: { ja: ['ワルイ', 'ダーク'] },
    light: { ja: ['ライト'] },
};

// English form words with no reliable native spelling. They are stripped to
// find the English species (for enDb), but rows carrying them are not used to
// learn native spellings, because the native text around the name is unknown.
const EN_ONLY_FORM_WORDS = [
    'Primal', 'Ultra', 'Dusk Mane', 'Dawn Wings', 'Black', 'White', 'Eternamax', 'Gigantamax',
    'Special Delivery', 'Flying', 'Surfing', 'Detective', 'Teal Mask', 'Wellspring Mask',
    'Hearthflame Mask', 'Cornerstone Mask',
];

function buildFormWords(): FormWord[] {
    const words: FormWord[] = [];
    const add = (en: string, ja: string[], th: string[], jaPos: 'prefix' | 'suffix', thPos: 'prefix' | 'suffix') => {
        const isM = en === 'M';
        words.push({
            en, ja, th, jaPos, thPos,
            // "M Charizard-EX": M must be upper-case and followed by a capital.
            leading: isM ? /^M\s+(?=[A-Z])/ : new RegExp(`^${escapeRe(en)}\\s+`, 'i'),
            // "Ursaluna Bloodmoon", "Calyrex Shadow Rider"
            trailing: isM ? null : new RegExp(`\\s+${escapeRe(en)}$`, 'i'),
        });
    };
    for (const m of MODIFIERS) {
        if (m.kind !== 'prefix') continue;
        const extra = EXTRA_NATIVE[m.id] || {};
        const ja = [...m.ja, ...(extra.ja || [])];
        const th = [...m.th, ...(extra.th || [])];
        for (const en of [...m.en, ...(m.id === 'mega' ? ['M'] : [])]) {
            add(en, ja, th, m.jaPosition || 'prefix', m.thPosition || 'prefix');
        }
    }
    for (const en of EN_ONLY_FORM_WORDS) add(en, [], [], 'prefix', 'prefix');
    // Longest first so "Origin Forme" wins over any shorter overlap.
    return words.sort((a, b) => b.en.length - a.en.length);
}

const FORM_WORDS = buildFormWords();

// Attached, spaced or hyphenated mechanic suffixes. The English form needs a
// separator so Toxapex / Calyrex / Smoliv / Dolliv keep their last letters;
// the native forms are always preceded by Thai/kana, so they may be attached.
const EN_MECHANIC_SUFFIX = /(?:[\s\-]+(?:ex|EX|Ex|GX|V|VMAX|VSTAR|V-UNION|V UNION|BREAK|LV\.\s?X|Lv\.\s?X|LEGEND|Prism Star|Star|TAG TEAM|C|G|GL|FB|E4|4)|\s*[δΔ☆◇♢★])+\s*$/;
const NATIVE_MECHANIC_SUFFIX = /(?:[\s\-]*(?:ex|EX|Ex|GX|VMAX|VSTAR|V-UNION|V|BREAK|LV\.\s?X|LEGEND|GL|FB|E4|C|G|4|δ|Δ|☆|◇|♢|★))+\s*$/;
const EN_OWNER = /^(?:[A-Z][\w.\-é?!]*(?:\s+[A-Z][\w.\-é?!]*)?)['’]s\s+/;

interface EnInfo {
    base: string;
    owner: boolean;
    forms: FormWord[];
}

function enBase(raw: string): EnInfo | null {
    let t = fixMojibake(raw).replace(ZERO_WIDTH, '').normalize('NFC');
    t = t.replace(BRACKETED, ' ');
    if (/[&＆]/.test(t)) return null; // tag teams name two species
    t = collapse(t).replace(NUMBER_TAIL, '');
    let owner = false;
    const m = t.match(EN_OWNER);
    if (m) {
        owner = true;
        t = t.slice(m[0].length);
    }
    const forms: FormWord[] = [];
    for (let pass = 0; pass < 4; pass++) {
        const before = t;
        t = t.replace(EN_MECHANIC_SUFFIX, '').trim();
        for (const fw of FORM_WORDS) {
            if (fw.leading.test(t)) {
                t = t.replace(fw.leading, '');
                forms.push(fw);
            } else if (fw.trailing && fw.trailing.test(t)) {
                t = t.replace(fw.trailing, '');
                forms.push(fw);
            }
        }
        t = t.trim();
        if (t === before) break;
    }
    t = collapse(t);
    return t ? { base: t, owner, forms } : null;
}

const OFFICIAL_SPECIES_TEXT: Record<Lang, string[]> = { ja: [], th: [] };

/**
 * Native spellings that only ever mean a modifier (never part of a species
 * name). A base that still contains one was not fully stripped.
 */
function pureModifierSpellings(lang: Lang): string[] {
    const all = new Set<string>();
    for (const fw of FORM_WORDS) for (const s of lang === 'ja' ? fw.ja : fw.th) all.add(s);
    for (const m of MODIFIERS) for (const s of lang === 'ja' ? m.ja : m.th) all.add(s);
    all.add(lang === 'ja' ? 'の' : 'ของ');
    return [...all].filter((s) => s.length >= 2 || s === 'の')
        .filter((s) => !/^[A-Za-z]+$/.test(s))
        .filter((s) => !OFFICIAL_SPECIES_TEXT[lang].some((name) => name.includes(s)));
}

let PURE_MODS: Record<Lang, string[]> = { ja: [], th: [] };

function nativeBase(raw: string, lang: Lang, en: EnInfo): string | null {
    let t = raw.replace(ZERO_WIDTH, '').normalize('NFC');
    t = t.replace(BRACKETED, ' ');
    if (/[&＆]/.test(t)) return null;
    t = collapse(t).replace(NUMBER_TAIL, '');
    if (en.owner) {
        if (lang === 'th') {
            // Thai prints the owner after the name: "คอยคิง ของคาซุมิ", "มิวทูex ของแก๊งร็อกเกต".
            t = t.replace(/\s*ของ.*$/, '');
            for (const s of MODIFIERS.find((m) => m.id === 'rocket')!.th) {
                if (t.endsWith(s)) t = t.slice(0, -s.length);
            }
        } else {
            // Japanese prints it before: "カスミのコイキング", "ロケット団のミュウツー".
            t = t.replace(/^.+?\u306E(?=[\u3040-\u30FF])/, '');
        }
        t = t.trim();
    }
    const pending = new Set(en.forms);
    for (const fw of en.forms) {
        // A form word with no known native spelling: the native text around the
        // name is unknown, so this row cannot teach a native spelling.
        if ((lang === 'ja' ? fw.ja : fw.th).length === 0) return null;
    }
    for (let pass = 0; pass < 3; pass++) {
        t = t.replace(NATIVE_MECHANIC_SUFFIX, '').trim();
        for (const fw of [...pending]) {
            const spellings = [...(lang === 'ja' ? fw.ja : fw.th)].sort((a, b) => b.length - a.length);
            const pos = lang === 'ja' ? fw.jaPos : fw.thPos;
            for (const s of spellings) {
                if (pos === 'prefix' && t.startsWith(s)) {
                    t = t.slice(s.length).trim();
                    pending.delete(fw);
                    break;
                }
                if (pos === 'suffix' && t.endsWith(s)) {
                    t = t.slice(0, t.length - s.length).trim();
                    pending.delete(fw);
                    break;
                }
            }
        }
    }
    t = collapse(t);
    if (!t) return null;
    if (lang === 'th' && (!THAI.test(t) || LATIN_LETTER.test(t))) return null;
    if (lang === 'ja' && (!KANA.test(t) || LATIN_LETTER.test(t))) return null;
    if (PURE_MODS[lang].some((s) => t.includes(s))) return null;
    if (dbSafetyProblem(t)) return null;
    return t;
}

// ---------------------------------------------------------------------------
// Sources

interface PortalEntry { dex: number; sub: number; name: string; subName: string }
interface BulbaVariant { dex: number; en: string; old: string; neu: string }
interface ThwikiRedirects { [dex: string]: { article: string; redirects: string[] } }

async function cached(file: string, refresh: boolean, download: () => Promise<string | object>): Promise<string> {
    const full = path.join(CACHE, file);
    if (!refresh && fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
    console.log(`  downloading ${file} ...`);
    const value = await download();
    fs.mkdirSync(CACHE, { recursive: true });
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    fs.writeFileSync(full, text);
    return text;
}

function parsePortal(html: string): PortalEntry[] {
    // Next.js flight data: the JSON sits inside a JS string, quotes escaped.
    const text = html.replace(/\\"/g, '"');
    const re = /\{"zukan_id":"?(\d+)"?,"zukan_sub_id":(\d+),"pokemon_name":"((?:[^"\\]|\\.)*)","pokemon_sub_name":"((?:[^"\\]|\\.)*)"/g;
    const seen = new Set<string>();
    const out: PortalEntry[] = [];
    const unescape = (s: string) => (s.includes('\\') ? JSON.parse(`"${s}"`) : s);
    for (let m = re.exec(text); m; m = re.exec(text)) {
        const key = `${+m[1]}:${+m[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ dex: +m[1], sub: +m[2], name: unescape(m[3]), subName: unescape(m[4]) });
    }
    return out;
}

function cleanWikiText(s: string): string {
    return s
        .replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/g, '')
        .replace(/\{\{efn[\s\S]*$/, '')
        .replace(/\{\{[^}]*\}\}/g, '')
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/'''?/g, '')
        .replace(/[~♭♯※§}†‡*#¹²³]/g, '')
        .trim();
}

function parseBulbapediaVariants(apiJson: string): BulbaVariant[] {
    const wikitext: string = JSON.parse(apiJson).parse.wikitext['*'];
    const at = wikitext.indexOf('==Trivia==');
    if (at < 0) throw new Error('Bulbapedia: no Trivia section');
    const trivia = wikitext.slice(at);
    // | style=... | #0043 || {{p|Oddish}} || old || RTGS || new || RTGS
    const re = /#(\d{3,4})\s*\|\|\s*\{\{p\|([^}|]+)(?:\|[^}]*)?\}\}\s*\|\|\s*([^|\n]+?)\s*\|\|\s*[^|\n]*?\|\|\s*([^|\n]+?)\s*\|\|/g;
    const out: BulbaVariant[] = [];
    for (let m = re.exec(trivia); m; m = re.exec(trivia)) {
        out.push({ dex: +m[1], en: m[2].trim(), old: cleanWikiText(m[3]), neu: cleanWikiText(m[4]) });
    }
    return out;
}

function parseThwikiList(apiJson: string): Record<string, string> {
    const wikitext: string = JSON.parse(apiJson).parse.wikitext['*'];
    const re = /\|\s*style="[^"\n]*border-left:2px solid grey"\s*\|\s*(\d{4})\s*\n\|\s*(?:style="[^"\n]*"\s*\|\s*)?([^\n]+)/g;
    const out: Record<string, string> = {};
    for (let m = re.exec(wikitext); m; m = re.exec(wikitext)) {
        const dex = String(+m[1]);
        if (!(dex in out)) out[dex] = m[2].trim();
    }
    return out;
}

async function downloadThwikiRedirects(officialTh: Map<number, string>): Promise<ThwikiRedirects> {
    const titleToDex = new Map<string, number>();
    for (const dex of THWIKI_VETTED_REDIRECT_DEX) titleToDex.set(officialTh.get(dex)!, dex);
    const out: ThwikiRedirects = {};
    let cont: Record<string, string> = {};
    for (;;) {
        const params = new URLSearchParams({
            action: 'query', format: 'json', redirects: '1', prop: 'redirects', rdlimit: 'max', rdnamespace: '0',
            titles: [...titleToDex.keys()].join('|'), ...cont,
        });
        const j = JSON.parse(await httpText(`${THWIKI_API}?${params}`));
        const back = new Map<string, string>();
        for (const n of j.query?.normalized || []) back.set(n.to, n.from);
        for (const r of j.query?.redirects || []) back.set(r.to, back.get(r.from) || r.from);
        for (const pg of Object.values<any>(j.query?.pages || {})) {
            if (pg.missing !== undefined) continue;
            const requested = titleToDex.has(pg.title) ? pg.title : back.get(pg.title);
            const dex = requested ? titleToDex.get(requested) : undefined;
            if (!dex) continue;
            const entry = (out[dex] ??= { article: pg.title, redirects: [] });
            for (const rd of pg.redirects || []) if (!entry.redirects.includes(rd.title)) entry.redirects.push(rd.title);
            // A requested title that was itself a redirect is a spelling too.
            if (requested !== pg.title && !entry.redirects.includes(requested)) entry.redirects.push(requested);
        }
        if (!j.continue) break;
        cont = j.continue;
        await sleep(1000);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Catalog export (read-only)

interface CatalogExport {
    fetchedAt: string;
    /** [language, name, english_name, rows] for game = pokemon */
    pokemon: Array<[string, string, string | null, number]>;
    /** [name, rows] for language = en, every game */
    enNames: Array<[string, number]>;
    setNames: string[];
}

function loadEnv(): { url: string; key: string } {
    // The worktree has no .env.local of its own; walk up to the main checkout.
    let dir = ROOT;
    for (let i = 0; i < 5; i++) {
        const file = path.join(dir, '.env.local');
        if (fs.existsSync(file)) {
            for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
                const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
                if (!m || process.env[m[1]]) continue;
                // Values are often wrapped in quotes; Next strips them, this parser must too.
                process.env[m[1]] = m[2].replace(/^(['"])([\s\S]*)\1$/, '$2');
            }
            break;
        }
        dir = path.dirname(dir);
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not found (.env.local)');
    return { url: url.replace(/\/+$/, ''), key };
}

const PAGE = 1000;

async function restGetAll(env: { url: string; key: string }, query: string, label: string): Promise<any[]> {
    const headers = { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Range-Unit': 'items' };
    const page = async (from: number, count: boolean) => {
        const res = await httpGet(`${env.url}/rest/v1/${query}`, {
            ...headers,
            Range: `${from}-${from + PAGE - 1}`,
            ...(count ? { Prefer: 'count=exact' } : {}),
        });
        if (res.status !== 200 && res.status !== 206) {
            throw new Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
        return { rows: (await res.json()) as any[], range: res.headers.get('content-range') || '' };
    };
    const first = await page(0, true);
    const total = Number(first.range.split('/')[1]);
    if (!Number.isFinite(total)) throw new Error(`${label}: no total in Content-Range "${first.range}"`);
    const offsets: number[] = [];
    for (let from = PAGE; from < total; from += PAGE) offsets.push(from);
    const rest = await pool(offsets, 6, async (from) => (await page(from, false)).rows);
    const rows = first.rows.concat(...rest);
    console.log(`  ${label}: ${rows.length} rows (Content-Range total ${total})`);
    if (rows.length < total * 0.99) throw new Error(`${label}: got ${rows.length} of ${total} rows`);
    return rows;
}

async function exportCatalog(): Promise<CatalogExport> {
    const env = loadEnv();
    const pk = await restGetAll(env, 'pokemon_cards?select=language,name,english_name&game=eq.pokemon&order=id.asc', 'pokemon cards');
    const en = await restGetAll(env, 'pokemon_cards?select=name&language=eq.en&order=id.asc', 'English cards (all games)');
    const sets = await restGetAll(env, 'pokemon_sets?select=name&order=id.asc', 'sets');
    const pkCounts = new Map<string, [string, string, string | null, number]>();
    for (const r of pk) {
        if (!r.name) continue;
        const k = `${r.language}\u0000${r.name}\u0000${r.english_name ?? ''}`;
        const e = pkCounts.get(k);
        if (e) e[3]++;
        else pkCounts.set(k, [r.language, r.name, r.english_name ?? null, 1]);
    }
    const enCounts = new Map<string, number>();
    for (const r of en) if (r.name) enCounts.set(r.name, (enCounts.get(r.name) || 0) + 1);
    return {
        fetchedAt: new Date().toISOString(),
        pokemon: [...pkCounts.values()],
        enNames: [...enCounts.entries()],
        setNames: [...new Set(sets.map((s) => s.name).filter(Boolean) as string[])],
    };
}

// ---------------------------------------------------------------------------
// Build

interface Spelling { s: string; n: number; official: boolean }

interface Draft {
    dex: number;
    en: string;
    enDb: string[];
    ja: Spelling[];
    th: Spelling[];
    aliases: Array<{ s: string; src: string }>;
    late: Array<{ s: string; src: string }>;
}

interface LabelConflict {
    language: Lang;
    spelling: string;
    rows: number;
    reason: 'is the official name of' | 'contains the official name of';
    labelledAs: { dex: number; en: string };
    officialNameOf: { dex: number; en: string };
    englishNames: Record<string, number>;
}

async function main() {
    console.log(`cache: ${path.relative(ROOT, CACHE) || CACHE}`);

    // --- PokeAPI
    const languagesCsv = await cached('languages.csv', REFRESH_SOURCES, () => httpText(`${POKEAPI_CSV}languages.csv`));
    const speciesCsv = await cached('pokemon_species_names.csv', REFRESH_SOURCES, () => httpText(`${POKEAPI_CSV}pokemon_species_names.csv`));
    const langId = new Map(parseCsv(languagesCsv).map((r) => [r.id, r.identifier.toLowerCase()]));
    const names = new Map<number, Record<string, string>>();
    for (const r of parseCsv(speciesCsv)) {
        const lang = langId.get(r.local_language_id);
        if (!lang || !r.name) continue;
        const dex = +r.pokemon_species_id;
        const rec = names.get(dex) || {};
        rec[lang] = r.name.trim();
        names.set(dex, rec);
    }
    const maxDex = Math.max(...names.keys());
    for (let d = 1; d <= maxDex; d++) {
        const n = names.get(d);
        if (!n?.en || !(n['ja-hrkt'] || n.ja)) throw new Error(`PokeAPI: species ${d} has no en/ja name`);
    }
    if (maxDex < 1025) throw new Error(`PokeAPI: only ${maxDex} species`);

    // --- Thai official Pokédex
    const portal = readPortal(await cached('thai_portal_pokedex.json', REFRESH_SOURCES, async () => parsePortal(await httpText(THAI_PORTAL_URL))));
    const officialTh = new Map<number, string>();
    for (const e of portal) if (e.sub === 0 && !officialTh.has(e.dex)) officialTh.set(e.dex, collapse(e.name));
    for (let d = 1; d <= maxDex; d++) if (!officialTh.get(d)) throw new Error(`Thai portal: species ${d} missing`);

    // --- Bulbapedia historical Thai spellings
    const bulba = readJson<BulbaVariant[]>(path.join(CACHE, await ensureFile('thai_bulbapedia_variants.json', async () =>
        parseBulbapediaVariants(await httpText(BULBAPEDIA_URL)))));
    if (bulba.length < 30) throw new Error(`Bulbapedia: only ${bulba.length} historical spellings`);

    // --- Thai Wikipedia
    const thwikiList = readJson<Record<string, string>>(path.join(CACHE, await ensureFile('thai_thwiki_list.json', async () => {
        const params = new URLSearchParams({ action: 'parse', page: THWIKI_LIST_PAGE, prop: 'wikitext', format: 'json' });
        return parseThwikiList(await httpText(`${THWIKI_API}?${params}`));
    })));
    if (Object.keys(thwikiList).length < 1000) throw new Error(`Thai Wikipedia list: only ${Object.keys(thwikiList).length} rows`);
    const thwikiRedirects = readJson<ThwikiRedirects>(path.join(CACHE, await ensureFile('thai_thwiki_redirects.json', () =>
        downloadThwikiRedirects(officialTh))));

    // --- Catalog
    const catalogFile = path.join(CACHE, 'catalog-names.json');
    let catalog: CatalogExport;
    if (REFRESH_CATALOG || !fs.existsSync(catalogFile)) {
        console.log('  exporting catalog names (read-only PostgREST) ...');
        catalog = await exportCatalog();
        writeJson(catalogFile, catalog, false);
    } else {
        catalog = readJson<CatalogExport>(catalogFile);
    }
    console.log(`catalog export ${catalog.fetchedAt}: ${catalog.pokemon.length} distinct Pokémon (language, name, english_name), ${catalog.enNames.length} distinct English card names, ${catalog.setNames.length} sets`);

    // --- Official names and key owners
    const species = [...Array(maxDex)].map((_, i) => i + 1);
    const enOf = (d: number) => names.get(d)!.en.replace(/’/g, "'");
    const jaOf = (d: number) => names.get(d)!['ja-hrkt'] || names.get(d)!.ja;
    const enKeyToDex = new Map<string, number>();
    for (const d of species) enKeyToDex.set(foldKey(enOf(d)), d);
    for (const [variant, d] of KNOWN_EN_VARIANTS) enKeyToDex.set(foldKey(variant), d);

    OFFICIAL_SPECIES_TEXT.ja = species.map(jaOf);
    OFFICIAL_SPECIES_TEXT.th = species.map((d) => officialTh.get(d)!);
    PURE_MODS = { ja: pureModifierSpellings('ja'), th: pureModifierSpellings('th') };

    // Which species officially owns a native fold key (current and historical
    // official spellings). Catalog labels lose to these.
    const officialOwner: Record<Lang, Map<string, number>> = { ja: new Map(), th: new Map() };
    for (const d of species) {
        officialOwner.ja.set(foldKey(jaOf(d)), d);
        officialOwner.th.set(foldKey(officialTh.get(d)), d);
    }
    for (const v of bulba) for (const s of [v.old, v.neu]) {
        const k = foldKey(s);
        if (k && !officialOwner.th.has(k)) officialOwner.th.set(k, v.dex);
    }

    // --- Catalog English spellings (enDb) and native votes (ja/th)
    const enSpellings = new Map<number, Map<string, number>>();
    const mojibake = new Map<string, { fixed: string; rows: number }>();
    const noteEn = (raw: string, n: number): EnInfo | null => {
        const fixed = fixMojibake(raw);
        if (fixed !== raw) {
            const e = mojibake.get(raw) || { fixed, rows: 0 };
            e.rows += n;
            mojibake.set(raw, e);
        }
        const info = enBase(raw);
        if (!info) return null;
        const dex = enKeyToDex.get(foldKey(info.base));
        if (!dex) return null;
        const m = enSpellings.get(dex) || new Map<string, number>();
        m.set(info.base, (m.get(info.base) || 0) + n);
        enSpellings.set(dex, m);
        return info;
    };

    type Vote = { n: number; englishNames: Map<string, number> };
    const votes: Record<Lang, Map<string, Map<number, Vote>>> = { ja: new Map(), th: new Map() };
    let pokemonEnRows = 0;
    const nativeStats = { rows: 0, mapped: 0, base: 0 };
    for (const [language, name, englishName, n] of catalog.pokemon) {
        if (language === 'en') {
            pokemonEnRows += n;
            noteEn(name, n);
            continue;
        }
        if (language !== 'ja' && language !== 'th') continue;
        nativeStats.rows += n;
        if (!englishName) continue;
        const info = noteEn(englishName, n);
        if (!info) continue;
        const dex = enKeyToDex.get(foldKey(info.base))!;
        nativeStats.mapped += n;
        const base = nativeBase(name, language, info);
        if (!base) continue;
        nativeStats.base += n;
        const byDex = votes[language].get(base) || new Map<number, Vote>();
        const v = byDex.get(dex) || { n: 0, englishNames: new Map() };
        v.n += n;
        v.englishNames.set(englishName, (v.englishNames.get(englishName) || 0) + n);
        byDex.set(dex, v);
        votes[language].set(base, byDex);
    }
    console.log(`catalog Pokémon rows: en ${pokemonEnRows}; ja+th ${nativeStats.rows}, ${nativeStats.mapped} with an English species label, ${nativeStats.base} gave a clean native base`);

    // Majority vote: a native base belongs to a species when >= 80% of its rows
    // (and at least 2) agree. The losers are catalog label errors.
    const attested: Record<Lang, Map<number, Spelling[]>> = { ja: new Map(), th: new Map() };
    const conflicts: LabelConflict[] = [];
    const minority: any[] = [];
    const rejected: Array<{ language: Lang; spelling: string; species: string; rows: number; reason: string }> = [];
    let unvoted = 0;
    const topNames = (m: Map<string, number>) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5));
    const officialKeys: Record<Lang, Array<[string, number]>> = {
        ja: species.map((d) => [foldKey(jaOf(d)), d] as [string, number]),
        th: species.map((d) => [foldKey(officialTh.get(d)), d] as [string, number]),
    };
    const historicalTh = new Map<string, number>();
    for (const v of bulba) for (const s of [v.old, v.neu]) historicalTh.set(foldKey(s), v.dex);

    /**
     * Why a catalog spelling (not an official one) cannot stand for `dex`, or
     * null when it can. The Japanese catalog's vintage sets carry machine
     * translations of the English names (ペルシャ語 "Persian language" for
     * Persian, ゴールデン for Goldeen, 恐れて for Fearow); those are far from the
     * official name, while genuine variants (ミュー/ミュウ, ニドギング/ニドキング)
     * are one edit away. Thai has no machine translations, only typos and older
     * official spellings (เร็คควอวา, แบ็กฟูน), so its gate is looser.
     */
    const catalogSpellingProblem = (lang: Lang, s: string, dex: number): string | null => {
        const k = foldKey(s);
        const len = [...k].length;
        if (len < 3) return 'shorter than 3 characters';
        const ownKey = lang === 'ja' ? foldKey(jaOf(dex)) : foldKey(officialTh.get(dex));
        for (const [other, d] of officialKeys[lang]) {
            if (d === dex) continue;
            // A fragment of another species' name floods that species' rows (ライドン ⊂ ミライドン).
            if (other.includes(k)) return `part of the official name of ${enOf(d)}`;
        }
        if (lang === 'th' && historicalTh.get(k) === dex) return null;
        const ownLen = [...ownKey].length;
        const maxDist = lang === 'ja' ? (ownLen <= 5 ? 1 : 2) : Math.max(2, Math.ceil(ownLen / 2));
        const dist = osa(k, ownKey);
        if (dist > maxDist) return `${dist} edits from the official name`;
        return null;
    };

    for (const lang of ['ja', 'th'] as Lang[]) {
        for (const [base, byDex] of votes[lang]) {
            const ranked = [...byDex.entries()].sort((a, b) => b[1].n - a[1].n);
            const total = ranked.reduce((s, [, v]) => s + v.n, 0);
            const [winDex, win] = ranked[0];

            // OFFICIAL WINS: a spelling that is a species' official name belongs to
            // that species, so every row labelled otherwise is mislabelled
            // (ฮิเมงกะ is Gossifleur, not Hoppip). The owner already has it.
            const owner = officialOwner[lang].get(foldKey(base));
            if (owner) {
                for (const [d, v] of ranked) {
                    if (d === owner) continue;
                    conflicts.push({
                        language: lang, spelling: base, rows: v.n, reason: 'is the official name of',
                        labelledAs: { dex: d, en: enOf(d) },
                        officialNameOf: { dex: owner, en: enOf(owner) },
                        englishNames: topNames(v.englishNames),
                    });
                }
                // A printed variant of the official name ("โพรีกอน 2" for โพรีกอน2, an
                // older official spelling) is its own ILIKE leg.
                const own = byDex.get(owner);
                const printed = lang === 'ja' ? jaOf(owner) : officialTh.get(owner);
                if (own && own.n >= 2 && base !== printed && !catalogSpellingProblem(lang, base, owner)) {
                    const list = attested[lang].get(owner) || [];
                    list.push({ s: base, n: own.n, official: false });
                    attested[lang].set(owner, list);
                }
                continue;
            }
            if (ranked.length > 1) {
                minority.push({
                    language: lang, spelling: base,
                    majority: { dex: winDex, en: enOf(winDex), rows: win.n },
                    minority: ranked.slice(1).map(([d, v]) => ({ dex: d, en: enOf(d), rows: v.n, englishNames: topNames(v.englishNames) })),
                });
            }
            if (win.n < 2 || win.n / total < 0.8) {
                unvoted++;
                continue;
            }
            // A label whose native text names a different species
            // ("โอการ์ปอง หน้ากากสีทีล" labelled Sinistcha): unless the other name
            // is part of this species' own name (リザード inside リザードン).
            const ownKey = lang === 'ja' ? foldKey(jaOf(winDex)) : foldKey(officialTh.get(winDex));
            const named = officialKeys[lang].find(([other, d]) =>
                d !== winDex && [...other].length >= 3 && foldKey(base).includes(other) && !ownKey.includes(other));
            if (named) {
                conflicts.push({
                    language: lang, spelling: base, rows: win.n, reason: 'contains the official name of',
                    labelledAs: { dex: winDex, en: enOf(winDex) },
                    officialNameOf: { dex: named[1], en: enOf(named[1]) },
                    englishNames: topNames(win.englishNames),
                });
                continue;
            }
            const problem = catalogSpellingProblem(lang, base, winDex);
            if (problem) {
                rejected.push({ language: lang, spelling: base, species: enOf(winDex), rows: win.n, reason: problem });
                continue;
            }
            const list = attested[lang].get(winDex) || [];
            list.push({ s: base, n: win.n, official: false });
            attested[lang].set(winDex, list);
        }
    }
    // The official spelling's own row count, so "most frequent first" can rank it.
    const officialRows: Record<Lang, Map<string, number>> = { ja: new Map(), th: new Map() };
    for (const lang of ['ja', 'th'] as Lang[]) {
        for (const [base, byDex] of votes[lang]) {
            const owner = officialOwner[lang].get(foldKey(base));
            const v = owner ? byDex.get(owner) : undefined;
            if (v) officialRows[lang].set(base, v.n);
        }
    }

    // --- Drafts
    const thHistorical = new Map<number, string[]>();
    for (const v of bulba) {
        const list = thHistorical.get(v.dex) || [];
        list.push(v.old, v.neu);
        thHistorical.set(v.dex, list);
    }
    const thWiki = new Map<number, string[]>();
    const pushWiki = (d: number, s: string) => {
        const clean = collapse(cleanWikiText(s).replace(/\s*\([^)]*\)\s*$/, ''));
        if (!THAI.test(clean)) return;
        const list = thWiki.get(d) || [];
        list.push(clean);
        thWiki.set(d, list);
    };
    for (const [d, s] of Object.entries(thwikiList)) pushWiki(+d, s);
    for (const d of THWIKI_VETTED_REDIRECT_DEX) {
        const e = thwikiRedirects[d];
        if (!e) continue;
        pushWiki(d, e.article);
        for (const r of e.redirects) pushWiki(d, r);
    }
    const curated = new Map(CURATED_THAI_ENGLISH);

    const pickTop = (list: Spelling[]) => {
        // Most frequent first; the official spelling always stays in.
        const merged = new Map<string, Spelling>();
        for (const sp of list) {
            const e = merged.get(sp.s);
            if (e) { e.n = Math.max(e.n, sp.n); e.official = e.official || sp.official; } else merged.set(sp.s, { ...sp });
        }
        const sorted = [...merged.values()].sort((a, b) => b.n - a.n || Number(b.official) - Number(a.official));
        const top = sorted.slice(0, 3);
        const official = sorted.find((x) => x.official);
        if (official && !top.includes(official)) top[top.length - 1] = official;
        return { top, rest: sorted.filter((x) => !top.includes(x)) };
    };

    let droppedEnDb = 0;
    const drafts: Draft[] = species.map((d) => {
        const en = enOf(d);
        // enDb: catalog English spellings of this species, case-insensitively merged
        // (ILIKE ignores case), most frequent first, max 3, en kept when it occurs.
        const byLower = new Map<string, { s: string; n: number; best: number }>();
        for (const [s, n] of enSpellings.get(d) || []) {
            if (dbSafetyProblem(s)) { droppedEnDb++; continue; }
            const k = s.toLowerCase();
            const e = byLower.get(k);
            if (!e) byLower.set(k, { s, n, best: n });
            else {
                e.n += n;
                if (n > e.best) { e.s = s; e.best = n; }
            }
        }
        // A spelling that contains another one ("Unown !" contains "Unown") adds
        // no rows as an ILIKE leg, and its fold key is the same.
        const lowers = [...byLower.keys()];
        const sortedEn = [...byLower.values()]
            .filter((x) => x.s.toLowerCase() === en.toLowerCase()
                || !lowers.some((o) => o !== x.s.toLowerCase() && x.s.toLowerCase().includes(o)))
            .sort((a, b) => b.n - a.n);
        let enDb = sortedEn.slice(0, 3).map((x) => x.s);
        const enCat = sortedEn.find((x) => x.s.toLowerCase() === en.toLowerCase());
        if (enCat && !enDb.includes(enCat.s)) enDb[enDb.length - 1] = enCat.s;
        enDb = [...new Set(enDb)];

        const ja = pickTop([{ s: jaOf(d), n: officialRows.ja.get(jaOf(d)) || 0, official: true }, ...(attested.ja.get(d) || [])]);
        const th = pickTop([{ s: officialTh.get(d)!, n: officialRows.th.get(officialTh.get(d)!) || 0, official: true }, ...(attested.th.get(d) || [])]);

        const n = names.get(d)!;
        const aliases: Array<{ s: string; src: string }> = [];
        const add = (s: string | undefined, src: string) => { if (s && s.trim()) aliases.push({ s: collapse(s), src }); };
        add(n.ko, 'ko');
        add(n['zh-hans'], 'zh-Hans');
        add(n['zh-hant'], 'zh-Hant');
        for (const s of thHistorical.get(d) || []) add(s, 'th-historical');
        for (const s of thWiki.get(d) || []) add(s, 'th-wikipedia');
        for (const s of curated.get(d) || []) add(s, 'th-curated');
        for (const x of ja.rest) add(x.s, 'ja-catalog');
        for (const x of th.rest) add(x.s, 'th-catalog');

        const late: Array<{ s: string; src: string }> = [];
        for (const [lang, src] of [['ja-roma', 'romaji'], ['fr', 'fr'], ['de', 'de'], ['es', 'es'], ['it', 'it']] as const) {
            if (n[lang]) late.push({ s: n[lang].replace(/’/g, "'"), src });
        }
        return { dex: d, en, enDb, ja: ja.top, th: th.top, aliases, late };
    });

    // Aliases that add nothing over the group's own DB spellings are dropped.
    const groupKeys = (g: Draft) => new Set([g.en, ...g.enDb, ...g.ja.map((x) => x.s), ...g.th.map((x) => x.s)].map(foldKey));
    const aliasStats: Record<string, number> = {};
    for (const g of drafts) {
        const seen = groupKeys(g);
        g.aliases = g.aliases.filter((a) => {
            const k = foldKey(a.s);
            if (k.length < 2 || seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    // --- Exact-index collisions across species. An official owner (the English
    // name, PokeAPI Japanese, official Thai) keeps the key; otherwise nobody does.
    type Claim = { g: Draft; field: 'en' | 'ja' | 'th' | 'alias'; official: boolean; s: string };
    const exactClaims = new Map<string, Claim[]>();
    const claim = (k: string, c: Claim) => {
        if (!k) return;
        const list = exactClaims.get(k) || [];
        list.push(c);
        exactClaims.set(k, list);
    };
    for (const g of drafts) {
        for (const s of [g.en, ...g.enDb]) claim(foldKey(s), { g, field: 'en', official: true, s });
        for (const x of g.ja) claim(foldKey(x.s), { g, field: 'ja', official: x.official, s: x.s });
        for (const x of g.th) claim(foldKey(x.s), { g, field: 'th', official: x.official, s: x.s });
        for (const a of g.aliases) claim(foldKey(a.s), { g, field: 'alias', official: false, s: a.s });
    }
    const collisions: string[] = [];
    const hardCollisions: string[] = [];
    for (const [k, list] of exactClaims) {
        const dexes = new Set(list.map((c) => c.g.dex));
        if (dexes.size < 2) continue;
        const officialDex = new Set(list.filter((c) => c.official).map((c) => c.g.dex));
        const desc = list.map((c) => `${c.g.dex}:${c.g.en}[${c.field}${c.official ? '*' : ''} ${c.s}]`).join(' vs ');
        if (officialDex.size > 1) {
            hardCollisions.push(`${k}: ${desc} (official on both sides, kept)`);
            continue;
        }
        const keep = officialDex.size === 1 ? [...officialDex][0] : null;
        collisions.push(`${k}: ${desc} -> ${keep ? `kept by ${keep}` : 'dropped from all'}`);
        for (const c of list) {
            if (c.g.dex === keep || c.official) continue;
            if (c.field === 'ja') c.g.ja = c.g.ja.filter((x) => x.s !== c.s);
            else if (c.field === 'th') c.g.th = c.g.th.filter((x) => x.s !== c.s);
            else if (c.field === 'alias') c.g.aliases = c.g.aliases.filter((a) => a.s !== c.s);
        }
    }
    const exactIndex = new Map<string, number>();
    for (const g of drafts) for (const k of [...groupKeys(g), ...g.aliases.map((a) => foldKey(a.s))]) exactIndex.set(k, g.dex);

    // --- Late names (romaji, fr, de, es, it). Many are ordinary words ("Fire" is
    // Moltres in romaji, "Booster" Flareon in German), so any that is a word in
    // catalog card names of any game, or a stopword, is dropped.
    const catalogTokens = new Set<string>();
    const addTokens = (s: string) => {
        for (const tok of tokenize(s)) {
            const k = foldKey(tok);
            if (k) catalogTokens.add(k);
            const stem = tok.replace(/['’]s$/i, '');
            if (stem !== tok) catalogTokens.add(foldKey(stem));
        }
    };
    for (const [name] of catalog.enNames) addTokens(fixMojibake(name));
    for (const [, , englishName] of catalog.pokemon) if (englishName) addTokens(fixMojibake(englishName));
    for (const s of catalog.setNames) addTokens(s);
    const stopKeys = new Set([...STOPWORDS, ...LATE_ENGLISH_WORDS].map(foldKey));
    const lateDropped: Record<string, number> = { sameAsGroup: 0, short: 0, catalogWord: 0, stopword: 0, otherSpeciesExact: 0, lateCollision: 0, duplicate: 0 };
    const lateDroppedWords: string[] = [];
    for (const g of drafts) {
        const own = new Set([...groupKeys(g), ...g.aliases.map((a) => foldKey(a.s))]);
        const seen = new Set<string>();
        g.late = g.late.filter((x) => {
            const k = foldKey(x.s);
            if (!k || own.has(k)) { lateDropped.sameAsGroup++; return false; }
            if (seen.has(k)) { lateDropped.duplicate++; return false; }
            if (/^[a-z0-9]+$/.test(k) && k.length < 4) { lateDropped.short++; return false; }
            if (stopKeys.has(k)) { lateDropped.stopword++; return false; }
            if (catalogTokens.has(k)) { lateDropped.catalogWord++; lateDroppedWords.push(`${x.s}(${g.en}/${x.src})`); return false; }
            if (exactIndex.has(k) && exactIndex.get(k) !== g.dex) { lateDropped.otherSpeciesExact++; return false; }
            seen.add(k);
            return true;
        });
    }
    const lateClaims = new Map<string, Draft[]>();
    for (const g of drafts) for (const x of g.late) {
        const k = foldKey(x.s);
        lateClaims.set(k, [...(lateClaims.get(k) || []), g]);
    }
    const lateCollisions: string[] = [];
    for (const [k, gs] of lateClaims) {
        if (gs.length < 2) continue;
        lateCollisions.push(`${k}: ${gs.map((g) => `${g.dex}:${g.en}`).join(' vs ')} -> dropped from all`);
        for (const g of gs) {
            const before = g.late.length;
            g.late = g.late.filter((x) => foldKey(x.s) !== k);
            lateDropped.lateCollision += before - g.late.length;
        }
    }

    // --- Validation: everything that becomes an ILIKE leg must be safe.
    const problems: string[] = [];
    for (const g of drafts) {
        const check = (field: string, s: string) => {
            const p = dbSafetyProblem(s);
            if (p) problems.push(`${g.dex} ${g.en} ${field} "${s}": ${p}`);
            if (!foldKey(s)) problems.push(`${g.dex} ${g.en} ${field} "${s}": empty fold key`);
        };
        check('en', g.en);
        g.enDb.forEach((s) => check('enDb', s));
        g.ja.forEach((x) => check('ja', x.s));
        g.th.forEach((x) => check('th', x.s));
        if (g.ja.length === 0 || g.th.length === 0) problems.push(`${g.dex} ${g.en}: lost its official ja/th name`);
        for (const a of [...g.aliases, ...g.late]) if (!foldKey(a.s)) problems.push(`${g.dex} ${g.en} alias "${a.s}": empty fold key`);
    }
    if (problems.length) {
        console.error(`\nVALIDATION FAILED (${problems.length}); nothing written:`);
        for (const p of problems.slice(0, 50)) console.error(`  ${p}`);
        process.exit(1);
    }

    // --- Serialize
    const file: SearchDictionaryFile = {
        v: 1,
        foldVersion: FOLD_VERSION,
        built: new Date().toISOString().slice(0, 10),
        groups: drafts.map((g) => [g.dex, g.en, g.enDb, g.ja.map((x) => x.s), g.th.map((x) => x.s), g.aliases.map((a) => a.s), g.late.map((x) => x.s)]),
        keys: drafts.map((g) => [
            foldKey(g.en), g.enDb.map(foldKey), g.ja.map((x) => foldKey(x.s)), g.th.map((x) => foldKey(x.s)),
            g.aliases.map((a) => foldKey(a.s)), g.late.map((x) => foldKey(x.s)),
        ]),
    };
    // One group per line: valid JSON that still diffs readably when rebuilt.
    const json = [
        `{"v":${file.v},"foldVersion":${file.foldVersion},"built":${JSON.stringify(file.built)},"groups":[`,
        file.groups.map((g) => JSON.stringify(g)).join(',\n'),
        '],"keys":[',
        file.keys.map((k) => JSON.stringify(k)).join(',\n'),
        ']}\n',
    ].join('\n');
    JSON.parse(json);
    const conflictReport: ConflictReport = {
        generated: new Date().toISOString(),
        catalogExport: catalog.fetchedAt,
        note: 'Catalog rows whose english_name looks wrong. officialNameConflicts: the native name is (or contains) the official name of a different species than its english_name says, so those rows carry the wrong english_name (e.g. ฮิเมงกะ is Gossifleur, labelled Hoppip). minorityLabels: a native name whose rows mostly agree on a species, with a few rows labelled otherwise. mojibakeEnglishNames: english_name stored with broken encoding. rejectedCatalogSpellings: native names kept out of the dictionary, mostly machine-translated vintage Japanese names (ペルシャ語 for Persian). Read-only report; nothing was changed in the DB.',
        officialNameConflicts: conflicts.sort((a, b) => b.rows - a.rows),
        minorityLabels: minority,
        mojibakeEnglishNames: [...mojibake.entries()].map(([value, e]) => ({ value, fixed: e.fixed, rows: e.rows })),
        rejectedCatalogSpellings: rejected,
    };

    if (CHECK) {
        // The last full build's conflict report stays the baseline, so the
        // would-be one goes next to it instead of over it.
        fs.mkdirSync(path.dirname(NEXT_FILE), { recursive: true });
        fs.writeFileSync(NEXT_FILE, json);
        writeJson(CONFLICTS_NEXT_FILE, conflictReport);
        process.exitCode = reportDrift(file, catalog, conflicts);
        return;
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, json);
    writeJson(CONFLICTS_FILE, conflictReport);

    // --- Report
    for (const g of drafts) for (const a of g.aliases) aliasStats[a.src] = (aliasStats[a.src] || 0) + 1;
    const lateStats: Record<string, number> = {};
    for (const g of drafts) for (const x of g.late) lateStats[x.src] = (lateStats[x.src] || 0) + 1;
    const count = (f: (g: Draft) => number) => drafts.reduce((s, g) => s + f(g), 0);
    const gz = zlib.gzipSync(json, { level: 9 }).length;
    const br = zlib.brotliCompressSync(json).length;
    console.log('\n== pokemonNames.json');
    console.log(`groups ${drafts.length} (dex 1-${maxDex}), foldVersion ${FOLD_VERSION}`);
    console.log(`en ${drafts.length}; enDb ${count((g) => g.enDb.length)} spellings (${count((g) => (g.enDb.length > 1 ? 1 : 0))} species with >1, ${count((g) => (g.enDb.length === 0 ? 1 : 0))} with none in the catalog; ${droppedEnDb} unsafe dropped)`);
    console.log(`ja ${count((g) => g.ja.length)} (${count((g) => g.ja.filter((x) => !x.official).length)} catalog-attested beyond PokeAPI); th ${count((g) => g.th.length)} (${count((g) => g.th.filter((x) => !x.official).length)} catalog-attested beyond the official portal)`);
    console.log(`aliases ${count((g) => g.aliases.length)}: ${JSON.stringify(aliasStats)}`);
    console.log(`late ${count((g) => g.late.length)}: ${JSON.stringify(lateStats)}; dropped ${JSON.stringify(lateDropped)}`);
    console.log(`native bases not voted in (split or single-row): ${unvoted}; minority-label bases: ${minority.length}`);
    console.log(`official-name label conflicts: ${conflicts.length} -> ${path.relative(ROOT, path.join(CACHE, 'catalog-label-conflicts.json'))}`);
    for (const c of conflicts) console.log(`  [${c.language}] ${c.spelling} x${c.rows}: labelled ${c.labelledAs.en}; ${c.reason} ${c.officialNameOf.en}`);
    console.log(`catalog spellings rejected (fragment of another name / too far from the official name): ${rejected.length}`);
    for (const r of rejected) console.log(`  [${r.language}] ${r.spelling} (${r.species}, ${r.rows} rows): ${r.reason}`);
    console.log(`exact-index collisions resolved: ${collisions.length}`);
    for (const c of collisions) console.log(`  ${c}`);
    console.log(`exact-index collisions kept (official on both sides): ${hardCollisions.length}`);
    for (const c of hardCollisions) console.log(`  ${c}`);
    console.log(`late-index collisions: ${lateCollisions.length}`);
    for (const c of lateCollisions) console.log(`  ${c}`);
    console.log(`late names dropped as catalog words (${lateDroppedWords.length}): ${lateDroppedWords.slice(0, 60).join(', ')}${lateDroppedWords.length > 60 ? ', ...' : ''}`);
    console.log(`mojibake english_name values: ${mojibake.size}`);
    console.log(`size: ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip, ${(br / 1024).toFixed(1)} KB brotli (target <= 100 KB gzip)${gz > 100 * 1024 ? '  OVER TARGET' : ''}`);
    console.log(`wrote ${path.relative(ROOT, OUT_FILE)}`);
    console.log(OUT_FILE === DEFAULT_OUT
        ? `verify: npx tsx scripts/check-search-logic.ts (offline, must pass); optional live read-only replay: npx tsx scripts/replay-search.ts </dev/null; then commit ${rel(OUT_FILE)}`
        : `verify: npx tsx scripts/check-search-logic.ts ${rel(OUT_FILE)}`);
}

// ---------------------------------------------------------------------------
// --check: compare a fresh in-memory build with the committed file

interface ConflictReport {
    generated: string;
    catalogExport: string;
    note: string;
    officialNameConflicts: LabelConflict[];
    minorityLabels: unknown[];
    mojibakeEnglishNames: Array<{ value: string; fixed: string; rows: number }>;
    rejectedCatalogSpellings: unknown[];
}

const DICT_FIELDS = [[2, 'enDb'], [3, 'ja'], [4, 'th'], [5, 'aliases'], [6, 'late']] as const;
const MAX_LINES = 40;

const quoteIfSpaced = (s: string) => (/\s/.test(s) ? JSON.stringify(s) : s);
const thousands = (n: number) => n.toLocaleString('en-US');

/** "+added -removed", "reordered" (same spellings, new rank order), or null when unchanged. */
function diffSpellings(before: string[], after: string[]): string | null {
    const added = after.filter((s) => !before.includes(s));
    const removed = before.filter((s) => !after.includes(s));
    if (added.length || removed.length) {
        return [...added.map((s) => `+${quoteIfSpaced(s)}`), ...removed.map((s) => `-${quoteIfSpaced(s)}`)].join(' ');
    }
    return before.join('\u0000') === after.join('\u0000') ? null : 'reordered';
}

function printCapped(lines: string[], more: string) {
    for (const l of lines.slice(0, MAX_LINES)) console.log(`  ${l}`);
    if (lines.length > MAX_LINES) console.log(`  ... ${lines.length - MAX_LINES} more ${more}`);
}

function describeConflict(c: LabelConflict): string {
    return `[${c.language}] ${c.spelling} x${c.rows}: labelled ${c.labelledAs.en}; ${c.reason} ${c.officialNameOf.en}`;
}

/** Prints the drift summary and returns the exit code (0 up to date, EXIT_STALE stale). */
function reportDrift(next: SearchDictionaryFile, catalog: CatalogExport, conflicts: LabelConflict[]): number {
    console.log(`\n== --check: ${rel(OUT_FILE)} vs a fresh build (ignoring "built")`);

    const byLang: Record<string, number> = {};
    for (const [language, , , n] of catalog.pokemon) byLang[language] = (byLang[language] || 0) + n;
    const pokemonRows = Object.values(byLang).reduce((s, n) => s + n, 0);
    const enRows = catalog.enNames.reduce((s, [, n]) => s + n, 0);
    const langs = Object.entries(byLang).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${thousands(n)}`).join(', ');
    console.log(`catalog export ${catalog.fetchedAt}${REFRESH_CATALOG ? '' : ' (CACHED: drop --cached-catalog to re-export)'}: `
        + `${thousands(pokemonRows)} Pokémon card rows (${langs}); ${thousands(enRows)} English card rows across all games; ${catalog.setNames.length} sets`);

    // --- Dictionary drift
    const committed: SearchDictionaryFile | null = fs.existsSync(OUT_FILE) ? readJson<SearchDictionaryFile>(OUT_FILE) : null;
    const comparable = (f: SearchDictionaryFile) => JSON.stringify([f.v, f.foldVersion, f.groups, f.keys]);
    const stale = !committed || comparable(committed) !== comparable(next);
    if (!committed) {
        console.log(`dictionary: STALE, ${rel(OUT_FILE)} does not exist`);
    } else if (!stale) {
        console.log(`dictionary: up to date (${next.groups.length} species; committed file built ${committed.built})`);
    } else {
        const before = new Map(committed.groups.map((g) => [g[0], g]));
        const after = new Map(next.groups.map((g) => [g[0], g]));
        const lines: string[] = [];
        const fieldCounts: Record<string, number> = {};
        const dexes = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
        for (const dex of dexes) {
            const o = before.get(dex);
            const n = after.get(dex);
            if (!o || !n) {
                lines.push(`#${dex} ${(n || o)![1]}: ${n ? 'NEW species' : 'species REMOVED'}`);
                fieldCounts[n ? 'added' : 'removed'] = (fieldCounts[n ? 'added' : 'removed'] || 0) + 1;
                continue;
            }
            const parts: string[] = [];
            if (o[1] !== n[1]) {
                parts.push(`en ${o[1]} -> ${n[1]}`);
                fieldCounts.en = (fieldCounts.en || 0) + 1;
            }
            for (const [i, label] of DICT_FIELDS) {
                const d = diffSpellings(o[i], n[i]);
                if (!d) continue;
                parts.push(`${label} ${d}`);
                fieldCounts[label] = (fieldCounts[label] || 0) + 1;
            }
            if (parts.length) lines.push(`#${dex} ${n[1]}: ${parts.join('; ')}`);
        }
        const header = committed.foldVersion !== next.foldVersion || committed.v !== next.v
            ? ` (format v${committed.v}/fold ${committed.foldVersion} -> v${next.v}/fold ${next.foldVersion})`
            : '';
        const counts = Object.entries(fieldCounts).map(([k, v]) => `${k} ${v}`).join(', ');
        console.log(`dictionary: STALE${header}, ${lines.length} species changed${counts ? ` (${counts})` : ''}; committed file built ${committed.built}; +/- = what a rebuild adds/removes`);
        if (!lines.length) console.log('  only the precomputed fold keys differ');
        printCapped(lines, `species: git diff --no-index ${rel(OUT_FILE)} ${rel(NEXT_FILE)}`);
    }
    console.log(`would-be file: ${rel(NEXT_FILE)}`);

    // --- Label conflicts (informational: they do not change the exit code)
    const key = (c: LabelConflict) => [c.language, c.spelling, c.reason, c.labelledAs.dex, c.officialNameOf.dex].join('|');
    if (!fs.existsSync(CONFLICTS_FILE)) {
        console.log(`label conflicts: ${conflicts.length} (no baseline: ${rel(CONFLICTS_FILE)} is written by a full build and is gitignored)`);
    } else {
        const baseline = readJson<ConflictReport>(CONFLICTS_FILE);
        const was = new Set((baseline.officialNameConflicts || []).map(key));
        const now = new Set(conflicts.map(key));
        const added = conflicts.filter((c) => !was.has(key(c)));
        const resolved = (baseline.officialNameConflicts || []).filter((c) => !now.has(key(c)));
        console.log(`label conflicts: ${conflicts.length} now, ${was.size} in ${rel(CONFLICTS_FILE)} (catalog export ${baseline.catalogExport}): ${added.length} NEW, ${resolved.length} resolved`);
        printCapped(added.map((c) => `NEW ${describeConflict(c)}`), 'new');
        printCapped(resolved.map((c) => `resolved ${describeConflict(c)}`), 'resolved');
    }
    if (conflicts.length) console.log(`  full list for the DB manager: ${rel(CONFLICTS_NEXT_FILE)}`);

    if (stale) {
        const refreshed = REFRESH_CATALOG ? '' : ' (re-run --check without --cached-catalog first)';
        const out = OUT_FILE === DEFAULT_OUT ? '' : ` --out ${rel(OUT_FILE)}`;
        console.log(`next: npx tsx scripts/build-search-aliases.ts --refresh-catalog${out} [--refresh-sources for a new generation]${refreshed}; `
            + (out ? `npx tsx scripts/check-search-logic.ts ${rel(OUT_FILE)}` : `npx tsx scripts/check-search-logic.ts; commit ${rel(OUT_FILE)}`));
        console.log(`check: STALE (exit ${EXIT_STALE})`);
        return EXIT_STALE;
    }
    console.log('check: up to date (exit 0)');
    return 0;
}

function readPortal(text: string): PortalEntry[] {
    const entries = JSON.parse(text) as PortalEntry[];
    if (entries.length < 1025) throw new Error(`Thai portal: only ${entries.length} entries`);
    return entries;
}

/** Download-if-missing for a parsed JSON source; returns its cache file name. */
async function ensureFile(file: string, download: () => Promise<object>): Promise<string> {
    await cached(file, REFRESH_SOURCES, download);
    return file;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
