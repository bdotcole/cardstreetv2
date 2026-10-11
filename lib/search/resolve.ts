/**
 * Query resolution: which Pokémon a search names, in whatever language or
 * spelling it was typed, plus the forms and mechanics around the name.
 *
 *   "koiking"        -> Magikarp                 (romaji, phase 2)
 *   "ไรโค v"          -> Raikou + V
 *   "アローラロコン"   -> Vulpix + Alolan           (prefix glued to the name)
 *   "misty's magikarp" -> Magikarp, residual "misty"
 *
 * Three entry points with different appetites for guessing:
 *
 * - resolveExact (phase 1): exact dictionary names only. Cheap and safe; the
 *   catalog search always runs it.
 * - resolveLoose (phase 2): romaji/European names, Thai sound-alike spellings,
 *   prefixes and edit distance. Only for searches whose literal text found
 *   nothing good, because guessing on a query that already matched turns
 *   ordinary words into Pokémon ("holo" -> Hoothoot).
 * - resolveForFilter: phase 1 plus romaji/European exact names, never
 *   guessing. For listings and collection filters, which have no "the literal
 *   found nothing" signal to gate guesses on.
 *
 * Everything works on fold keys (normalize.ts). Text that will be sent to the
 * database (residuals) is cut back out of the typed query, never rebuilt from
 * a key, because keys drop Thai tone marks that ILIKE needs.
 */

import { clipQuery, foldKey, looseKey, scriptOf, tokenize, widthFold } from './normalize';
import { LANGUAGE_TOKENS, MODIFIERS, RARITY_TOKENS, STOPWORDS, type Modifier } from './modifiers';
import type { CatalogLanguage, GroupMatch, MatchKind, ModifierMatch, QueryAnalysis, Resolution } from './types';
import { getFuzzyIndex, spellingForKey, type FuzzyIndex, type FuzzyScript, type SearchDictionary } from './dictionary';

// ── Static tables (built once from modifiers.ts) ──

interface AffixSpelling {
    key: string;
    loose: string;
    mod: Modifier;
}

interface Tables {
    /** Fold key of every spelling (incl. detect and multi-word ones joined) -> modifier. */
    standalone: Map<string, Modifier>;
    /** Spellings that may be glued to the start of a name, longest first. */
    prefixes: AffixSpelling[];
    /** Spellings that may be glued to the end of a name, longest first. */
    suffixes: AffixSpelling[];
    language: Map<string, CatalogLanguage>;
    rarity: Set<string>;
    stop: Set<string>;
}

let tables: Tables | null = null;

type Pos = 'prefix' | 'suffix';

function getTables(): Tables {
    if (tables) return tables;
    const standalone = new Map<string, Modifier>();
    const prefixes: AffixSpelling[] = [];
    const suffixes: AffixSpelling[] = [];
    const seen = new Set<string>();
    const attach = (mod: Modifier, spelling: string, pos: Pos) => {
        const key = foldKey(spelling);
        if (!key) return;
        const id = `${mod.id}|${pos}|${key}`;
        if (seen.has(id)) return;
        seen.add(id);
        (pos === 'prefix' ? prefixes : suffixes).push({ key, loose: looseKey(spelling), mod });
    };
    for (const mod of MODIFIERS) {
        const all = [...mod.en, ...mod.ja, ...mod.th, ...(mod.detect || []), ...(mod.enStartsWith || [])];
        for (const s of all) {
            const key = foldKey(s);
            if (key && !standalone.has(key)) standalone.set(key, mod);
        }
        const base: Pos = mod.kind === 'suffix' ? 'suffix' : 'prefix';
        // Owners: EN/JA print them before the name, Thai after (มิวทูex ของแก๊งร็อกเกต).
        const thPos: Pos = mod.thPosition ?? (mod.kind === 'owner' ? 'suffix' : base);
        const jaPos: Pos = mod.jaPosition ?? base;
        // standaloneOnly keeps the Latin spellings ("dark", "m", "star") from
        // being peeled off a word. The Japanese and Thai spellings still
        // attach, because that is how the catalog prints them (メガルカリオex,
        // เมก้าลิซาร์ดอน X ex, เกียราดอสชั่วร้าย), and it is safe: a whole-name
        // match always runs first and a peel only counts when what remains is
        // itself a species, so メガヤンマ stays Yanmega and メガシグナル
        // (a trainer card) stays unresolved.
        if (!mod.standaloneOnly) {
            for (const s of mod.en) attach(mod, s, base);
            for (const s of mod.detect || []) attach(mod, s, base);
        }
        for (const s of mod.ja) attach(mod, s, jaPos);
        for (const s of mod.th) attach(mod, s, thPos);
    }
    prefixes.sort((a, b) => b.key.length - a.key.length);
    suffixes.sort((a, b) => b.key.length - a.key.length);

    const language = new Map<string, CatalogLanguage>();
    for (const lang of Object.keys(LANGUAGE_TOKENS) as CatalogLanguage[]) {
        for (const w of LANGUAGE_TOKENS[lang]) {
            const k = foldKey(w);
            if (k && !language.has(k)) language.set(k, lang);
        }
    }
    const rarity = new Set(RARITY_TOKENS.map(foldKey).filter(Boolean));
    const stop = new Set(Array.from(STOPWORDS, foldKey).filter(Boolean));
    tables = { standalone, prefixes, suffixes, language, rarity, stop };
    return tables;
}

/** True when the fold key of `word` is a shopping/collecting word that never names a Pokémon. */
export function isStopword(word: string): boolean {
    return getTables().stop.has(foldKey(word));
}

// ── Query analysis ──

// Mirrors the separator class in normalize.tokenize, with a capture group so
// the separators survive and the query can be put back together.
const SEPARATORS = /([\s\-.:/,·・&+()（）]+)/;

/**
 * Split off the words that say which printing the user wants ("jp", "ไทย",
 * "sar") so they rank results instead of filtering names. The remaining name
 * text keeps the user's own punctuation ("Mr. Mime" must still match
 * literally), and is untouched when nothing was stripped.
 */
export function analyzeQuery(q: string): QueryAnalysis {
    // Everything downstream does work per word and per character.
    const raw = clipQuery(q);
    const t = getTables();
    const parts = widthFold(raw).split(SEPARATORS);
    const toks: Array<{ text: string; sepBefore: string; drop: boolean }> = [];
    let sep = '';
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
            sep += parts[i];
            continue;
        }
        if (!parts[i]) continue;
        toks.push({ text: parts[i], sepBefore: sep, drop: false });
        sep = '';
    }

    const languagePref: CatalogLanguage[] = [];
    const rarityPref: string[] = [];
    for (const tok of toks) {
        const key = foldKey(tok.text);
        const lang = t.language.get(key);
        if (lang) {
            tok.drop = true;
            if (!languagePref.includes(lang)) languagePref.push(lang);
        } else if (t.rarity.has(key)) {
            tok.drop = true;
            if (!rarityPref.includes(key)) rarityPref.push(key);
        }
    }

    const kept = toks.filter((x) => !x.drop);
    const fullText = raw.replace(/\s+/g, ' ').trim();
    let nameText: string;
    if (kept.length === 0 || kept.length === toks.length) {
        // Nothing stripped, or stripping would leave nothing to search for
        // ("promo", "japanese" on their own are the search).
        nameText = fullText;
    } else {
        nameText = kept
            .map((x, i) => (i === 0 ? '' : x.sepBefore || ' ') + x.text)
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
    }
    const nameKey = foldKey(nameText);
    return {
        raw,
        nameText,
        nameKey,
        fullText,
        fullKey: fullText === nameText ? nameKey : foldKey(fullText),
        tokens: tokenize(nameText),
        script: scriptOf(nameKey),
        languagePref,
        rarityPref,
    };
}

// ── Edit distance (optimal string alignment) ──

let rowA = new Int32Array(64);
let rowB = new Int32Array(64);
let rowC = new Int32Array(64);

/**
 * Damerau OSA distance between two code-unit arrays, or max + 1 as soon as it
 * is known to exceed `max`. Typed-array rows reused across calls: the naive
 * version allocated per call and cost 4-11 ms per query on desktop.
 */
function boundedOsa(a: Uint16Array, b: Uint16Array, max: number): number {
    const m = a.length;
    const n = b.length;
    if (Math.abs(m - n) > max) return max + 1;
    if (n + 1 > rowA.length) {
        rowA = new Int32Array(n + 16);
        rowB = new Int32Array(n + 16);
        rowC = new Int32Array(n + 16);
    }
    let prev2 = rowA;
    let prev = rowB;
    let cur = rowC;
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        let rowMin = i;
        const ai = a[i - 1];
        for (let j = 1; j <= n; j++) {
            const cost = ai === b[j - 1] ? 0 : 1;
            let v = prev[j] + 1;
            const ins = cur[j - 1] + 1;
            if (ins < v) v = ins;
            const sub = prev[j - 1] + cost;
            if (sub < v) v = sub;
            if (i > 1 && j > 1 && ai === b[j - 2] && a[i - 2] === b[j - 1]) {
                const tr = prev2[j - 2] + 1;
                if (tr < v) v = tr;
            }
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        const tmp = prev2;
        prev2 = prev;
        prev = cur;
        cur = tmp;
    }
    return prev[n];
}

function toCodes(s: string): Uint16Array {
    const out = new Uint16Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

/**
 * Edit budget by query length in code units. Kana and Thai pack more into a
 * code unit than Latin does (a kana is a syllable; a Thai syllable is 2-4
 * units with its vowel signs), so two edits on a 5-6 unit word mostly reach
 * a different word: "マジシャン" became Chingling (リーシャン), "シャーロット"
 * Trevenant, and Thai trainer names like "โทโกะ" three different species.
 * Measured on catalog words that name no species, two edits only from 7
 * units cut phase-2 hits on kana words from 21% to 9% and on Thai words from
 * 9% to 1.5%, while random single-edit typos of every species' official
 * name still resolve 99% of the time in both scripts. (Zero edits up to 3
 * kana would cut kana hits to 4%, but loses 3-kana names like ロコン and
 * ミュウ, and phase 2 only runs when the literal text found nothing.)
 */
function maxDistance(script: FuzzyScript, len: number): number {
    if (script === 'latin') return len <= 4 ? 0 : len <= 8 ? 1 : 2;
    if (script === 'kana') return len <= 2 ? 0 : len <= 6 ? 1 : 2;
    return len <= 2 ? 0 : len <= 7 ? 1 : 2;
}

/**
 * Shortest query that may be completed to a longer name. In catalog search
 * the literal ILIKE already finds every name that starts with the query
 * ("garcho" finds Garchomp), so this tier only matters where the literal
 * found nothing; short prefixes there were mostly ordinary words completed
 * into species ("dragon" Dragonair, "spirit" Spiritomb, ゾロ Zorua, デス
 * Yamask), so it starts at a length few words reach by accident.
 */
const MIN_PREFIX: Record<FuzzyScript, number> = { latin: 7, thai: 5, kana: 4 };

function fuzzyScript(key: string): FuzzyScript | null {
    const s = scriptOf(key);
    return s === 'latin' || s === 'thai' || s === 'kana' ? s : null;
}

// ── Lookups ──

type Mode = 'exact' | 'filter' | 'loose';

function hitsFrom(dict: SearchDictionary, ids: number[] | undefined, kind: MatchKind, key: string): GroupMatch[] | null {
    if (!ids || ids.length === 0) return null;
    return ids.map((idx) => ({ group: dict.groups[idx], kind, distance: 0, matched: spellingForKey(dict, idx, key) }));
}

/**
 * Whether `key` is the beginning (not the whole) of some species' English,
 * Japanese or Thai name. A linear scan, but it only runs on the rare query
 * that hit a `late` name, and keeps the typo index out of the filter path.
 */
function startsCanonicalName(dict: SearchDictionary, key: string): boolean {
    for (const k of dict.keys) {
        if (k.en.length > key.length && k.en.startsWith(key)) return true;
        for (const list of [k.enDb, k.ja, k.th]) {
            for (const s of list) if (s.length > key.length && s.startsWith(key)) return true;
        }
    }
    return false;
}

function looseSpelling(dict: SearchDictionary, idx: number, loose: string): string {
    const g = dict.groups[idx];
    for (const s of [g.en, ...g.enDb, ...g.ja, ...g.th, ...g.aliases, ...g.late]) {
        if (looseKey(s) === loose) return s;
    }
    return g.en;
}

class Resolver {
    private fi: FuzzyIndex | null = null;

    constructor(private dict: SearchDictionary, private mode: Mode) {}

    private fuzzyIndex(): FuzzyIndex {
        if (!this.fi) this.fi = getFuzzyIndex(this.dict);
        return this.fi;
    }

    /** Exact-ish lookup used for word spans: never a guess beyond what the mode allows. */
    span(key: string): GroupMatch[] | null {
        if (!key || getTables().stop.has(key)) return null;
        const exact = hitsFrom(this.dict, this.dict.exact.get(key), 'exact', key);
        if (exact || this.mode === 'exact') return exact;
        // A romaji/European name that is also the start of a real name is
        // more likely that name half-typed: "ratta" (Raticate's romaji) while
        // typing Rattata, "melo" (Cleffa in French) while typing Meloetta,
        // "arbo" while typing Arbok. Listings and collection filters resolve
        // on every keystroke, so this mattered most there.
        const lateIds = this.dict.late.get(key);
        const late = lateIds && !startsCanonicalName(this.dict, key) ? hitsFrom(this.dict, lateIds, 'late', key) : null;
        if (late || this.mode === 'filter') return late;
        const lk = looseKey(key);
        const ids = this.fuzzyIndex().looseExact.get(lk);
        if (!ids || ids.length === 0) return null;
        return ids.map((idx) => ({ group: this.dict.groups[idx], kind: 'loose' as MatchKind, distance: 0, matched: looseSpelling(this.dict, idx, lk) }));
    }

    // Per query: pasted text repeats words ("charizrd charizrd ..."), and each
    // typo guess scans the length buckets.
    private guesses = new Map<string, GroupMatch[] | null>();

    /** Phase-2 tiers for one name (late/loose exact, then prefix, then edit distance). */
    guess(key: string, allowPrefix: boolean): GroupMatch[] | null {
        if (this.mode !== 'loose') return this.span(key);
        const t = getTables();
        if (!key || t.stop.has(key) || t.standalone.has(key) || /^\d+$/.test(key)) return null;
        const memo = `${allowPrefix ? 1 : 0}${key}`;
        if (this.guesses.has(memo)) return this.guesses.get(memo)!;
        const hits = this.span(key) || (allowPrefix ? this.prefix(key) : null) || this.fuzzy(key);
        this.guesses.set(memo, hits);
        return hits;
    }

    private prefix(key: string): GroupMatch[] | null {
        const script = fuzzyScript(key);
        if (!script || key.length < MIN_PREFIX[script]) return null;
        const fi = this.fuzzyIndex();
        const ids = fi.sorted[script];
        let lo = 0;
        let hi = ids.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (fi.entries[ids[mid]].key < key) lo = mid + 1;
            else hi = mid;
        }
        const cands: number[] = [];
        for (let i = lo; i < ids.length; i++) {
            const e = fi.entries[ids[i]];
            if (!e.key.startsWith(key)) break;
            if (e.key.length > key.length) cands.push(ids[i]);
        }
        if (cands.length === 0) return null;
        cands.sort((a, b) => fi.entries[a].key.length - fi.entries[b].key.length);
        const out: GroupMatch[] = [];
        for (const id of cands) {
            const e = fi.entries[id];
            if (out.some((m) => m.group.idx === e.group)) continue;
            out.push({ group: this.dict.groups[e.group], kind: 'prefix', distance: 0, matched: e.name });
            if (out.length >= 3) break;
        }
        return out;
    }

    private fuzzy(key: string): GroupMatch[] | null {
        const script = fuzzyScript(key);
        if (!script) return null;
        const max = maxDistance(script, key.length);
        if (max === 0) return null;
        const fi = this.fuzzyIndex();
        // Romaji names are short Latin words that look like English ones
        // (Aiant, Kaiden, Buby, Muma, Lizardo): at the normal budget, "giant",
        // "maiden", "buggy", "mummy" and "lizard" all became species. They
        // get typo tolerance only once the query is long enough to be a name.
        const romajiMax = key.length <= 6 ? 0 : key.length <= 9 ? 1 : 2;
        let best = max + 1;
        let found: Array<{ group: number; name: string }> = [];
        const visit = (buckets: number[][], query: Uint16Array, codesOf: (id: number) => Uint16Array) => {
            const n = query.length;
            for (let len = Math.max(1, n - max); len <= n + max; len++) {
                const bucket = buckets[len];
                if (!bucket) continue;
                for (const id of bucket) {
                    const e = fi.entries[id];
                    const limit = e.romaji ? Math.min(max, romajiMax) : max;
                    if (limit === 0) continue;
                    const d = boundedOsa(query, codesOf(id), Math.min(limit, best));
                    if (d > limit || d > best) continue;
                    if (d < best) {
                        best = d;
                        found = [];
                    }
                    if (!found.some((f) => f.group === e.group)) found.push({ group: e.group, name: e.name });
                }
            }
        };
        visit(fi.byLen[script], toCodes(key), (id) => fi.entries[id].foldCodes);
        visit(fi.byLooseLen[script], toCodes(looseKey(key)), (id) => fi.entries[id].looseCodes);
        if (found.length === 0) return null;
        return found.slice(0, 3).map((f) => ({ group: this.dict.groups[f.group], kind: 'fuzzy' as MatchKind, distance: best, matched: f.name }));
    }

    /**
     * Peel modifier spellings glued to either end of `key` until what is left
     * names a species ("pikachuex", "アローラロコンv", "มิวทูของแก๊งร็อกเกต").
     * Only accepted when the core resolves, so names that merely end in "ex"
     * or "v" (Toxapex, Smoliv) are never split.
     */
    split(key: string, depth = 0, exactOnly = false): { hits: GroupMatch[]; mods: AffixSpelling[] } | null {
        if (depth > 0) {
            const hits = this.mode === 'loose' && !exactOnly ? this.guess(key, false) : this.span(key);
            if (hits) return { hits, mods: [] };
        }
        if (depth >= 3) return null;
        const t = getTables();
        for (const s of t.suffixes) {
            if (key.length > s.key.length && key.endsWith(s.key)) {
                const r = this.split(key.slice(0, key.length - s.key.length), depth + 1, exactOnly);
                if (r) {
                    r.mods.push(s);
                    return r;
                }
            }
        }
        for (const s of t.prefixes) {
            if (key.length > s.key.length && key.startsWith(s.key)) {
                const r = this.split(key.slice(s.key.length), depth + 1, exactOnly);
                if (r) {
                    r.mods.push(s);
                    return r;
                }
            }
        }
        return null;
    }

    /** Longest dictionary name (>= 3 code points) the glued token starts with. */
    leftAnchored(key: string): { hits: GroupMatch[]; len: number } | null {
        for (let len = key.length - 1; len >= 3; len--) {
            const head = key.slice(0, len);
            if (this.mode === 'loose') {
                const ids = this.fuzzyIndex().looseExact.get(head);
                if (ids && ids.length) {
                    return { len, hits: ids.map((idx) => ({ group: this.dict.groups[idx], kind: 'loose' as MatchKind, distance: 0, matched: looseSpelling(this.dict, idx, head) })) };
                }
            } else {
                const hits = hitsFrom(this.dict, this.dict.exact.get(head), 'exact', head);
                if (hits) return { hits, len };
            }
        }
        return null;
    }
}

// ── Segmentation ──

type TokState = 'free' | 'used' | 'stop' | 'num' | 'conn';

interface Tok {
    raw: string;
    key: string;
    state: TokState;
}

// Thai ของ ("of", the owner connector) and Japanese の (folded to ノ).
const CONNECTORS = new Set(['ของ', 'ノ']);

// Text that cannot start a Thai syllable: following vowels (ะ ั า ำ ิ-ฺ ๅ),
// MAITAIKHU, tone marks, THANTHAKHAT, NIKHAHIT, YAMAKKAN, or a consonant
// silenced by THANTHAKHAT.
const THAI_MID_SYLLABLE = /^(?:[ะ-ฺๅ็-๎]|[ก-ฮ]์)/;

function emptyResolution(): Resolution {
    return { groups: [], modifiers: [], residual: [] };
}

/**
 * Cut the text whose fold is key[start:end] back out of the typed token, so a
 * residual keeps its tone marks and case for the ILIKE leg. A mark that folds
 * to nothing at the boundary stays with the name before it.
 */
function rawSlice(raw: string, fold: (s: string) => string, key: string, start: number, end: number): string {
    const want = key.slice(start, end);
    let from = -1;
    for (let i = 0; i <= raw.length; i++) {
        const f = fold(raw.slice(0, i));
        if (f === key.slice(0, start)) from = i;
        else if (f.length > start) break;
    }
    if (from >= 0) {
        // The END of the cut is searched from the end of the token: only
        // peeled suffix modifiers lie beyond it, so this is a few folds, where
        // walking forward re-folded every prefix of the token (quadratic in
        // its length; a pasted kana or Thai string cost hundreds of ms).
        // Folded length never shrinks as the prefix grows, so the first match
        // from the end is the last raw index that folds to key[0:end].
        let to = -1;
        const target = key.slice(0, end);
        for (let j = raw.length; j >= from; j--) {
            const f = fold(raw.slice(0, j));
            if (f === target) {
                to = j;
                break;
            }
            if (f.length < end) break;
        }
        if (to > from) {
            const out = raw.slice(from, to).trim();
            if (out && fold(out) === want) return out;
        }
    }
    return want;
}

/** "misty's" / "mistys" -> "misty": the leg must still match "Misty's Magikarp". */
function residualText(raw: string): string {
    let s = raw.replace(/['’]s$/i, '').trim();
    if (/^[a-z]{5,}$/i.test(s) && /s$/i.test(s) && !/ss$/i.test(s)) s = s.slice(0, -1);
    return s;
}

function segment(dict: SearchDictionary, a: QueryAnalysis, mode: Mode): Resolution {
    if (!dict || dict.groups.length === 0 || !a || !a.nameKey) return emptyResolution();
    const t = getTables();
    const r = new Resolver(dict, mode);

    const groups: GroupMatch[] = [];
    const modifiers: ModifierMatch[] = [];
    const residual: string[] = [];
    const addGroups = (hits: GroupMatch[]) => {
        for (const h of hits) if (!groups.some((g) => g.group.idx === h.group.idx)) groups.push(h);
    };
    const addMod = (mod: Modifier, matched: string) => {
        if (!modifiers.some((m) => m.modifier.id === mod.id)) modifiers.push({ modifier: mod, matched });
    };
    const addResidual = (s: string) => {
        const v = s.trim();
        if (v && !residual.includes(v)) residual.push(v);
    };
    const finish = (): Resolution =>
        groups.length === 0 ? emptyResolution() : { groups: groups.slice(0, 3), modifiers, residual };

    // 1. The whole name is one dictionary name ("mr. mime", "nidoran f", "ho-oh").
    if (!t.stop.has(a.nameKey)) {
        const whole = r.span(a.nameKey);
        if (whole) return { groups: whole.slice(0, 3), modifiers: [], residual: [] };
    }

    const toks: Tok[] = a.tokens.map((raw) => {
        const key = foldKey(raw);
        let state: TokState = 'free';
        if (!key || t.stop.has(key)) state = 'stop';
        else if (/^\d+$/.test(key)) state = 'num';
        else if (CONNECTORS.has(key)) state = 'conn';
        return { raw, key, state };
    });
    const n = toks.length;

    // 2. Species spans, longest first, before modifiers: "nidoran m" is
    // Nidoran♂, not Nidoran + Mega; "mew two" is Mewtwo. A span of several
    // words may also carry a glued modifier ("คาปู บูลูลูGX", "โพรีกอน-แซดGX"):
    // without that, the first word alone wins (Porygon for Porygon-Z) or a
    // fragment gets matched inside a longer name (บูล Snubbull in บูลูลู).
    for (let i = 0; i < n; ) {
        let consumed = 0;
        if (toks[i].state === 'free') {
            for (let len = Math.min(4, n - i); len >= 1 && !consumed; len--) {
                let key = '';
                let ok = true;
                for (let j = i; j < i + len; j++) {
                    if (toks[j].state !== 'free') {
                        ok = false;
                        break;
                    }
                    key += toks[j].key;
                }
                if (!ok || (len === 1 && t.standalone.has(key))) continue;
                const hits = r.span(key);
                const glued = !hits && len >= 2 ? r.split(key, 0, true) : null;
                if (hits || glued) {
                    if (hits) addGroups(hits);
                    if (glued) {
                        addGroups(glued.hits);
                        for (const m of glued.mods) addMod(m.mod, m.key);
                    }
                    for (let j = i; j < i + len; j++) toks[j].state = 'used';
                    consumed = len;
                }
            }
        }
        i += consumed || 1;
    }

    // 3. Modifiers written as separate words, multi-word ones first
    // ("team rocket's", "origin forme", "single strike").
    for (let i = 0; i < n; ) {
        let consumed = 0;
        if (toks[i].state === 'free') {
            for (let len = Math.min(3, n - i); len >= 1 && !consumed; len--) {
                let key = '';
                let ok = true;
                for (let j = i; j < i + len; j++) {
                    if (toks[j].state !== 'free') {
                        ok = false;
                        break;
                    }
                    key += toks[j].key;
                }
                const mod = ok ? t.standalone.get(key) : undefined;
                if (mod) {
                    addMod(mod, toks.slice(i, i + len).map((x) => x.raw).join(' '));
                    for (let j = i; j < i + len; j++) toks[j].state = 'used';
                    consumed = len;
                }
            }
        }
        i += consumed || 1;
    }

    const free = () => toks.filter((x) => x.state === 'free');

    // Every name word was a modifier ("dark", "radiant v"): nothing to resolve,
    // and phase 2 must not start guessing species from scratch.
    if (free().length === 0) return finish();

    // 4 (phase 2). The remaining name as a whole, then word by word.
    if (mode === 'loose') {
        const rest = free();
        const whole = r.guess(rest.map((x) => x.key).join(''), true);
        if (whole) {
            addGroups(whole);
            for (const x of rest) x.state = 'used';
        } else if (rest.length > 1) {
            for (const x of rest) {
                const hits = r.guess(x.key, false);
                if (hits) {
                    addGroups(hits);
                    x.state = 'used';
                }
            }
        }
    } else if (free().length > 1) {
        const rest = free();
        const hits = r.span(rest.map((x) => x.key).join(''));
        if (hits) {
            addGroups(hits);
            for (const x of rest) x.state = 'used';
        }
    }

    // 5. Modifiers glued to a name.
    for (const x of toks) {
        if (x.state !== 'free') continue;
        const s = r.split(x.key);
        if (s) {
            addGroups(s.hits);
            for (const m of s.mods) addMod(m.mod, m.key);
            x.state = 'used';
        }
    }

    // 6. Japanese owner glued with の: カスミのコイキング -> Magikarp + "カスミ".
    for (const x of toks) {
        if (x.state !== 'free') continue;
        const at = x.raw.lastIndexOf('の');
        if (at <= 0 || at >= x.raw.length - 1) continue;
        const coreKey = foldKey(x.raw.slice(at + 1));
        const hits = r.guess(coreKey, false);
        const s = hits ? { hits, mods: [] as AffixSpelling[] } : r.split(coreKey);
        if (s) {
            addGroups(s.hits);
            for (const m of s.mods) addMod(m.mod, m.key);
            addResidual(x.raw.slice(0, at));
            x.state = 'used';
        }
    }

    // 7. Thai and kana are typed without spaces: take the longest name the
    // token starts with (after any glued prefix modifiers: メガリザードンXex,
    // เมก้าลิซาร์ดอนXex), peel modifiers off what follows, and keep the rest as
    // a residual ("คอยคิงของคาซุมิ" -> Magikarp + "ของคาซุมิ").
    for (const x of toks) {
        if (x.state !== 'free' || !/^[฀-๿゠-ヿ぀-ゟ]/.test(x.raw)) continue;
        const fold = mode === 'loose' ? looseKey : foldKey;
        const key = fold(x.raw);
        const mods: Array<{ mod: Modifier; matched: string }> = [];
        let pre = 0;
        let head = r.leftAnchored(key);
        // Only when the whole token does not already start with a name, so a
        // species whose name begins like a modifier is never cut.
        for (let i = 0; !head && i < 2; i++) {
            const s = t.prefixes.find((p) => {
                const k = mode === 'loose' ? p.loose : p.key;
                return k && key.length > pre + k.length && key.startsWith(k, pre);
            });
            if (!s) break;
            mods.push({ mod: s.mod, matched: s.key });
            pre += (mode === 'loose' ? s.loose : s.key).length;
            head = r.leftAnchored(key.slice(pre));
        }
        if (!head) continue;
        let start = pre + head.len;
        let end = key.length;
        const spellings = [...t.suffixes, ...t.prefixes].sort((p, q) => q.key.length - p.key.length);
        for (let changed = true; changed && start < end; ) {
            changed = false;
            const rest = key.slice(start, end);
            for (const s of spellings) {
                const k = mode === 'loose' ? s.loose : s.key;
                if (!k || k.length > rest.length) continue;
                if (rest.startsWith(k)) {
                    mods.push({ mod: s.mod, matched: s.key });
                    start += k.length;
                    changed = true;
                    break;
                }
                if (rest.endsWith(k)) {
                    mods.push({ mod: s.mod, matched: s.key });
                    end -= k.length;
                    changed = true;
                    break;
                }
            }
        }
        let leftover: string | null = null;
        if (start < end) {
            const rest = rawSlice(x.raw, fold, key, start, end);
            const restKey = foldKey(rest);
            // With the species already identified, a leftover that is exactly a
            // modifier word is that modifier, even one never split off a name
            // (เกียราดอสชั่วร้าย = Dark Gyarados): the risk standaloneOnly
            // guards against is cutting it out of another species' name.
            const mod = t.standalone.get(restKey);
            if (mod) mods.push({ mod, matched: rest });
            // "ปิกาจูการ์ด", "ピカチュウカード": the word for "card" is not part
            // of any name, and ANDing it in would only empty the results.
            else if (!t.stop.has(restKey)) leftover = rest;
        }
        if (leftover !== null) {
            // Katakana compounds from other games start with species names far
            // more often than Japanese Pokémon queries glue on a free word
            // (ブルーアイズ is Blue-Eyes, not Snubbull + アイズ; ガーディアン,
            // ゴーストリック, イワンコフ), and a Japanese owner comes before の
            // (handled above). So after a kana head only modifiers or Latin
            // letters may follow (the X of メガリザードンXex). Thai is typed
            // without spaces, so a Thai head keeps any leftover as a residual
            // ("คอยคิงของคาซุมิ").
            if (/^[゠-ヿ぀-ゟ]/.test(x.raw) && !/^[a-z0-9]+$/.test(foldKey(leftover))) continue;
            // A Thai cut must fall between syllables. A leftover that opens with
            // a vowel sign, tone mark or silenced consonant (ร์) means the
            // "name" was the front half of a longer syllable: วีกา|ร์ดเอนเนอร์จี้
            // is "V-card energy", not a species plus residual.
            if (THAI_MID_SYLLABLE.test(leftover)) continue;
        }
        addGroups(head.hits);
        for (const m of mods) addMod(m.mod, m.matched);
        if (leftover !== null) addResidual(leftover);
        x.state = 'used';
    }

    // A guessed species next to words that are neither species, modifiers nor
    // an owner is more likely some other card altogether: "monkey d luffy"
    // is not Mankey, "blue eyes white dragon" is not Dragonair. Only an
    // owner ("misty's", "ของ N") may ride along with a phase-2 guess.
    if (mode === 'loose') {
        const unexplained = toks.some(
            (x, i) => x.state === 'free' && !/['’]s$/i.test(x.raw) && !(i > 0 && toks[i - 1].key === 'ของ'),
        );
        if (unexplained) return emptyResolution();
    }

    // 8. Leftovers become residual name fragments; "ของ N" stays one phrase.
    for (let i = 0; i < n; i++) {
        const x = toks[i];
        if (x.state === 'conn') {
            const next = toks[i + 1];
            if (x.key === 'ของ' && next && next.state === 'free') {
                addResidual(`${x.raw} ${next.raw}`);
                next.state = 'used';
                i++;
            }
            continue;
        }
        if (x.state === 'free') addResidual(residualText(x.raw));
    }

    return finish();
}

// ── Public API ──

/** Phase 1: exact dictionary names only. */
export function resolveExact(dict: SearchDictionary, a: QueryAnalysis): Resolution {
    return segment(dict, a, 'exact');
}

/**
 * Phase 2: romaji/European names, Thai sound-alikes, prefixes and typos.
 * Callers run it only when phase 1 found no species and the literal search
 * found nothing that starts with the query.
 */
export function resolveLoose(dict: SearchDictionary, a: QueryAnalysis): Resolution {
    return segment(dict, a, 'loose');
}

/** Exact names plus romaji/European exact names; never a guess. For listings and collection filters. */
export function resolveForFilter(dict: SearchDictionary, q: string): Resolution {
    if (!dict) return emptyResolution();
    const a = analyzeQuery(q);
    const exact = segment(dict, a, 'exact');
    return exact.groups.length > 0 ? exact : segment(dict, a, 'filter');
}
