/**
 * Builds the name filter for a catalog or listings search as ONE PostgREST
 * logic-tree string, for `.or(...)`.
 *
 * Alternatives, ORed:
 *   1. the literal query        name ILIKE %q% (and the English-name column)
 *   2. every word of it         and(or(%w1%), or(%w2%))  when nothing resolved
 *   3. the resolved species     and(game = pokemon, or(<names in en/ja/th>), or(<each modifier>), or(<each residual>))
 *
 * Invariants, because PostgREST fails or over-matches silently otherwise:
 * - An empty `or()`/`and()`, or a doubled/trailing comma, is HTTP 400 for the
 *   WHOLE request, and every fetch of a search shares the predicate, so one
 *   bad arm blanks search. Nodes with no legs are dropped, never emitted.
 * - An empty pattern (`%%`), `*`, `_` and `\` all turn a leg into "match
 *   every row". Every term goes through sanitizeTerm and empty terms are
 *   skipped.
 * - Legs shorter than 3 characters cannot use the trigram index, and one
 *   unindexable arm makes Postgres scan the whole table for the entire OR.
 *   Short legs ('ex', 'V', ピィ) therefore appear only inside an AND arm that
 *   also has an indexable species leg; the 2-character native names use a
 *   left-anchored pattern, which pg_trgm can index, and the short Latin
 *   mechanics a right-anchored one (see isShortMechanic).
 */

import { clipQuery, foldKey, hiraganaToKatakana, sanitizeTerm, tokenize } from './normalize';
import { LANGUAGE_TOKENS, RARITY_TOKENS, type Modifier } from './modifiers';
import type { Resolution } from './types';

export interface NameColumns {
    name: string;
    english: string | null;
    /** e.g. 'game.eq.pokemon' or 'or(card_data->>game.eq.pokemon,card_data->>game.is.null)' */
    gameEqPokemon?: string;
    /** e.g. 'english_name.is.null' or 'or(card_data->>thaiName.is.null,card_data->>thaiName.eq.)' */
    englishIsNull?: string;
}

export const CATALOG_COLUMNS: NameColumns = {
    name: 'name',
    english: 'english_name',
    gameEqPokemon: 'game.eq.pokemon',
    englishIsNull: 'english_name.is.null',
};

/**
 * For the language='en' scope. No English row has english_name, and an ILIKE
 * on that column there only turns an index scan into a filter scan.
 */
export const CATALOG_COLUMNS_NO_ENGLISH: NameColumns = {
    name: 'name',
    english: null,
    gameEqPokemon: 'game.eq.pokemon',
};

/** Listing snapshots: card_data.thaiName holds the ENGLISH name of a ja/th card (historical naming). */
export const LISTING_COLUMNS: NameColumns = {
    name: 'card_data->>name',
    english: 'card_data->>thaiName',
    gameEqPokemon: 'or(card_data->>game.eq.pokemon,card_data->>game.is.null)',
    englishIsNull: 'or(card_data->>thaiName.is.null,card_data->>thaiName.eq.)',
};

/** Budget for the encoded `or=(...)` parameter. The URL itself fails at ~13.5 KB. */
export const PREDICATE_MAX_ENCODED = 6000;

/** What the predicate costs in the URL, measured the way the request encodes it. */
export function encodedPredicateLength(pred: string): number {
    return new URLSearchParams({ or: `(${pred})` }).toString().length;
}

// ── Terms ──

const FULLWIDTH_ASCII = /[！-～]/;
const UNSAFE_ANY_WIDTH = /[,()%*_\\"，（）％＊＿＼＂]/g;

// The same cap as the resolver's input, so a leg never searches text the
// resolver did not read.
function clip(s: string): string {
    return clipQuery(s).trim();
}

/**
 * The DB spellings of one term. sanitizeTerm width-folds, which is right for
 * typed queries (ｺｲｷﾝｸﾞ, ＰＩＫＡＣＨＵ) but wrong for the few names the
 * catalog prints with full-width punctuation (タイプ：ヌル, ポリゴンＺ), so a
 * term containing full-width ASCII also gets its as-written form, made safe
 * the same way.
 */
function termVariants(term: string | null | undefined): string[] {
    const out: string[] = [];
    const a = clip(sanitizeTerm(term));
    if (a) out.push(a);
    if (term && FULLWIDTH_ASCII.test(term)) {
        const b = clip(term.replace(UNSAFE_ANY_WIDTH, ' ').replace(/\s+/g, ' ').trim());
        if (b && !out.includes(b)) out.push(b);
    }
    return out;
}

/** A name-start pattern keeps its trailing space: 'M ' must not become 'M%'. */
function startsWithTerm(term: string): string {
    const s = term.replace(UNSAFE_ANY_WIDTH, ' ').replace(/\s+/g, ' ').replace(/^\s+/, '');
    return s.trim() ? s : '';
}

const contains = (col: string, t: string) => `${col}.ilike.%${t}%`;
const startsWith = (col: string, t: string) => `${col}.ilike.${t}%`;
const endsWith = (col: string, t: string) => `${col}.ilike.%${t}`;

/**
 * One- and two-letter Latin mechanics (V, ex, GX) also occur inside species
 * names: every Eevee contains a "v", every Toxapex an "ex". As a %V% leg the
 * requirement filtered nothing, and the unordered LIMIT then kept plain Eevees
 * and dropped real "Eevee V" prints. The catalog prints these mechanics last,
 * or just before an owner ("มิวทู ex ของแก๊งร็อกเกต"), so the legs are
 * anchored there: "Eevee V", "Charizard-GX", "พิคาชูV", "Mega Charizard X ex".
 */
function isShortMechanic(mod: Modifier, spelling: string): boolean {
    return mod.kind === 'suffix' && /^[A-Za-z]{1,2}$/.test(spelling);
}

// ── Tree ──

type Node = string | { op: 'and' | 'or'; items: Node[] };

function render(node: Node | null | undefined): string | null {
    if (!node) return null;
    if (typeof node === 'string') return node || null;
    const parts: string[] = [];
    for (const item of node.items) {
        const r = render(item);
        if (r && !parts.includes(r)) parts.push(r);
    }
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return `${node.op}(${parts.join(',')})`;
}

// ── Alternatives ──

const NON_NAME_WORDS = new Set(
    [...LANGUAGE_TOKENS.en, ...LANGUAGE_TOKENS.ja, ...LANGUAGE_TOKENS.th, ...RARITY_TOKENS].map(foldKey).filter(Boolean),
);

function literalAlternative(literal: string, cols: NameColumns): Node[] {
    const legs: Node[] = [];
    const terms = termVariants(literal);
    for (const t of terms) {
        legs.push(contains(cols.name, t));
        if (cols.english) legs.push(contains(cols.english, t));
    }
    // こいきんぐ: the catalog prints katakana.
    if (/[ぁ-ゖ]/.test(literal)) {
        for (const t of termVariants(hiraganaToKatakana(literal))) {
            if (!terms.includes(t)) legs.push(contains(cols.name, t));
        }
    }
    return legs;
}

/**
 * The words of a multi-word query, for "every word somewhere in the name":
 * "monkey d luffy" (printed Monkey.D.Luffy), "professors research"
 * (Professor's Research), "blue eyes white dragon".
 */
function andTokens(literal: string): string[] {
    const out: string[] = [];
    for (const tok of tokenize(literal)) {
        if (NON_NAME_WORDS.has(foldKey(tok))) continue;
        let s = tok.replace(/['’]s$/i, '');
        if (/^[a-z]{5,}$/i.test(s) && /s$/i.test(s) && !/ss$/i.test(s)) s = s.slice(0, -1);
        const v = clip(sanitizeTerm(s));
        if (v.length >= 2 && !out.includes(v)) out.push(v);
        if (out.length >= 5) break;
    }
    return out;
}

function tokenAndAlternative(literal: string, cols: NameColumns): Node | null {
    const words = andTokens(literal);
    // Needs two words, and one long enough for the trigram index to drive the arm.
    if (words.length < 2 || !words.some((w) => w.length >= 3)) return null;
    return {
        op: 'and',
        items: words.map((w) => ({
            op: 'or' as const,
            items: cols.english ? [contains(cols.name, w), contains(cols.english, w)] : [contains(cols.name, w)],
        })),
    };
}

interface Budget {
    enDbExtras: boolean;
    nativeMax: number;
    maxGroups: number;
    residual: boolean;
    group: boolean;
    tokenAnd: boolean;
}

function groupAlternative(res: Resolution, cols: NameColumns, b: Budget): Node | null {
    const speciesLegs: Node[] = [];
    for (const gm of res.groups.slice(0, b.maxGroups)) {
        const g = gm.group;
        const english = b.enDbExtras ? [g.en, ...g.enDb] : [g.en];
        for (const s of english) {
            for (const v of termVariants(s)) {
                speciesLegs.push(contains(cols.name, v));
                if (cols.english) speciesLegs.push(contains(cols.english, v));
            }
        }
        // Native names only for rows WITHOUT an English name: rows that have
        // one are already reached by the English legs, and unrestricted short
        // native names flood the fetch with other species (ปี is inside 112
        // Thai names, リザード inside every リザードン).
        for (const s of [...g.ja.slice(0, b.nativeMax), ...g.th.slice(0, b.nativeMax)]) {
            for (const v of termVariants(s)) {
                const leg = v.length >= 3 ? contains(cols.name, v) : startsWith(cols.name, v);
                speciesLegs.push(cols.englishIsNull ? { op: 'and', items: [cols.englishIsNull, leg] } : leg);
            }
        }
    }
    const species = render({ op: 'or', items: speciesLegs });
    if (!species) return null;

    const conj: Node[] = [];
    if (cols.gameEqPokemon) conj.push(cols.gameEqPokemon);
    conj.push(species);
    for (const mm of res.modifiers) {
        const m = mm.modifier;
        const legs: Node[] = [];
        for (const s of m.en) {
            for (const v of termVariants(s)) {
                for (const col of cols.english ? [cols.name, cols.english] : [cols.name]) {
                    if (isShortMechanic(m, v)) legs.push(endsWith(col, v), contains(col, `${v} `));
                    else legs.push(contains(col, v));
                }
            }
        }
        for (const s of [...m.ja, ...m.th]) {
            for (const v of termVariants(s)) legs.push(contains(cols.name, v));
        }
        for (const s of m.enStartsWith || []) {
            const v = startsWithTerm(s);
            if (!v) continue;
            legs.push(startsWith(cols.name, v));
            if (cols.english) legs.push(startsWith(cols.english, v));
        }
        conj.push({ op: 'or', items: legs });
    }
    if (b.residual) {
        for (const r of res.residual) {
            const legs: Node[] = [];
            for (const v of termVariants(r)) {
                legs.push(contains(cols.name, v));
                if (cols.english) legs.push(contains(cols.english, v));
            }
            conj.push({ op: 'or', items: legs });
        }
    }
    return { op: 'and', items: conj };
}

// Degradation ladder for the URL budget: shed alias spellings first, never a
// species' canonical English name, and keep the literal to the last.
const LADDER: Budget[] = [
    { enDbExtras: true, nativeMax: 3, maxGroups: 3, residual: true, group: true, tokenAnd: true },
    { enDbExtras: false, nativeMax: 3, maxGroups: 3, residual: true, group: true, tokenAnd: true },
    { enDbExtras: false, nativeMax: 2, maxGroups: 3, residual: true, group: true, tokenAnd: true },
    { enDbExtras: false, nativeMax: 2, maxGroups: 1, residual: true, group: true, tokenAnd: true },
    { enDbExtras: false, nativeMax: 1, maxGroups: 1, residual: true, group: true, tokenAnd: true },
    { enDbExtras: false, nativeMax: 1, maxGroups: 1, residual: false, group: true, tokenAnd: true },
    { enDbExtras: false, nativeMax: 1, maxGroups: 1, residual: false, group: false, tokenAnd: true },
    { enDbExtras: false, nativeMax: 1, maxGroups: 1, residual: false, group: false, tokenAnd: false },
];

/**
 * The name filter for `.or(...)`, or null when nothing searchable remains
 * (the caller must then skip the fetch: there is no safe "match nothing").
 * Pass literal '' to get only the species alternative (phase-2 fetches).
 */
export function buildNamePredicate(opts: {
    literal: string;
    /**
     * The query as typed when analyzeQuery took language/rarity words out of
     * `literal` (QueryAnalysis.fullText): searched as a literal too, so a card
     * whose name contains such a word ("Sir Hiss" for "sir hiss") is still found.
     */
    fullLiteral?: string;
    resolution?: Resolution | null;
    cols: NameColumns;
    includeResidual?: boolean;
}): string | null {
    const { cols } = opts;
    const literal = typeof opts.literal === 'string' ? opts.literal : '';
    const res = opts.resolution && opts.resolution.groups.length > 0 ? opts.resolution : null;
    const includeResidual = opts.includeResidual !== false;

    const literalLegs = literalAlternative(literal, cols);
    if (literal && typeof opts.fullLiteral === 'string' && opts.fullLiteral !== literal) {
        for (const leg of literalAlternative(opts.fullLiteral, cols)) if (!literalLegs.includes(leg)) literalLegs.push(leg);
    }
    let last: string | null = null;
    for (const step of LADDER) {
        const items: Array<Node | null> = [...literalLegs];
        if (!res && step.tokenAnd) items.push(tokenAndAlternative(literal, cols));
        if (res && step.group) items.push(groupAlternative(res, cols, { ...step, residual: step.residual && includeResidual }));
        const parts: string[] = [];
        for (const item of items) {
            const r = render(item);
            if (r && !parts.includes(r)) parts.push(r);
        }
        if (parts.length === 0) continue;
        const pred = parts.join(',');
        if (encodedPredicateLength(pred) <= PREDICATE_MAX_ENCODED) return pred;
        // Over budget: remember the leanest version so far, which still fits
        // the real URL limit (~13.5 KB) far more often than nothing does.
        last = pred;
    }
    return last;
}
