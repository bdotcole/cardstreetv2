/**
 * The Pokémon name dictionary behind smart search (Magikarp = コイキング =
 * Koiking = คอยคิง), loaded on demand.
 *
 * The data file (lib/search/data/pokemonNames.json, built by
 * scripts/build-search-aliases.ts) is ~290 KB (~60 KB brotli), so client code only ever
 * reaches it through the dynamic import below, which webpack emits as its own
 * chunk: pages that never search never download it. Server routes use
 * dictionary.server.ts instead. No module shared with the client may import
 * the JSON statically, or it lands in the main bundle of every page.
 *
 * Index building is split in two. The exact maps are cheap (the build
 * precomputes every fold key) and are built when the file arrives. The typo
 * structures (prefix arrays, length buckets for edit distance, the loose-key
 * map) are only needed when a query found nothing exact, so they are built on
 * first use by getFuzzyIndex(). That keeps the first keystroke after load
 * free of a ~100 ms index build on low-end Android WebViews.
 */

import { FOLD_VERSION, foldKey, looseKey } from './normalize';
import type { NameGroup, SearchDictionaryFile } from './types';

/** Fold keys of one group's spellings, mirroring NameGroup's fields. */
export interface GroupKeys {
    en: string;
    enDb: string[];
    ja: string[];
    th: string[];
    aliases: string[];
    late: string[];
}

export interface SearchDictionary {
    groups: NameGroup[];
    keys: GroupKeys[];
    /** Phase-1 index: fold key of en/enDb/ja/th/aliases -> group indexes. */
    exact: Map<string, number[]>;
    /** Phase-2-only index: fold key of romaji/fr/de/es/it -> group indexes. */
    late: Map<string, number[]>;
}

// ── Building ──

function asStrings(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : [];
}

function addKey(map: Map<string, number[]>, key: string, idx: number) {
    if (!key) return;
    const list = map.get(key);
    if (!list) map.set(key, [idx]);
    else if (!list.includes(idx)) list.push(idx);
}

/**
 * Turn the serialized file into lookup maps. Pure, so the check script and
 * the server can build from a parsed file without the dynamic import. Uses the
 * file's precomputed fold keys when they were made by the current fold, and
 * recomputes them otherwise (a fold change must never silently desync the
 * keys from what queries fold to).
 */
export function buildSearchDictionary(file: SearchDictionaryFile): SearchDictionary {
    const rows = Array.isArray(file?.groups) ? file.groups : [];
    const fileKeys = Array.isArray(file?.keys) ? file.keys : [];
    const trustKeys = file?.foldVersion === FOLD_VERSION && fileKeys.length === rows.length;

    const groups: NameGroup[] = [];
    const keys: GroupKeys[] = [];
    const exact = new Map<string, number[]>();
    const late = new Map<string, number[]>();

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row) || typeof row[1] !== 'string' || !row[1]) continue;
        const idx = groups.length;
        const group: NameGroup = {
            idx,
            dex: typeof row[0] === 'number' ? row[0] : 0,
            en: row[1],
            enDb: asStrings(row[2]),
            ja: asStrings(row[3]),
            th: asStrings(row[4]),
            aliases: asStrings(row[5]),
            late: asStrings(row[6]),
        };
        const pre = trustKeys ? fileKeys[i] : null;
        const k: GroupKeys = pre && Array.isArray(pre)
            ? {
                en: typeof pre[0] === 'string' ? pre[0] : foldKey(group.en),
                enDb: asStrings(pre[1]).length === group.enDb.length ? asStrings(pre[1]) : group.enDb.map(foldKey),
                ja: asStrings(pre[2]).length === group.ja.length ? asStrings(pre[2]) : group.ja.map(foldKey),
                th: asStrings(pre[3]).length === group.th.length ? asStrings(pre[3]) : group.th.map(foldKey),
                aliases: asStrings(pre[4]).length === group.aliases.length ? asStrings(pre[4]) : group.aliases.map(foldKey),
                late: asStrings(pre[5]).length === group.late.length ? asStrings(pre[5]) : group.late.map(foldKey),
            }
            : {
                en: foldKey(group.en),
                enDb: group.enDb.map(foldKey),
                ja: group.ja.map(foldKey),
                th: group.th.map(foldKey),
                aliases: group.aliases.map(foldKey),
                late: group.late.map(foldKey),
            };
        groups.push(group);
        keys.push(k);
        addKey(exact, k.en, idx);
        for (const key of k.enDb) addKey(exact, key, idx);
        for (const key of k.ja) addKey(exact, key, idx);
        for (const key of k.th) addKey(exact, key, idx);
        for (const key of k.aliases) addKey(exact, key, idx);
        for (const key of k.late) addKey(late, key, idx);
    }
    return { groups, keys, exact, late };
}

/** The dictionary spelling of `idx` whose fold key is `key` (for GroupMatch.matched). */
export function spellingForKey(dict: SearchDictionary, idx: number, key: string): string {
    const g = dict.groups[idx];
    const k = dict.keys[idx];
    if (!g || !k) return key;
    if (k.en === key) return g.en;
    const lists: Array<[string[], string[]]> = [
        [k.enDb, g.enDb], [k.ja, g.ja], [k.th, g.th], [k.aliases, g.aliases], [k.late, g.late],
    ];
    for (const [ks, names] of lists) {
        const i = ks.indexOf(key);
        if (i >= 0 && names[i]) return names[i];
    }
    return g.en;
}

// ── Typo structures (lazy) ──

export type FuzzyScript = 'latin' | 'thai' | 'kana';

export interface FuzzyEntry {
    key: string;
    loose: string;
    group: number;
    name: string;
    script: FuzzyScript;
    /** A romaji spelling (Koiking): typo-matched under a tighter budget, see resolve.ts. */
    romaji: boolean;
    foldCodes: Uint16Array;
    looseCodes: Uint16Array;
}

export interface FuzzyIndex {
    entries: FuzzyEntry[];
    /** Entry ids per script, sorted by fold key, for prefix lookups by binary search. */
    sorted: Record<FuzzyScript, number[]>;
    /** Entry ids per script, bucketed by fold-key length, so edit distance only visits plausible lengths. */
    byLen: Record<FuzzyScript, number[][]>;
    /** Same, bucketed by loose-key length. */
    byLooseLen: Record<FuzzyScript, number[][]>;
    /** Loose key -> groups, over every phase-1 name plus the romaji spellings. */
    looseExact: Map<string, number[]>;
}

const fuzzyCache = new WeakMap<SearchDictionary, FuzzyIndex>();

function toCodes(s: string): Uint16Array {
    const out = new Uint16Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

const THAI_CHAR = /[฀-๿]/;

/**
 * looseKey of something that is already a fold key. looseKey refolds its
 * input (NFKC/NFD), which dominated the index build; only Thai letters need
 * its table, and for every other key the loose form is just the collapse of
 * doubled Latin letters.
 */
function looseOfKey(key: string): string {
    return THAI_CHAR.test(key) ? looseKey(key) : key.replace(/([a-z])\1+/g, '$1');
}

/**
 * scriptOf for fold keys, by code-point range instead of five regex tests per
 * character (same counting and 'mixed' rule; this ran ~10k times per build).
 */
function keyScript(key: string): FuzzyScript | null {
    let latin = 0;
    let thai = 0;
    let kana = 0;
    let other = 0;
    for (let i = 0; i < key.length; i++) {
        const c = key.charCodeAt(i);
        if ((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) latin++;
        else if (c >= 0x0e00 && c <= 0x0e7f) thai++;
        else if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff)) {
            // Han counts with kana when kana is present (Japanese); a key
            // that is all han is Chinese and stays out of the typo index.
            if (c >= 0x3400) other++;
            else kana++;
        } else if ((c >= 0xac00 && c <= 0xd7af) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f)) return null;
    }
    if (kana > 0) {
        kana += other;
        other = 0;
    }
    let best: FuzzyScript | null = null;
    let bestN = 0;
    let second = 0;
    const consider = (script: FuzzyScript | null, n: number) => {
        if (n > bestN) {
            second = bestN;
            bestN = n;
            best = script;
        } else if (n > second) {
            second = n;
        }
    };
    consider('latin', latin);
    consider('thai', thai);
    consider('kana', kana);
    consider(null, other);
    if (bestN === 0 || (second > 0 && second / key.length > 0.3)) return null;
    return best;
}

/**
 * Prefix and edit-distance matching cover only en/enDb/ja/th plus the romaji
 * spellings, never fr/de/es/it/ko/zh: over all aliases, fuzzy matching turned
 * a third of common TCG words into some species ("holo" Hoothoot, "sleeve"
 * Drowzee), and restricting it cut that to ~5% with no loss of real typos.
 */
export function getFuzzyIndex(dict: SearchDictionary): FuzzyIndex {
    const cached = fuzzyCache.get(dict);
    if (cached) return cached;

    const entries: FuzzyEntry[] = [];
    const seen = new Set<string>();
    const looseExact = new Map<string, number[]>();
    const push = (key: string, name: string, group: number, romaji = false) => {
        if (!key) return;
        const loose = looseOfKey(key);
        addKey(looseExact, loose, group);
        const script = keyScript(key);
        if (!script) return;
        const dedupe = `${group}\u0000${key}`;
        if (seen.has(dedupe)) return;
        seen.add(dedupe);
        const foldCodes = toCodes(key);
        entries.push({ key, loose, group, name, script, romaji, foldCodes, looseCodes: loose === key ? foldCodes : toCodes(loose) });
    };

    for (let i = 0; i < dict.groups.length; i++) {
        const g = dict.groups[i];
        const k = dict.keys[i];
        push(k.en, g.en, i);
        k.enDb.forEach((key, j) => push(key, g.enDb[j], i));
        k.ja.forEach((key, j) => push(key, g.ja[j], i));
        k.th.forEach((key, j) => push(key, g.th[j], i));
        // Thai fan spellings and ko/zh names: loose-exact only (no prefix or
        // edit distance), which is what turns ปิกาจู-style spellings into hits.
        k.aliases.forEach((key) => {
            if (key) addKey(looseExact, looseOfKey(key), i);
        });
        // The build lists the romaji first when it survived its filters
        // (romaji, fr, de, es, it), so only the first late name can be it;
        // the check below still has to confirm it.
        if (k.late[0] && g.ja[0] && isRomajiOf(k.late[0], romajiSkeleton(katakanaToRomaji(g.ja[0])))) {
            push(k.late[0], g.late[0], i, true);
        }
    }

    const scripts: FuzzyScript[] = ['latin', 'thai', 'kana'];
    const sorted = { latin: [], thai: [], kana: [] } as Record<FuzzyScript, number[]>;
    const byLen = { latin: [], thai: [], kana: [] } as Record<FuzzyScript, number[][]>;
    const byLooseLen = { latin: [], thai: [], kana: [] } as Record<FuzzyScript, number[][]>;
    entries.forEach((e, id) => {
        sorted[e.script].push(id);
        (byLen[e.script][e.key.length] ||= []).push(id);
        (byLooseLen[e.script][e.loose.length] ||= []).push(id);
    });
    for (const s of scripts) {
        sorted[s].sort((a, b) => (entries[a].key < entries[b].key ? -1 : entries[a].key > entries[b].key ? 1 : 0));
    }

    const index: FuzzyIndex = { entries, sorted, byLen, byLooseLen, looseExact };
    fuzzyCache.set(dict, index);
    return index;
}

// ── Romaji detection ──
//
// The file stores romaji, fr, de, es and it together in `late`, but only the
// romaji (Koiking, Lizardon, Hitokage) belong in the typo index: they are how
// people who learned the Japanese names type them. A romaji spelling is a
// romanization of the katakana name, so compare the two after collapsing the
// usual romanization differences (l/r, c/k, long vowels, Hepburn's extra u).
// Over all PokeAPI species this keeps 91% of romaji and admits 4% of the
// European names, mostly ones that are themselves near-romaji (Ponita,
// Garados, Kapoera) and harmless in the index.

const KANA_ROMAJI: Record<string, string> = {
    ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o',
    カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko', ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go',
    サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
    タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to', ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do',
    ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no',
    ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho', バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
    パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po',
    マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
    ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヲ: 'wo', ン: 'n', ヴ: 'vu',
};
const SMALL_VOWEL: Record<string, string> = { ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o' };
const SMALL_Y: Record<string, string> = { ャ: 'a', ュ: 'u', ョ: 'o' };

function katakanaToRomaji(s: string): string {
    let out = '';
    let geminate = false;
    for (const ch of s) {
        if (ch === 'ッ') { geminate = true; continue; }
        if (ch === 'ー') {
            const v = /[aeiou]$/.exec(out);
            if (v) out += v[0];
            continue;
        }
        if (SMALL_Y[ch]) {
            if (/(sh|ch|j)i$/.test(out)) out = out.slice(0, -1) + SMALL_Y[ch];
            else if (/i$/.test(out)) out = out.slice(0, -1) + 'y' + SMALL_Y[ch];
            else out += 'y' + SMALL_Y[ch];
            continue;
        }
        if (SMALL_VOWEL[ch]) {
            if (out === 'u') out = 'w' + SMALL_VOWEL[ch];
            else if (/[aeiou]$/.test(out)) out = out.slice(0, -1) + SMALL_VOWEL[ch];
            else out += SMALL_VOWEL[ch];
            continue;
        }
        let r = KANA_ROMAJI[ch];
        if (!r) { out += ch.toLowerCase(); geminate = false; continue; }
        if (geminate && !/^[aeiou]/.test(r)) r = r[0] + r;
        geminate = false;
        out += r;
    }
    return out;
}

// One pass for the letter merges: this runs per species on the first typo
// search, on phones too.
const SKELETON_MAP: Record<string, string> = { q: 'k', x: 'ks', l: 'r', v: 'b', y: 'i', w: 'u' };

function romajiSkeleton(s: string): string {
    const src = s.toLowerCase().replace(/[^a-z]/g, '');
    let k = '';
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        const next = src[i + 1];
        if (ch === 'p' && next === 'h') {
            k += 'f';
            i++;
        } else if (ch === 'c') {
            if (next === 'h') k += 'c';
            else {
                k += 'k';
                if (next === 'k') i++;
            }
        } else {
            k += SKELETON_MAP[ch] ?? ch;
        }
    }
    k = k.replace(/ou/g, 'o').replace(/ei/g, 'e').replace(/(.)\1+/g, '$1');
    return k.replace(/([bdfgkmprstz])u(?=[bdfgkmprstz]|$)/g, '$1');
}

function plainDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    let prev2 = new Array<number>(n + 1).fill(0);
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    let cur = new Array<number>(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
            cur[j] = v;
        }
        [prev2, prev, cur] = [prev, cur, prev2];
    }
    return prev[n];
}

function isRomajiOf(latinKey: string, kanaSkeleton: string): boolean {
    if (!kanaSkeleton || keyScript(latinKey) !== 'latin') return false;
    const b = romajiSkeleton(latinKey);
    if (!b) return false;
    const longest = Math.max(kanaSkeleton.length, b.length);
    // Cheap reject before the distance: the length gap alone is already too big.
    if (Math.abs(kanaSkeleton.length - b.length) / longest > 0.34) return false;
    return plainDistance(kanaSkeleton, b) / longest <= 0.34;
}

// ── Loading (client) ──

let loaded: SearchDictionary | null = null;
let inflight: Promise<SearchDictionary | null> | null = null;

let warmScheduled = false;

/**
 * Build the typo structures in idle time (~60 ms on desktop, several times
 * that on a low-end phone, ~2 MB of heap), so the first search that needs them
 * does not pay for it while the user waits. Only for callers that can reach a
 * typo search (catalog search boxes); a collection filter never guesses, and
 * getFuzzyIndex still builds on first use if one turns up later.
 *
 * No idle timeout: a deadline would run the build as a long task while the
 * user is scrolling or typing, and nothing needs it by then (a typo search
 * that comes first builds it itself). Safari has no requestIdleCallback; a
 * delayed task there is fine, since every device it runs on builds this fast.
 */
function warmFuzzyIndexWhenIdle(dict: SearchDictionary): void {
    if (typeof window === 'undefined' || warmScheduled) return;
    warmScheduled = true;
    const run = () => {
        try {
            getFuzzyIndex(dict);
        } catch {
            // Built again on demand; nothing to do here.
        }
    };
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof idle === 'function') idle.call(window, run);
    else setTimeout(run, 2000);
}
let failedAt = 0;
const RETRY_AFTER_MS = 30_000;

function startLoad(): Promise<SearchDictionary | null> {
    if (loaded) return Promise.resolve(loaded);
    if (inflight) return inflight;
    // A failed chunk load (flaky network, or a deploy that replaced the chunk
    // under a long-lived WebView) must not disable aliasing for the whole
    // session, but it also must not refetch on every keystroke.
    if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(null);
    inflight = import('./data/pokemonNames.json')
        .then((mod) => {
            const file = ((mod as { default?: unknown }).default ?? mod) as unknown as SearchDictionaryFile;
            const dict = buildSearchDictionary(file);
            loaded = dict;
            return dict;
        })
        .catch((err) => {
            console.warn('[search] dictionary failed to load:', err);
            failedAt = Date.now();
            inflight = null;
            return null;
        });
    return inflight;
}

/**
 * The dictionary, or null if it is not available within `timeoutMs`. A
 * timeout does not cancel the download: a later call gets the dictionary as
 * soon as it has arrived. Search continues literal-only on null, so a slow
 * mobile link never holds a search hostage to the dictionary chunk.
 */
export function loadSearchDictionary(timeoutMs = 800, opts?: { warmTypo?: boolean }): Promise<SearchDictionary | null> {
    if (loaded) {
        if (opts?.warmTypo) warmFuzzyIndexWhenIdle(loaded);
        return Promise.resolve(loaded);
    }
    const p = startLoad();
    if (opts?.warmTypo) p.then((d) => { if (d) warmFuzzyIndexWhenIdle(d); });
    if (!(timeoutMs > 0) || !Number.isFinite(timeoutMs)) return p;
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        p.then((d) => {
            clearTimeout(timer);
            resolve(d);
        });
    });
}

/**
 * Start the download without waiting, when a catalog search box gains focus.
 * Also warms the typo index, which those boxes can reach. Takes no arguments,
 * so it can be passed straight to onFocus.
 */
export function preloadSearchDictionary(): void {
    void loadSearchDictionary(0, { warmTypo: true });
}

/** The dictionary if it has already loaded, else null. Never triggers a download. */
export function getLoadedSearchDictionary(): SearchDictionary | null {
    return loaded;
}
