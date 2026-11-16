/**
 * Relevance of one catalog row to a search, as a band plus a score within it.
 * Results sort by band first, so no boost (popularity, listings) can lift a
 * weaker kind of match over a stronger one.
 *
 *   4  the row IS what was asked for: exact or root-exact on the literal
 *      ("Pikachu V" for "pikachu"), or exactly a resolved species plus the
 *      requested modifiers in any language ("ピカチュウex" for "pikachu ex")
 *   3  the row's name starts with the literal, or does once a leading owner
 *      comes off ("N's Zoroark ex" for "zoro")
 *   2  the row contains every word of the literal
 *   1  the row contains the literal, or a resolved species' name and every
 *      residual
 *   0  reached some other way
 *
 * A query that names two or more Pokémon side by side ("blastoise piplup",
 * "pikachu & zekrom") asks for the card that prints them together: a row
 * naming every one of them is band 4, and a print of just one of them drops
 * to band 3. Without that, "blastoise and piplup" listed 30 Blastoise and
 * Piplup prints and never the Tag Team card.
 *
 * Species names derived from the dictionary earn ONLY band 4 (or the weak
 * band 1), never prefix credit: リザード (Charmeleon) is a prefix of every
 * リザードン (Charizard), and prefix credit for it put Japanese Charizard
 * above every Charmeleon. Likewise "mew" is a prefix of "mewtwo", so Mewtwo
 * lands in band 3 and every Mew print in band 4.
 */

import { foldKey, type Script } from './normalize';
import { JOINING_WORDS, type Modifier } from './modifiers';
import { nameSlots, type MatchKind, type QueryAnalysis, type Resolution } from './types';

type StripPos = 'prefix' | 'suffix' | 'any';

interface ModStrip {
    id: string;
    /** Longest first, so "ของแก๊งร็อกเกต" goes before "แก๊งร็อกเกต" and "teamrockets" before "rockets". */
    spellings: Array<{ key: string; pos: StripPos }>;
}

/** The Pokémon a query named side by side, when there are two or more. */
interface Together {
    /** How many names the query put side by side. */
    slots: number;
    /** Every spelling of every one of them, longest first. */
    terms: Array<{ key: string; slot: number; w: number }>;
}

export interface ScoreContext {
    literalKey: string;
    /** The whole query's key when language/rarity words were taken out of the literal ("sirhiss"), else ''. */
    fullKey: string;
    /** Word keys of the literal, for band 2 (only when there are two or more). */
    literalTokens: string[];
    /**
     * The same without joining words, when that leaves two or more and differs:
     * "red and blue" is printed "Red & Blue". Scored just under literalTokens,
     * so "Sword of Fire and Ice" still leads for "fire and ice".
     */
    joinedTokens: string[];
    /** Catalog language that matches the query's script (kana/han -> ja, thai -> th). */
    sameScriptLang: 'ja' | 'th' | null;
    languagePref: Set<string>;
    rarityPref: Set<string>;
    /** Fold key of every resolved species name -> score weight (1, or 0.95 for guessed matches). */
    groupTerms: Map<string, number>;
    /** Set when the query named two or more Pokémon side by side. */
    together: Together | null;
    modStrips: ModStrip[];
    residualKeys: string[];
}

export interface ScoredName {
    band: 0 | 1 | 2 | 3 | 4;
    score: number;
}

// ── Root key ──

const TRAILING_PAREN = /\s*[(（][^()（）]*[)）]\s*$/;
// "LV.X" is also printed "LV. X" (Arceus LV. X).
const MECHANIC_SUFFIX = /(VMAX|VSTAR|V-UNION|V|ex|EX|GX|BREAK|LEGEND|LV\. ?X|δ|☆|◇)$/i;

/**
 * A printed name without its trailing parenthetical and mechanic suffix, as a
 * fold key: "Pikachu V", "พิคาชูV", "Magikarp (Master Ball Pattern)" and
 * "ジョルテオン（デルタ種）" lose the extra. The suffix only counts when it
 * is set apart by a space or hyphen or follows a non-Latin character, so
 * Toxapex, Calyrex, Smoliv and Dolliv keep their endings. (Written without a
 * regex lookbehind, which older iOS Safari cannot parse.)
 */
export function rootKey(rawName: string): string {
    let s = (rawName || '').trim();
    for (let i = 0; i < 2 && TRAILING_PAREN.test(s); i++) s = s.replace(TRAILING_PAREN, '').trim();
    for (let i = 0; i < 2; i++) {
        const m = MECHANIC_SUFFIX.exec(s);
        if (!m || m.index === 0) break;
        const before = s.slice(0, m.index);
        const prev = before[before.length - 1];
        if (/[\s-]/.test(prev)) s = before.replace(/[\s-]+$/, '');
        else if (!/[A-Za-z]/.test(prev)) s = before;
        else break;
        if (!s) break;
    }
    return foldKey(s);
}

// ── Context ──

function stripSpellings(mod: Modifier): Array<{ key: string; pos: StripPos }> {
    const base: StripPos = mod.kind === 'owner' ? 'any' : mod.kind;
    const out: Array<{ key: string; pos: StripPos }> = [];
    const add = (s: string, pos: StripPos) => {
        const key = foldKey(s);
        if (key && !out.some((o) => o.key === key && o.pos === pos)) out.push({ key, pos });
    };
    for (const s of mod.en) add(s, base);
    for (const s of mod.detect || []) add(s, base);
    for (const s of mod.enStartsWith || []) add(s, 'prefix');
    for (const s of mod.ja) add(s, mod.kind === 'owner' ? 'any' : mod.jaPosition ?? base);
    for (const s of mod.th) add(s, mod.kind === 'owner' ? 'any' : mod.thPosition ?? base);
    return out.sort((a, b) => b.key.length - a.key.length);
}

const GUESSED: MatchKind[] = ['late', 'prefix', 'loose', 'fuzzy'];

const JOIN_KEYS = new Set(Array.from(JOINING_WORDS, foldKey).filter(Boolean));

function scriptLang(script: Script): 'ja' | 'th' | null {
    if (script === 'kana' || script === 'han') return 'ja';
    if (script === 'thai') return 'th';
    return null;
}

function normLang(lang: string | null | undefined): string {
    const l = (lang || '').toLowerCase();
    return l === 'jp' ? 'ja' : l;
}

export function buildScoreContext(a: QueryAnalysis, res: Resolution | null): ScoreContext {
    const literalKey = a.nameKey || '';
    const literalTokens = a.tokens
        .map((t) => foldKey(t.replace(/['’]s$/i, '')))
        .filter((k) => k.length > 0);
    const withoutJoins = literalTokens.filter((k) => !JOIN_KEYS.has(k));
    const groupTerms = new Map<string, number>();
    const modStrips: ModStrip[] = [];
    const residualKeys: string[] = [];
    let together: Together | null = null;
    if (res && res.groups.length > 0) {
        const slots = nameSlots(res);
        if (slots.length >= 2) {
            const terms: Together['terms'] = [];
            slots.forEach((list, slot) => {
                for (const gm of list) {
                    const w = GUESSED.includes(gm.kind) ? 0.95 : 1;
                    const g = gm.group;
                    for (const s of [g.en, ...g.enDb, ...g.ja, ...g.th, ...g.aliases]) {
                        const key = foldKey(s);
                        if (key && !terms.some((t) => t.key === key && t.slot === slot)) terms.push({ key, slot, w });
                    }
                }
            });
            terms.sort((a, b) => b.key.length - a.key.length);
            together = { slots: slots.length, terms };
        }
        for (const gm of res.groups) {
            const w = GUESSED.includes(gm.kind) ? 0.95 : 1;
            const g = gm.group;
            for (const s of [g.en, ...g.enDb, ...g.ja, ...g.th, ...g.aliases]) {
                const k = foldKey(s);
                if (k && (groupTerms.get(k) ?? 0) < w) groupTerms.set(k, w);
            }
        }
        for (const mm of res.modifiers) modStrips.push({ id: mm.modifier.id, spellings: stripSpellings(mm.modifier) });
        for (const r of res.residual) {
            const k = foldKey(r);
            if (k && !residualKeys.includes(k)) residualKeys.push(k);
        }
    }
    return {
        literalKey,
        fullKey: a.fullKey && a.fullKey !== literalKey ? a.fullKey : '',
        literalTokens: literalTokens.length >= 2 ? literalTokens : [],
        joinedTokens: withoutJoins.length >= 2 && withoutJoins.length < literalTokens.length ? withoutJoins : [],
        sameScriptLang: scriptLang(a.script),
        languagePref: new Set(a.languagePref.map(normLang)),
        rarityPref: new Set(a.rarityPref.map((r) => foldKey(r))),
        groupTerms,
        together,
        modStrips,
        residualKeys,
    };
}

// ── Scoring ──

/**
 * Remove every requested modifier from a row key, each at the position its
 * language prints it; null when one of them is missing from the row (an
 * "ex" query must not count "Pikachu VMAX" as exact). Owners go first since
 * they can sit anywhere, including after a suffix (มิวทูex ของแก๊งร็อกเกต).
 */
function stripModifiers(key: string, mods: ModStrip[]): string | null {
    if (mods.length === 0) return key;
    let k = key;
    const pending = [...mods].sort((a, b) => {
        const ao = a.spellings.some((s) => s.pos === 'any') ? 0 : 1;
        const bo = b.spellings.some((s) => s.pos === 'any') ? 0 : 1;
        return ao - bo;
    });
    for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
        for (let i = 0; i < pending.length; ) {
            let stripped = false;
            for (const s of pending[i].spellings) {
                if (s.key.length >= k.length) continue;
                if (s.pos === 'prefix' && k.startsWith(s.key)) {
                    k = k.slice(s.key.length);
                    stripped = true;
                } else if (s.pos === 'suffix' && k.endsWith(s.key)) {
                    k = k.slice(0, k.length - s.key.length);
                    stripped = true;
                } else if (s.pos === 'any') {
                    const at = k.indexOf(s.key);
                    if (at >= 0) {
                        k = k.slice(0, at) + k.slice(at + s.key.length);
                        stripped = true;
                    }
                }
                if (stripped) break;
            }
            if (stripped) pending.splice(i, 1);
            else i++;
        }
    }
    return pending.length === 0 ? k : null;
}

const MECHANIC_KEYS = ['vunion', 'vstar', 'vmax', 'legend', 'break', 'delta', 'lvx', 'gx', 'ex', 'v'];

/**
 * A leading owner: "N's ", "Team Rocket's ", "Lt. Surge's ". The rest of such
 * a name ("Zoroark ex") gets prefix credit (band 3, just under a plain
 * prefix hit): as a mere "contains" match (band 1), a listed "N's Zoroark ex"
 * could never reach the as-you-type dropdown under 30 plain Zoroark prints for
 * "zoro". Never band 4: the plain print is what "zoroark" names.
 */
const OWNER_PREFIX = /^(?:[^\s'’]+\s+){0,2}[^\s'’]+['’]s\s+(?=\S)/;

/** A fold key without trailing mechanic suffixes (keys have no separators left to check). */
function stripMechanicKey(key: string): string {
    let k = key;
    for (let pass = 0; pass < 2; pass++) {
        const m = MECHANIC_KEYS.find((s) => k.length > s.length && k.endsWith(s));
        if (!m) break;
        k = k.slice(0, k.length - m.length);
    }
    return k;
}

/** "Misty's Magikarp" with residual "misty" -> "magikarp" (the possessive s goes too). */
function stripResiduals(key: string, residualKeys: string[]): string {
    let k = key;
    for (const r of residualKeys) {
        const withS = k.indexOf(`${r}s`);
        if (withS >= 0 && `${r}s`.length < k.length) {
            k = k.slice(0, withS) + k.slice(withS + r.length + 1);
            continue;
        }
        const at = k.indexOf(r);
        if (at >= 0 && r.length < k.length) k = k.slice(0, at) + k.slice(at + r.length);
    }
    return k;
}

/**
 * Whether a row key prints a name from every slot, each in its own stretch of
 * the text; `rest` is what the names leave over. Longest names first and a
 * matched stretch is cut out, so "Mewtwo" is not also the Mew of "mew mewtwo"
 * and only "Mewtwo & Mew-GX" names both. A two-character name (ピィ, ปี) must
 * start the key: inside a name it is part of some other word.
 */
function namesEverySlot(key: string, tg: Together): { w: number; rest: string } | null {
    let k = key;
    let w = 1;
    const found = new Set<number>();
    for (const t of tg.terms) {
        if (found.has(t.slot)) continue;
        const at = t.key.length < 3 ? (k.startsWith(t.key) ? 0 : -1) : k.indexOf(t.key);
        if (at < 0) continue;
        // '|' never occurs in a fold key, so the two halves cannot join into a name.
        k = `${k.slice(0, at)}|${k.slice(at + t.key.length)}`;
        found.add(t.slot);
        if (t.w < w) w = t.w;
    }
    return found.size === tg.slots ? { w, rest: k.replace(/\|/g, '') } : null;
}

/** True when nothing but mechanic suffixes is left ("gx", "legend", ""). */
function onlyMechanics(key: string): boolean {
    let k = key;
    for (let pass = 0; pass < 3 && k; pass++) {
        const m = MECHANIC_KEYS.find((s) => k.endsWith(s));
        if (!m) break;
        k = k.slice(0, k.length - m.length);
    }
    return k === '';
}

export function scoreName(
    row: { name?: string | null; english_name?: string | null; language?: string | null; rarity?: string | null },
    ctx: ScoreContext,
): ScoredName {
    let band: ScoredName['band'] = 0;
    let base = 25;
    const consider = (b: ScoredName['band'], s: number) => {
        if (b > band || (b === band && s > base)) {
            band = b;
            base = s;
        }
    };

    const fields: Array<{ key: string; root: string }> = [];
    const ownerless: Array<{ key: string; root: string }> = [];
    for (const raw of [row.name, row.english_name]) {
        if (!raw) continue;
        const key = foldKey(raw);
        if (key) fields.push({ key, root: rootKey(raw) });
        const owner = OWNER_PREFIX.exec(raw.trim());
        if (owner) {
            const rest = raw.trim().slice(owner[0].length);
            const restKey = foldKey(rest);
            if (restKey) ownerless.push({ key: restKey, root: rootKey(rest) });
        }
    }
    const lit = ctx.literalKey;
    const hasGroups = ctx.groupTerms.size > 0;
    const tg = ctx.together;
    // With several Pokémon named, a print of one of them is half the answer.
    const speciesBand: ScoredName['band'] = tg ? 3 : 4;
    const literalKeys = [lit, ctx.fullKey].filter(Boolean);

    for (const f of fields) {
        for (const lk of literalKeys) {
            if (f.key === lk) consider(4, 100);
            else if (f.root === lk) consider(4, 90);
            else if (f.key.startsWith(lk)) consider(3, 75);
            else if (f.root.startsWith(lk)) consider(3, 70);
            else if (f.key.includes(lk)) consider(1, 50);
        }
        if (ctx.literalTokens.length >= 2 && ctx.literalTokens.every((t) => f.key.includes(t))) consider(2, 60);
        else if (ctx.joinedTokens.length >= 2 && ctx.joinedTokens.every((t) => f.key.includes(t))) consider(2, 55);

        if (tg) {
            const stripped = stripModifiers(f.key, ctx.modStrips);
            const all = namesEverySlot(stripped ?? f.key, tg);
            if (all) {
                // Missing the requested mechanic ("pikachu zekrom ex" for
                // Pikachu & Zekrom-GX) is still the card that names them both.
                if (stripped === null) consider(4, 80 * all.w);
                // Exactly those Pokémon outranks a card with a third one on it
                // ("Dialga & Palkia LEGEND" over "Arceus & Dialga & Palkia-GX").
                else consider(4, (onlyMechanics(all.rest) ? 100 : 92) * all.w);
            }
        }

        if (hasGroups) {
            for (const [cand, candBase] of [[f.key, 100], [f.root, 90]] as Array<[string, number]>) {
                const stripped = stripModifiers(cand, ctx.modStrips);
                if (stripped === null) continue;
                const w = ctx.groupTerms.get(stripped);
                if (w) {
                    consider(speciesBand, candBase * w);
                    continue;
                }
                // Root-exact once the requested modifiers are out: an owner
                // printed after the mechanic leaves it mid-name for rootKey
                // (มิวทู ex ของแก๊งร็อกเกต). Only accepted when what remains is
                // the species, so Toxapex never loses its "ex".
                const bare = stripMechanicKey(stripped);
                const wBare = bare !== stripped ? ctx.groupTerms.get(bare) : undefined;
                if (wBare) {
                    consider(speciesBand, 90 * wBare);
                    continue;
                }
                if (ctx.residualKeys.length > 0) {
                    const w2 = ctx.groupTerms.get(stripMechanicKey(stripResiduals(stripped, ctx.residualKeys)));
                    if (w2) consider(speciesBand, 90 * w2);
                }
            }
        }
    }

    for (const f of ownerless) {
        for (const lk of literalKeys) {
            if (f.key === lk || f.root === lk) consider(3, 74);
            else if (f.key.startsWith(lk) || f.root.startsWith(lk)) consider(3, 72);
        }
    }

    // Weak credit: a species name plus every residual somewhere in the row
    // ("Misty's Magikarp" for "koiking"), never more than a literal contains.
    if (hasGroups && band < 1) {
        let w = 0;
        for (const [term, tw] of ctx.groupTerms) {
            if (tw > w && fields.some((f) => f.key.includes(term))) w = tw;
        }
        if (w > 0 && ctx.residualKeys.every((r) => fields.some((f) => f.key.includes(r)))) consider(1, 50 * w);
    }

    let score = base;
    const lang = normLang(row.language);
    if (ctx.sameScriptLang && lang === ctx.sameScriptLang) score += 15;
    // An explicit "jp"/"thai" in the query is a stated choice, so it has to
    // beat the same-script bonus plus a live listing (+15 +25).
    if (lang && ctx.languagePref.has(lang)) score += 50;
    if (ctx.rarityPref.size > 0 && row.rarity && ctx.rarityPref.has(foldKey(row.rarity))) score += 15;
    for (const r of ctx.residualKeys) {
        if (fields.some((f) => f.key.includes(r))) score += 10;
    }
    return { band, score };
}
