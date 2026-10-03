/**
 * In-memory name filtering for lists the client already holds (the vault and
 * the desktop collection): the same fold, cross-language names and modifier
 * handling as catalog search, without a round trip.
 *
 * Collections can hold thousands of cards and filter on every keystroke, so
 * card keys are computed once per item (prepareCardKeys, in a useMemo keyed on
 * the items) and the per-resolution term keys once per resolution.
 */

import { foldKey, tokenize } from './normalize';
import { MODIFIERS, type Modifier } from './modifiers';
import type { Resolution } from './types';

export interface CardKeys {
    name: string;
    /** The English name of a ja/th card (stored as `thaiName` for historical reasons). */
    thai: string;
    /** name / thaiName lower-cased as printed, for name-start patterns ("m charizard-ex"). */
    nameRaw: string;
    thaiRaw: string;
    /** Word keys of name and thaiName, for mechanic words that must stand alone ("v", "ex"). */
    words: string[];
    set: string;
    /** Folded part by part with the slash kept ("004/102"), so a number never matches across it. */
    number: string;
    /** The number's parts without leading zeros ("004/102" -> ["4", "102"]), for whole-number word matching. */
    numberParts: string[];
    /** name|thai|set|number, for "every word somewhere" matching. */
    all: string;
}

export interface QueryKeys {
    key: string;
    /** The query folded like CardKeys.number (slash kept), for the number field. */
    numberKey: string;
    tokens: string[];
}

function foldNumber(s: string | null | undefined): string {
    return String(s || '')
        .split('/')
        .map((p) => foldKey(p))
        .join('/');
}

function wordKeys(...texts: Array<string | null | undefined>): string[] {
    const out: string[] = [];
    for (const t of texts) {
        for (const w of tokenize(t || '')) {
            const k = foldKey(w);
            if (k && !out.includes(k)) out.push(k);
        }
    }
    return out;
}

export function prepareCardKeys(card: {
    name?: string | null;
    thaiName?: string | null;
    set?: { name?: string | null } | string | null;
    number?: string | null;
}): CardKeys {
    const name = foldKey(card?.name);
    const thai = foldKey(card?.thaiName);
    const setName = typeof card?.set === 'string' ? card.set : card?.set?.name;
    const set = foldKey(setName);
    const number = foldNumber(card?.number);
    const numberParts = String(card?.number || '')
        .split('/')
        .map((p) => p.trim().replace(/^0+(?=\d)/, '').toLowerCase())
        .filter(Boolean);
    return {
        name,
        thai,
        nameRaw: String(card?.name || '').toLowerCase().replace(/\s+/g, ' ').trim(),
        thaiRaw: String(card?.thaiName || '').toLowerCase().replace(/\s+/g, ' ').trim(),
        words: wordKeys(card?.name, card?.thaiName),
        set,
        number,
        numberParts,
        // '|' never occurs in a fold key, so a word cannot match across two fields.
        all: `${name}|${thai}|${set}|${number}`,
    };
}

export function prepareQueryKeys(query: string): QueryKeys {
    return {
        key: foldKey(query),
        numberKey: foldNumber(query),
        tokens: tokenize(query || '').map((t) => foldKey(t)).filter(Boolean),
    };
}

/**
 * Typed words that name a mechanic, form or owner ("v", "ex", "mega",
 * "alolan"). As a plain substring "v" is inside every Vulpix and Eevee and "ex"
 * inside Toxapex, so "vulpix v" showed every Vulpix; these must be a word of
 * the card's own name.
 */
const MODIFIER_WORDS = new Set(
    MODIFIERS.flatMap((m) => [...m.en, ...(m.detect || []), ...(m.enStartsWith || [])])
        .map((s) => foldKey(s))
        .filter((k) => /^[a-z]+$/.test(k)),
);

type ModPos = 'prefix' | 'suffix' | 'any' | 'start';

interface ModSpelling {
    key: string;
    pos: ModPos;
}

interface ResolutionKeys {
    terms: string[];
    /** One list of spellings per modifier; a card needs one spelling from each, in its place. */
    modifiers: ModSpelling[][];
    /** Leftover name fragments ("misty"); a card needs every one somewhere. */
    residual: string[];
}

const resolutionCache = new WeakMap<Resolution, ResolutionKeys>();

/** Where each language prints a modifier, as in score.ts stripModifiers. */
function modifierSpellings(m: Modifier): ModSpelling[] {
    const out: ModSpelling[] = [];
    const add = (s: string, pos: ModPos) => {
        const key = foldKey(s);
        if (key && !out.some((o) => o.key === key && o.pos === pos)) out.push({ key, pos });
    };
    const base: ModPos = m.kind === 'owner' ? 'any' : m.kind;
    for (const s of m.en) add(s, base);
    for (const s of m.ja) add(s, m.kind === 'owner' ? 'any' : m.jaPosition ?? base);
    for (const s of m.th) add(s, m.kind === 'owner' ? 'any' : m.thPosition ?? base);
    // "M Charizard-EX": checked on the printed name, where "M " is a word.
    for (const s of m.enStartsWith || []) {
        const key = s.toLowerCase();
        if (key.trim() && !out.some((o) => o.key === key && o.pos === 'start')) out.push({ key, pos: 'start' });
    }
    return out;
}

function resolutionKeys(res: Resolution): ResolutionKeys {
    const cached = resolutionCache.get(res);
    if (cached) return cached;
    const terms: string[] = [];
    for (const gm of res.groups) {
        const g = gm.group;
        for (const s of [g.en, ...g.enDb, ...g.ja, ...g.th, ...g.aliases, ...g.late]) {
            const k = foldKey(s);
            if (k && !terms.includes(k)) terms.push(k);
        }
    }
    const modifiers = res.modifiers.map((mm) => modifierSpellings(mm.modifier)).filter((list) => list.length > 0);
    const residual = res.residual.map((r) => foldKey(r)).filter(Boolean);
    const out = { terms, modifiers, residual };
    resolutionCache.set(res, out);
    return out;
}

/** Where a species term sits in a field key, or -1. Two-character names must start the field. */
function termAt(field: string, term: string): number {
    if (term.length < 3) return field.startsWith(term) ? 0 : -1;
    return field.indexOf(term);
}

/**
 * Whether one modifier is printed in its place next to the species: a suffix
 * after the name ("Eevee V", "พิคาชูV"), a prefix before it ("Alolan Vulpix",
 * "アローラロコン"), an owner anywhere. Position matters because the
 * spellings occur inside names: "v" in Eevee, "m" in Mewtwo, "ex" in Toxapex.
 */
function modifierInPlace(keys: CardKeys, terms: string[], spellings: ModSpelling[]): boolean {
    const fields: Array<[string, string]> = [[keys.name, keys.nameRaw], [keys.thai, keys.thaiRaw]];
    for (const [field, raw] of fields) {
        if (!field) continue;
        for (const t of terms) {
            const at = termAt(field, t);
            if (at < 0) continue;
            for (const s of spellings) {
                if (s.pos === 'any' && field.includes(s.key)) return true;
                if (s.pos === 'suffix' && field.indexOf(s.key, at + t.length) >= 0) return true;
                if (s.pos === 'prefix' && at >= s.key.length && field.lastIndexOf(s.key, at - s.key.length) >= 0) return true;
                if (s.pos === 'start' && at > 0 && raw.startsWith(s.key)) return true;
            }
        }
    }
    return false;
}

/**
 * One typed word against a card. A bare number must be a whole part of the
 * card number ("base 4" is Base Set #4, not #14 and #40-49) or appear in the
 * name or set ("151", "Porygon2"); a mechanic or form word must be a word of
 * the name; any other word may sit anywhere.
 */
function tokenHit(keys: CardKeys, token: string): boolean {
    if (/^\d+$/.test(token)) {
        const n = token.replace(/^0+(?=\d)/, '');
        return keys.numberParts.includes(n) || keys.name.includes(token) || keys.thai.includes(token) || keys.set.includes(token);
    }
    if (MODIFIER_WORDS.has(token)) return keys.words.includes(token);
    return keys.all.includes(token);
}

/**
 * Whether a card matches the filter text: the literal text in any field,
 * every typed word somewhere in the card, or (when the query resolved to a
 * species) any of that species' names in any language plus every requested
 * modifier, leftover word and collector number. A two-character name (ピィ,
 * ปี) must start the card name rather than appear anywhere, or "Cleffa" would
 * also match every ปี-containing name.
 */
export function cardMatchesQuery(keys: CardKeys, q: QueryKeys, res: Resolution | null): boolean {
    if (!q.key) return true;
    if (keys.name.includes(q.key) || keys.thai.includes(q.key) || keys.set.includes(q.key) || keys.number.includes(q.numberKey)) {
        return true;
    }
    if (q.tokens.length >= 2 && q.tokens.every((t) => tokenHit(keys, t))) return true;
    if (!res || res.groups.length === 0) return false;

    const rk = resolutionKeys(res);
    if (!rk.terms.some((t) => termAt(keys.name, t) >= 0 || termAt(keys.thai, t) >= 0)) return false;
    if (!rk.modifiers.every((spellings) => modifierInPlace(keys, rk.terms, spellings))) return false;
    // Resolution leaves digits out of the species, so a typed collector
    // number ("charizard ex 125") still narrows here, as in catalog search.
    if (!q.tokens.every((t) => !/^\d+$/.test(t) || tokenHit(keys, t))) return false;
    // Residuals are required, as in the catalog predicate: "misty's magikarp"
    // is Misty's Magikarp, not every Magikarp, and a half-typed Thai name
    // ("โดโดเกซั" on the way to Kingambit) must not show every Doduo.
    return rk.residual.every((r) => tokenHit(keys, r));
}
