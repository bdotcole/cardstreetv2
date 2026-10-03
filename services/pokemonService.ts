/**
 * Pokemon Service - Supabase Implementation
 * 
 * This service queries Pokemon card and set data from Supabase
 * instead of the external Pokemon TCG API for better performance.
 */

import { createClient } from '@/lib/supabase/client';
import { geminiService, SearchIntent } from './geminiService';
import { Card } from '../types';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { GAMES } from '@/lib/games';
import { getLoadedSearchDictionary, loadSearchDictionary, type SearchDictionary } from '@/lib/search/dictionary';
import { analyzeQuery, isStopword, resolveExact, resolveLoose } from '@/lib/search/resolve';
import {
    buildNamePredicate,
    CATALOG_COLUMNS,
    CATALOG_COLUMNS_NO_ENGLISH,
    type NameColumns,
} from '@/lib/search/postgrestSearch';
import { buildScoreContext, scoreName, type ScoreContext } from '@/lib/search/score';
import { clipQuery, foldKey, hiraganaToKatakana, sanitizeTerm, widthFold } from '@/lib/search/normalize';
import type { QueryAnalysis, Resolution } from '@/lib/search/types';
import { markFailedResult } from '@/lib/search/failedResult';

// Games whose catalog spans more than one language (pokemon en/ja/th, yugioh
// and onepiece en/ja). In all-games search mode, single-language catalogs bypass
// the UI-language filter — their rows only exist in the game's default language.
// A game missing a language it actually stocks would wrongly bypass that filter,
// so lib/games.ts must declare every language present in pokemon_cards.
const multiLanguageGameIds = GAMES.filter(g => g.languages.length > 1).map(g => g.id);

// Client-side search cache
const searchIndex = new Map<string, Card[]>();
const setsCache = new Map<string, { data: ApiSet[], totalCount: number }>();
// language/game say where a set's cards live, so a set match can size and
// scope its fetches (searchCards).
interface SetRow { id: string; name: string; language?: string | null; game?: string | null }
let allSetsDbCache: SetRow[] | null = null;
let allSetsInflight: Promise<SetRow[]> | null = null;

// search_cards_fuzzy_v2 (pg_trgm typo matching) ships in an optional
// migration (20261003_search_trigram_fuzzy.sql). Until it is applied PostgREST
// answers 404 PGRST202, so the first such answer switches the call off for the
// rest of the session. Any other failure (a timeout, a 5xx) leaves it on.
let fuzzyRpcAvailable = true;

// What the search pool needs from each row. raw_data is tens of KB per row;
// the mapper only reads its tcgplayer slice (price fallback).
const SEARCH_COLUMNS = `
    id, name, english_name, set_id, number, supertype, subtypes,
    rarity, hp, types, game, image_small, image_large, language,
    tcgplayer_url, tcgplayer:raw_data->tcgplayer,
    market_values(condition, language, market_avg, currency, last_updated)`;
const SEARCH_SELECT = `${SEARCH_COLUMNS}, pokemon_sets(name, printed_total, total)`;
// "162/130": the printed total lives on the set, so the embed must filter.
const SEARCH_SELECT_SET_TOTAL = `${SEARCH_COLUMNS}, pokemon_sets!inner(name, printed_total, total)`;

// Boost lookups (popularity, live listings) go out in id chunks: a merged
// pool can pass 300 ids, and ~150 ids already make a 3-6 KB URL.
const BOOST_CHUNK = 150;

type CatalogLang = 'en' | 'ja' | 'th';

// The catalog stores Japanese as 'ja'; the game config, card requests and the
// scanner say 'jp'. Anything else (the scanner's 'other', an empty string) is
// no language filter at all rather than a filter that matches nothing.
function catalogLanguage(language: string | null | undefined): CatalogLang | undefined {
    const l = (language || '').toLowerCase();
    if (l === 'jp' || l === 'ja') return 'ja';
    if (l === 'en' || l === 'th') return l;
    return undefined;
}

interface SetMatcher {
    id: string;
    nameLower: string;
    idLower: string;
}

let setMatchers: { source: { id: string, name: string }[]; list: SetMatcher[] } | null = null;

// Sorted once per set list, longest names first so "Scarlet & Violet 151"
// wins over "151".
function getSetMatchers(sets: { id: string, name: string }[]): SetMatcher[] {
    if (setMatchers && setMatchers.source === sets) return setMatchers.list;
    const list: SetMatcher[] = [];
    for (const set of [...sets].sort((a, b) => (b.name || '').length - (a.name || '').length)) {
        if (!set?.id || !set.name) continue;
        list.push({ id: set.id, nameLower: set.name.toLowerCase(), idLower: set.id.toLowerCase() });
    }
    setMatchers = { source: sets, list };
    return list;
}

// Word characters for the two kinds of boundary. A set id follows \b rules
// ([A-Za-z0-9_]); a set name needs a Unicode letter/number boundary, since a
// Thai set name could never match under \b.
const ID_WORD_CHAR = /[A-Za-z0-9_]/;
const NAME_WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Index of `needle` in `hay` where `bounded(before, after)` accepts the
 * characters around it, or -1. Plain indexOf instead of one RegExp per set:
 * V8 compiles a regex separately for one-byte and two-byte subjects, so ~2,700
 * set regexes cost every search 100+ ms and the first Thai or Japanese query
 * of a session ~1.3 s of main-thread time just compiling them.
 */
function findBounded(hay: string, needle: string, bounded: (before: string, after: string) => boolean): number {
    if (!needle) return -1;
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
        if (bounded(hay[at - 1] ?? '', hay[at + needle.length] ?? '')) return at;
    }
    return -1;
}

/**
 * The set a query names, if any, and what is left of the query without it.
 * `exact` means the whole query IS a set name or id, which is ambiguous with
 * a card name more often than it seems ("Arceus", "Deoxys", "Detective
 * Pikachu" are both), so the caller searches names too.
 */
function detectSet(query: string, sets: { id: string, name: string }[]): { ids: string[]; rest: string; exact: boolean } {
    const lower = query.toLowerCase();
    const cut = (at: number, len: number) => `${lower.slice(0, at)} ${lower.slice(at + len)}`.replace(/\s+/g, ' ').trim();
    const isIdChar = (ch: string) => !!ch && ID_WORD_CHAR.test(ch);
    const isNameChar = (ch: string) => !!ch && NAME_WORD_CHAR.test(ch);
    for (const s of getSetMatchers(sets)) {
        if (lower === s.nameLower || lower === s.idLower) return { ids: [s.id], rest: '', exact: true };
        // \b semantics on both ends, whatever characters the id starts or ends with.
        const idAt = findBounded(lower, s.idLower, (before, after) =>
            isIdChar(before) !== isIdChar(s.idLower[0]) && isIdChar(s.idLower[s.idLower.length - 1]) !== isIdChar(after));
        if (idAt >= 0) return { ids: [s.id], rest: cut(idAt, s.idLower.length), exact: false };
        const nameAt = findBounded(lower, s.nameLower, (before, after) => !isNameChar(before) && !isNameChar(after));
        if (nameAt >= 0) return { ids: [s.id], rest: cut(nameAt, s.nameLower.length), exact: false };
    }
    return { ids: [], rest: query, exact: false };
}

// Sets whose name has a word starting with the query ("evolving" -> Evolving
// Skies, "surging" -> Surging Sparks), from the set list already in memory:
// this used to be a serial round trip on every keystroke-search. Word starts
// only: "evee" is a typo of Eevee, not a hit inside "Eevee Heroes".
function partialSetIds(cleanQuery: string, sets: { id: string, name: string }[]): string[] {
    const out: string[] = [];
    const wordStart = (before: string) => !before || !NAME_WORD_CHAR.test(before);
    for (const s of sets) {
        if (s?.name && findBounded(s.name.toLowerCase(), cleanQuery, wordStart) >= 0) {
            out.push(s.id);
            if (out.length >= 20) break;
        }
    }
    return out;
}

async function loadAllSets(supabase: ReturnType<typeof createClient>): Promise<SetRow[]> {
    if (allSetsDbCache) return allSetsDbCache;
    if (!allSetsInflight) {
        allSetsInflight = (async () => {
            // Page past PostgREST's 1,000-row default: the table holds ~1,364
            // sets, and an unpaged fetch silently dropped an arbitrary ~364 of
            // them from set-code matching for the whole session.
            const all: SetRow[] = [];
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase.from('pokemon_sets').select('id, name, language, game').order('id').range(from, from + 999);
                if (error) throw error;
                all.push(...(data || []));
                if (!data || data.length < 1000) break;
            }
            allSetsDbCache = all;
            return all;
        })().catch((err) => {
            // Search goes on without set matching this time; the next search
            // retries instead of living with a half-loaded list all session.
            console.warn('[searchCards] set list failed to load:', err);
            allSetsInflight = null;
            return [];
        });
    }
    return allSetsInflight;
}

/**
 * The English name a native-script hit stands for, without the parts that
 * make it one printing: "Vulpix (Master Ball Pattern)" -> "Vulpix",
 * "Pikachu ex" -> "Pikachu", "Team Rocket's Mewtwo ex" -> "Mewtwo". An owner
 * prefix only goes when what remains is a species the dictionary knows, so
 * "Professor's Research" and "Boss's Orders" stay whole. Returns '' when
 * nothing searchable is left.
 */
function baseEnglishName(raw: string, dict: SearchDictionary | null): string {
    let s = (raw || '').trim();
    for (let i = 0; i < 2; i++) s = s.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
    for (let i = 0; i < 2; i++) {
        const next = s.replace(/[\s-]+(VMAX|VSTAR|V-UNION|V|ex|EX|GX|BREAK|LEGEND|LV\.X|δ|☆|◇)$/, '').trim();
        if (!next || next === s) break;
        s = next;
    }
    const owner = s.match(/^(?:Team\s+)?[^\s']+['’]s\s+(.+)$/i);
    if (owner) {
        const rest = owner[1].trim();
        if (/^(?:Team\s+)?Rocket['’]s\s/i.test(s) || (dict && dict.exact.has(foldKey(rest)))) s = rest;
    }
    const term = sanitizeTerm(s);
    return term.length >= 2 ? term : '';
}

// Legs of the pre-dictionary search, for the runtime guard: if a generated
// predicate ever makes PostgREST reject the request, the search still runs.
function legacyNamePredicate(text: string, cols: NameColumns): string | null {
    const t = sanitizeTerm(text);
    if (!t) return null;
    return cols.english ? `${cols.name}.ilike.%${t}%,${cols.english}.ilike.%${t}%` : `${cols.name}.ilike.%${t}%`;
}

const NON_LATIN_SCRIPT = /[฀-๿぀-ヿㇰ-ㇿ㐀-䶿一-鿿가-힯ｦ-ﾟ]/;

// Split a search query into a name part and an optional collector-number filter.
// Recognizes a standalone numeric token combined with a name — "Mewtwo 51",
// "Charizard 4/102", "Pikachu #25", "Bulbasaur 001" — so the search can narrow
// by number instead of matching the digits as literal name text (which returns
// nothing, since no card is *named* "Mewtwo 51"). Returns the PostgREST or-string
// for the number, or null when the query carries no collector number.
//
// The DB stores numbers in several shapes for the same card ("51" vs "051",
// "3" vs "003", and "51/198" with the printed total), so we emit the as-typed,
// zero-stripped, and zero-padded forms, each with an exact leg and an "n/total"
// prefix leg. Mirrors the number-matching pattern in scannerService.
function parseNameAndNumber(query: string): { name: string; numberOr: string | null; numberVariants: string[] } {
    const raw = (query || '').trim();
    if (!raw) return { name: '', numberOr: null, numberVariants: [] };
    const tokens = raw.split(/\s+/);
    // Collector numbers usually trail the name; scan from the end for the first
    // token that is purely a number (digits, optional "/total", optional #).
    let numIdx = -1;
    let numerator = '';
    for (let i = tokens.length - 1; i >= 0; i--) {
        const m = tokens[i].match(/^#?(\d{1,4})(?:\/\d{1,5})?$/);
        if (m) { numIdx = i; numerator = m[1]; break; }
    }
    if (numIdx === -1) return { name: raw, numberOr: null, numberVariants: [] };

    const name = tokens.filter((_, i) => i !== numIdx).join(' ').trim();
    const variants = numberVariants(numerator);
    const legs = variants.flatMap(v => [`number.eq.${v}`, `number.ilike.${v}/%`]);
    return { name, numberOr: legs.join(','), numberVariants: variants };
}

function numberVariants(numerator: string): string[] {
    const stripped = numerator.replace(/^0+/, '') || '0';
    return Array.from(new Set([
        numerator, stripped, stripped.padStart(2, '0'), stripped.padStart(3, '0'),
    ]));
}

// The same test as the number legs above, for rows that did not come through
// them (the typo RPC returns rows of every number).
function rowMatchesNumber(rowNumber: string | null | undefined, variants: string[]): boolean {
    const n = (rowNumber || '').toLowerCase();
    return variants.some(v => n === v || n.startsWith(`${v}/`));
}

export interface ApiSet {
    id: string;
    name: string;
    series: string;
    printedTotal: number;
    total: number;
    releaseDate: string;
    updatedAt: string;
    images: {
        symbol: string;
        logo: string;
    };
}

export interface SealedProduct {
    id: string;
    name: string;
    productType: string | null;
    setId: string | null;
    // Display name of the set the product belongs to (already run through the
    // display-alias conventions); null when unresolvable (cross-set bundles).
    setName?: string | null;
    game?: string;
    language?: string;
    imageUrl: string | null;
    price: number | null;       // THB (base); multiply by display exchangeRate
    prices: { sealed: number | null; cib: number | null; loose: number | null };
    currency: string;
    // 'market' = PriceCharting; 'estimate' = Thai, derived from the JP twin's market;
    // 'srp' = Thai real-world retail (no JP twin to derive from)
    priceType?: 'market' | 'srp' | 'estimate';
    lastUpdated?: string;
}

export const pokemonService = {
    async fetchSets(
        language: 'en' | 'jp' | 'th' | 'pokemon-en' | 'pokemon-jp' | 'pokemon-th' = 'en',
        page: number = 1,
        pageSize: number = 15,
        game: string = 'pokemon'
    ): Promise<{ data: ApiSet[], totalCount: number }> {
        const cacheKey = `sets-${game}-${language}-${page}-${pageSize}`;
        if (setsCache.has(cacheKey)) {
            return setsCache.get(cacheKey)!;
        }

        try {
            const response = await fetch(`/api/sets?game=${game}&language=${language}&page=${page}&pageSize=${pageSize}`);
            if (!response.ok) {
                console.error('Failed to fetch sets from Edge API:', response.statusText);
                return { data: [], totalCount: 0 };
            }
            const result = await response.json();

            setsCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error("Failed to fetch sets from Edge API:", error);
            return { data: [], totalCount: 0 };
        }
    },

    async fetchCardsBySet(setId: string, language?: 'en' | 'jp' | 'th', game: string = 'pokemon') {
        try {
            console.log('[fetchCardsBySet] Querying via Edge API for set_id:', setId, 'language:', language, 'game:', game);

            const params = new URLSearchParams({ game });
            if (language) params.set('language', language);
            const response = await fetch(`/api/sets/${setId}/cards?${params.toString()}`);
            if (!response.ok) {
                console.error('Failed to fetch cards from Edge API:', response.statusText);
                return [];
            }

            const filteredCards = await response.json();

            return filteredCards.map(c => this.mapSupabaseCardToInternal(c));
        } catch (error) {
            console.error("Failed to fetch cards from Supabase:", error);
            return [];
        }
    },

    async findCardByMetadata(name: string, setHint: string, numberStr: string, languageHint: string = 'en', game?: string): Promise<Card[]> {
        try {
            const supabase = createClient();

            // Clean inputs for resilient ILIKE matching
            const cleanNumber = (numberStr || '').split('/')[0].replace(/[^a-zA-Z0-9]/g, '').trim(); 
            const cleanName = (name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim();
            const cleanSet = (setHint || '').replace(/[^a-zA-Z0-9]/g, '').trim();

            // Explicit columns: raw_data is tens of KB per row; the mapper only
            // needs its tcgplayer slice (price fallback).
            const baseSelect = 'id, name, english_name, set_id, number, rarity, game, image_small, image_large, language, tcgplayer_url, tcgplayer:raw_data->tcgplayer, market_values(condition, language, market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)';
            const nameSearch = `name.ilike.%${cleanName}%,english_name.ilike.%${cleanName}%`;

            // TIER 1: The "Perfect" Strict Match (Name + Number + Set + Language)
            if (cleanSet && cleanNumber) {
                let strictQuery = supabase.from('pokemon_cards').select(baseSelect)
                    .or(nameSearch)
                    .or(`number.eq.${cleanNumber},number.ilike.${cleanNumber}/%`)
                    .ilike('set_id', `%${cleanSet}%`);
                if (languageHint && languageHint !== 'other') strictQuery = strictQuery.eq('language', languageHint);
                if (game) strictQuery = strictQuery.eq('game', game);

                const { data: cards, error } = await strictQuery.limit(5);
                if (cards && cards.length > 0) return cards.map(c => this.mapSupabaseCardToInternal(c));
            }

            // TIER 2: Missing/Hallucinated Set Code (Name + Number + Language)
            if (cleanNumber) {
                let numQuery = supabase.from('pokemon_cards').select(baseSelect)
                    .or(nameSearch)
                    .or(`number.eq.${cleanNumber},number.ilike.${cleanNumber}/%`);
                if (languageHint && languageHint !== 'other') numQuery = numQuery.eq('language', languageHint);
                if (game) numQuery = numQuery.eq('game', game);

                const { data: fallbackCards } = await numQuery.limit(5);
                if (fallbackCards && fallbackCards.length > 0) return fallbackCards.map(c => this.mapSupabaseCardToInternal(c));
            }

            // TIER 3: Missing/Hallucinated Number (Name + Set Code + Language)
            if (cleanSet) {
                let setQuery = supabase.from('pokemon_cards').select(baseSelect).or(nameSearch).ilike('set_id', `%${cleanSet}%`);
                if (languageHint && languageHint !== 'other') setQuery = setQuery.eq('language', languageHint);
                if (game) setQuery = setQuery.eq('game', game);

                const { data: setFallback } = await setQuery.limit(5);
                if (setFallback && setFallback.length > 0) return setFallback.map(c => this.mapSupabaseCardToInternal(c));
            }

            // TIER 4: Absolute Broadest Fallback (Name Only, cross-language)
            let broadQuery = supabase.from('pokemon_cards').select(baseSelect).or(nameSearch);
            if (game) broadQuery = broadQuery.eq('game', game);
            const { data: broadFallback, error } = await broadQuery.limit(5);

            if (error) {
                console.error('Supabase error searching cards:', error);
                return [];
            }

            return (broadFallback || []).map(c => this.mapSupabaseCardToInternal(c));
        } catch (error) {
            console.error("Metadata match failed:", error);
            return [];
        }
    },

    /**
     * Candidates for the card-request "did you mean" panel.
     *
     * Users land on the request modal precisely because the name they typed
     * failed to match (misspellings, Thai vowel variants, missing V/VSTAR
     * suffixes) — so unlike findCardByMetadata, a number-bearing lookup must
     * NOT require a name match. The collector number + language narrow the
     * catalog deterministically; the typed name only boosts ranking (bigram
     * similarity, so one-character Thai spelling variants still rank first).
     */
    async findRequestCandidates(
        name: string,
        numberStr: string,
        language: string,
        game: string = 'pokemon',
    ): Promise<Card[]> {
        try {
            const supabase = createClient();
            // The catalog stores Japanese cards as 'ja'; the game config (and
            // card_requests) use 'jp'. Map before filtering.
            const dbLang = language === 'jp' ? 'ja' : language;
            const baseSelect = 'id, name, english_name, set_id, number, rarity, game, image_small, image_large, language, tcgplayer_url, tcgplayer:raw_data->tcgplayer, market_values(condition, language, market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)';

            const cleanName = (name || '').trim();
            // "049/067" -> numerator "049" + printed total "067"; keep letters
            // for promo numbering (e.g. "SV-P 123").
            const numerator = (numberStr || '').split('/')[0].replace(/[^0-9A-Za-z]/g, '');
            const printedTotal = parseInt((numberStr || '').split('/')[1] || '', 10) || null;

            let rows: any[] | null = null;
            // Name ranking context for the name-only fallback; set there.
            let nameCtx: ScoreContext | null = null;
            if (numerator) {
                // Number formats vary per catalog era ("049", "049/067",
                // "101/098") — match numerator-equal and numerator-prefixed,
                // in raw / unpadded / 3-digit-padded spellings.
                const unpadded = numerator.replace(/^0+(?=\d)/, '');
                const padded = /^\d+$/.test(unpadded) ? unpadded.padStart(3, '0') : unpadded;
                const variants = [...new Set([numerator, unpadded, padded])];
                const numOr = variants.flatMap((v) => [`number.eq.${v}`, `number.ilike.${v}/%`]).join(',');
                let q = supabase.from('pokemon_cards').select(baseSelect).or(numOr).eq('game', game);
                if (dbLang) q = q.eq('language', dbLang);
                // A popular collector number recurs across every set of the
                // era (30+ rows for a Thai "049"), and rows come back in
                // arbitrary order — fetch a wide pool so ranking sees the
                // right card, then trim to 5 below.
                ({ data: rows } = await q.limit(80));
            }
            if ((!rows || rows.length === 0) && cleanName.length >= 2) {
                // No number (or no number hit): the typed name, or the species
                // it names in any language or spelling. Users land here right
                // after a search failed, so typo guesses (resolveLoose) are
                // fair game when no exact name resolved.
                const analysis = analyzeQuery(cleanName);
                let resolution: Resolution | null = null;
                if (game === 'pokemon') {
                    const dict = await loadSearchDictionary();
                    if (dict && analysis.nameKey) {
                        resolution = resolveExact(dict, analysis);
                        if (resolution.groups.length === 0) resolution = resolveLoose(dict, analysis);
                        if (resolution.groups.length === 0) resolution = null;
                    }
                }
                const pred = buildNamePredicate({
                    literal: analysis.nameText,
                    fullLiteral: analysis.fullText,
                    resolution,
                    cols: dbLang === 'en' ? CATALOG_COLUMNS_NO_ENGLISH : CATALOG_COLUMNS,
                });
                if (pred) {
                    let q = supabase
                        .from('pokemon_cards')
                        .select(baseSelect)
                        .or(pred)
                        .eq('game', game);
                    if (dbLang) q = q.eq('language', dbLang);
                    // Wider than the 5 shown: species legs match every print,
                    // in arbitrary order, and ranking needs the exact ones.
                    ({ data: rows } = await q.limit(20));
                    nameCtx = buildScoreContext(analysis, resolution);
                }
            }
            if (!rows || rows.length === 0) return [];

            // Rank: name similarity (character-bigram Dice — language-agnostic,
            // tolerant of one-character variants) + a bonus when the printed
            // total in the typed number matches the candidate's set/number.
            const bigrams = (s: string) => {
                const t = s.toLowerCase().replace(/\s+/g, '');
                const out = new Map<string, number>();
                for (let i = 0; i < t.length - 1; i++) {
                    const b = t.slice(i, i + 2);
                    out.set(b, (out.get(b) || 0) + 1);
                }
                return out;
            };
            const dice = (a: string, b: string) => {
                if (!a || !b) return 0;
                const ba = bigrams(a), bb = bigrams(b);
                let overlap = 0, total = 0;
                ba.forEach((n, g) => { overlap += Math.min(n, bb.get(g) || 0); total += n; });
                bb.forEach((n) => { total += n; });
                return total ? (2 * overlap) / total : 0;
            };
            const scored = rows.map((r) => {
                const sim = cleanName
                    ? Math.max(dice(cleanName, r.name || ''), dice(cleanName, r.english_name || ''))
                    : 0;
                const totalBonus = printedTotal
                    ? ((r.number || '').includes(`/${String(printedTotal).padStart(3, '0')}`)
                        || (r.number || '').endsWith(`/${printedTotal}`)
                        || r.pokemon_sets?.printed_total === printedTotal
                        ? 0.5 : 0)
                    : 0;
                // Name-only fallback: the resolved species itself ("Magikarp"
                // for "koiking") outranks prints that merely share bigrams.
                const band = nameCtx ? scoreName(r, nameCtx).band : 0;
                const nameBonus = band >= 4 ? 1 : band >= 1 ? 0.25 : 0;
                return { r, score: 2 * sim + totalBonus + nameBonus };
            });
            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, 5).map(({ r }) => this.mapSupabaseCardToInternal(r));
        } catch (error) {
            console.error('findRequestCandidates failed:', error);
            return [];
        }
    },

    /**
     * Catalog search behind every search box (Explore, the desktop nav, the
     * marketplaces' catalog fallback, Add Card, the scanner's name fallback).
     *
     * Each step runs only when the previous one left a reason to:
     *   1. a set code / set name and a collector number come off the query
     *   2. phase 1, per catalog language: the literal text OR the species the
     *      name dictionary knows it as (Magikarp = コイキング = คอยคิง)
     *   3. nothing found: drop the number/set, then leftover words, then the
     *      modifiers ("giratina origin" when no Origin Forme card exists)
     *   4. phase 2, only when no row even starts with the query: typo, romaji
     *      and sound-alike resolution, plus the pg_trgm RPC
     *   5. a non-Latin query the dictionary could not place borrows the
     *      English name of its best hits (the older DB alias pass)
     * Rows rank by match band first (exact > prefix > every word > contains),
     * so popularity and live listings only reorder within a band.
     */
    async searchCards(
        query: string,
        useAiResolution: boolean = false,
        language?: string,
        game: string = 'pokemon',
        opts?: { signal?: AbortSignal },
    ): Promise<Card[]> {
        const signal = opts?.signal;
        if (!query || query.trim().length < 2 || signal?.aborted) return [];

        // Scope search to the browsing context (game + language) so a Pokemon
        // search doesn't surface One Piece/MTG and vice versa. Pass game='all'
        // to search every catalog at once (the desktop nav search does this).
        const searchAllGames = game === 'all';
        const dbLang = catalogLanguage(language);
        // The name dictionary only knows Pokémon.
        const usesDictionary = searchAllGames || game === 'pokemon';
        // Clipped like every other entry to the resolver: set matching and the
        // number split scan the whole text too, and a pasted paragraph is not
        // a card name.
        const trimmedQuery = clipQuery(query).replace(/\s+/g, ' ').trim();
        const cleanQuery = trimmedQuery.toLowerCase();
        // A result computed before the dictionary arrived is never cached (a
        // literal-only answer would stick for the session), so in a Pokémon
        // scope only a 'd' entry can exist, and only once the chunk is in.
        const cacheBase = `${cleanQuery}-${game}-${dbLang || 'all'}`;
        if (!usesDictionary || getLoadedSearchDictionary()) {
            const hit = searchIndex.get(`${cacheBase}-${usesDictionary ? 'd' : 'x'}`);
            if (hit) return hit;
        }

        // Set by any fetch that failed (a timeout, a 5xx), at any stage: the
        // answer may then be short, and a short answer must not be cached for
        // the rest of the session.
        let degraded = false;

        try {
            const supabase = createClient();
            // The dictionary chunk loads alongside the once-per-session set
            // list, and gives up after 800 ms: search then goes literal-only
            // instead of waiting on a slow mobile link.
            const [dict, allSets] = await Promise.all([
                usesDictionary ? loadSearchDictionary(800, { warmTypo: true }) : Promise.resolve(null),
                loadAllSets(supabase),
            ]);
            if (signal?.aborted) return [];
            // loadAllSets answers [] when the set list failed to load (the
            // table is never empty): set codes went unmatched this time, so
            // "MA3" searched as a name, and that answer must not be cached.
            if (allSets.length === 0) degraded = true;

            const setMatch = detectSet(trimmedQuery, allSets);
            const hasSet = setMatch.ids.length > 0;
            // "162/130" alone: a collector number with its printed set total.
            const totalMatch = hasSet ? null : trimmedQuery.match(/^#?(\d{1,4})\/(\d{1,4})$/);
            // Pull a collector number out of the residual query (the part not
            // consumed by a matched set). "Mewtwo 51" -> name "mewtwo" + number
            // 51; "Charizard 4/102" -> "charizard" + 4. Combined with a set this
            // gives set + number narrowing ("Mega Evolution 3").
            const parsed = parseNameAndNumber(hasSet ? setMatch.rest : trimmedQuery);
            // Only treat digits as a collector number when there's context to
            // anchor them: a matched set, or a residual name. A bare "151" stays
            // a name search rather than dumping every #151 across the catalog.
            const useNumber = !totalMatch && !!parsed.numberOr && (hasSet || parsed.name.length >= 2);
            const primaryName = useNumber ? parsed.name : hasSet ? setMatch.rest : trimmedQuery;
            const narrowed = hasSet || useNumber;

            interface NameSearch { a: QueryAnalysis; res: Resolution | null }
            const prepare = (text: string): NameSearch => {
                const a = analyzeQuery(text);
                const res = dict && a.nameKey ? resolveExact(dict, a) : null;
                return { a, res: res && res.groups.length > 0 ? res : null };
            };

            // Popular names match far more rows than one fetch returns, and an
            // unordered LIMIT truncates arbitrarily ("luffy" once kept 2 of 110
            // English rows because Japanese One Piece filled the fetch). So
            // without a language filter every catalog language gets its own
            // fetch. EN rows never carry english_name, and an ILIKE on it there
            // only turns an index scan into a filter scan.
            //
            // A language where every match must live gets the 100 rows the one
            // unfiltered fetch used to have, not a share: "MA3" (a Thai set) or
            // พิคาชู (Thai text) left a 40-row th fetch as the whole pool, and
            // most of the listed prints never reached ranking.
            const setInfo = new Map(allSets.map(s => [s.id, s] as const));
            const setLangs = new Set(setMatch.ids.map(id => catalogLanguage(setInfo.get(id)?.language)).filter(Boolean));
            const queryScript = analyzeQuery(trimmedQuery).script;
            const scriptLang: CatalogLang | null = queryScript === 'thai' ? 'th' : queryScript === 'kana' || queryScript === 'han' ? 'ja' : null;
            const scopesFor = (narrowing: boolean): Array<{ lang?: CatalogLang; limit: number; cols: NameColumns }> => {
                if (dbLang) return [{ limit: 100, cols: dbLang === 'en' ? CATALOG_COLUMNS_NO_ENGLISH : CATALOG_COLUMNS }];
                const wide = (l: CatalogLang) => l === scriptLang || (narrowing && setLangs.has(l));
                return [
                    { lang: 'en', limit: wide('en') ? 100 : 70, cols: CATALOG_COLUMNS_NO_ENGLISH },
                    { lang: 'ja', limit: wide('ja') ? 100 : 40, cols: CATALOG_COLUMNS },
                    { lang: 'th', limit: wide('th') ? 100 : 40, cols: CATALOG_COLUMNS },
                ];
            };

            const baseQuery = (select: string = SEARCH_SELECT) => {
                let q = supabase.from('pokemon_cards').select(select);
                if (!searchAllGames) q = q.eq('game', game);
                if (dbLang) {
                    // In all-games mode a strict language filter would empty
                    // every single-language catalog, so those games skip it.
                    // PostgREST ANDs this or-group with the name or-group.
                    q = searchAllGames && multiLanguageGameIds.length > 0
                        ? q.or(`language.eq.${dbLang},game.not.in.(${multiLanguageGameIds.join(',')})`)
                        : q.eq('language', dbLang);
                }
                if (signal) q = q.abortSignal(signal);
                return q;
            };

            interface Fetched { rows: any[]; sent: number; failed: number; malformed: number }
            // One name filter (per column set) across every scope, merged by id.
            // A null predicate means nothing searchable was left in the text;
            // with no set/number narrowing either, the scope is skipped, since
            // an unfiltered fetch would return arbitrary rows. `onlyGame`
            // narrows an all-games search to one game.
            const fetchScopes = async (
                pred: ((cols: NameColumns) => string | null) | null,
                narrow: boolean,
                onlyGame?: string,
            ): Promise<Fetched> => {
                const narrowing = narrow && narrowed;
                const results = await Promise.all(scopesFor(narrowing).map(s => {
                    const namePred = pred ? pred(s.cols) : null;
                    if (!namePred && !narrowing) return null;
                    let q = baseQuery();
                    if (onlyGame) q = q.eq('game', onlyGame);
                    if (s.lang) q = q.eq('language', s.lang);
                    if (narrowing && hasSet) q = q.in('set_id', setMatch.ids);
                    // Multiple .or() groups on one query are ANDed by PostgREST:
                    // (number) AND (name).
                    if (narrowing && useNumber) q = q.or(parsed.numberOr!);
                    if (namePred) q = q.or(namePred);
                    return q.limit(s.limit);
                }));
                const seen = new Map<string, any>();
                let sent = 0;
                let failed = 0;
                let malformed = 0;
                for (const r of results) {
                    if (!r) continue;
                    sent++;
                    if (r.error) {
                        failed++;
                        if (r.status === 400 || r.error.code === 'PGRST100') malformed++;
                        continue;
                    }
                    for (const row of (r.data || []) as any[]) if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
                }
                if (failed > 0) degraded = true;
                return { rows: Array.from(seen.values()), sent, failed, malformed };
            };

            const predFor = (ns: NameSearch | null, o: { literal?: boolean; res?: Resolution | null; includeResidual?: boolean } = {}) =>
                ns
                    ? (cols: NameColumns) => buildNamePredicate({
                        literal: o.literal === false ? '' : ns.a.nameText,
                        fullLiteral: o.literal === false ? '' : ns.a.fullText,
                        resolution: o.res === undefined ? ns.res : o.res,
                        cols,
                        includeResidual: o.includeResidual,
                    })
                    : null;

            // "162/130": every print numbered 162 in a set whose printed total
            // is 130, in every language. A bare number would dump every #162.
            const fetchSetTotal = async (numerator: string, total: number): Promise<Fetched> => {
                const variants = numberVariants(numerator);
                const { data, error } = await baseQuery(SEARCH_SELECT_SET_TOTAL)
                    .or(variants.flatMap(v => [`number.eq.${v}`, `number.ilike.${v}/%`]).join(','))
                    .eq('pokemon_sets.printed_total', total)
                    .limit(100);
                if (!error && data && data.length > 0) return { rows: data as any[], sent: 1, failed: 0, malformed: 0 };
                // A set row without printed_total still prints "162/130" on the card.
                const fallback = await baseQuery()
                    .or(variants.map(v => `number.eq.${v}/${total}`).join(','))
                    .limit(100);
                if (error || fallback.error) degraded = true;
                return {
                    rows: (fallback.data || []) as any[],
                    sent: 2,
                    failed: (error ? 1 : 0) + (fallback.error ? 1 : 0),
                    malformed: 0,
                };
            };

            const primary = primaryName ? prepare(primaryName) : null;
            // The whole query is a set's name: search it as a card name too,
            // in the set's own game ("Jungle" the Pokémon set is not MTG's
            // Jungle Hollow; "Arceus" the set is also the Pokémon).
            const exactSetSearch = setMatch.exact ? prepare(trimmedQuery) : null;
            const exactSetGames = new Set(setMatch.ids.map(id => setInfo.get(id)?.game).filter(Boolean));
            const exactSetGame = searchAllGames && exactSetGames.size === 1 ? String([...exactSetGames][0]) : undefined;
            const exactSetIds = setMatch.exact ? new Set(setMatch.ids) : null;
            const partialIds = !hasSet && !useNumber && !totalMatch ? partialSetIds(cleanQuery, allSets) : [];
            // Only a set whose name STARTS with the text ranks its cards with
            // the name hits ("evolving" Evolving Skies, "brilliant" Brilliant
            // Stars). A later word is usually who the set is named after:
            // "luffy" is in "Starter Deck 8: Monkey.D.Luffy" and "pika" in
            // "Detective Pikachu", and there the cards named for it are the
            // answer, not the deck's other cards.
            const leadingSetIds = new Set(partialIds.filter(id => (setInfo.get(id)?.name || '').toLowerCase().startsWith(cleanQuery)));
            // Partial-set rows come in a fetch of their own: ORed into the name
            // filter they used to fill the unordered LIMIT ("evee" pulled 79
            // rows of the Eevee Heroes set in ahead of the Eevees).
            const fetchPartialSets = async (): Promise<any[]> => {
                const { data, error } = await baseQuery().in('set_id', partialIds).limit(30);
                if (error) degraded = true;
                return (data || []) as any[];
            };

            const [first, exactSetFetch, partialRows] = await Promise.all([
                totalMatch
                    ? fetchSetTotal(totalMatch[1], parseInt(totalMatch[2], 10))
                    : fetchScopes(predFor(primary), true),
                exactSetSearch ? fetchScopes(predFor(exactSetSearch), false, exactSetGame) : Promise.resolve(null),
                partialIds.length > 0 ? fetchPartialSets() : Promise.resolve([] as any[]),
            ]);
            if (signal?.aborted) return [];

            let firstPass = first;
            // Runtime guard: if the generated filter is ever rejected outright
            // (400 PGRST100 on every scope), fall back to the plain literal
            // search instead of blanking search for this query.
            if (primary && first.sent > 0 && first.malformed === first.sent) {
                console.error('[searchCards] name filter rejected; retrying literal-only for:', trimmedQuery);
                firstPass = await fetchScopes(cols => legacyNamePredicate(primary.a.nameText, cols), true);
                if (signal?.aborted) return [];
            }
            if (firstPass.sent > 0 && firstPass.failed === firstPass.sent && !exactSetFetch?.rows.length) {
                if (signal?.aborted) return [];
                console.error('Search error: every catalog fetch failed for', trimmedQuery);
                return markFailedResult([]);
            }

            let rows = firstPass.rows;
            let current: NameSearch | null = primary;
            if (rows.length === 0 && narrowed && !setMatch.exact && !totalMatch) {
                // A narrowed pass can zero out on a false positive: a matched "set"
                // can be a common word doubling as a set name ("Dragon" is Pokemon
                // ex3), or the split-off "number" was really part of the name (or a
                // wrong/nonexistent print, e.g. "Great Tusk 54"). Retry once with
                // the name alone rather than the raw "name + number" string, which
                // never hits a card name.
                const retryText = useNumber && parsed.name.length >= 2 ? parsed.name : trimmedQuery;
                current = primary && retryText === primaryName ? primary : prepare(retryText);
                rows = (await fetchScopes(predFor(current), false)).rows;
                if (signal?.aborted) return [];
            }
            if (rows.length === 0 && current?.res && !setMatch.exact) {
                // Species found but nothing printed: leftover words are often not
                // on the card at all ("misty's magikarp" vs "Magikarp"), so drop
                // them; then the modifiers, which can name a print the catalog
                // does not have ("giratina origin"). Only when the WHOLE fetch
                // was empty: a half-typed name must keep requiring its rest.
                if (current.res.residual.length > 0) {
                    rows = (await fetchScopes(predFor(current, { literal: false, includeResidual: false }), false)).rows;
                    if (signal?.aborted) return [];
                }
                if (rows.length === 0 && current.res.modifiers.length > 0) {
                    const bare: Resolution = { groups: current.res.groups, modifiers: [], residual: [] };
                    rows = (await fetchScopes(predFor(current, { literal: false, res: bare }), false)).rows;
                    if (signal?.aborted) return [];
                }
            }

            const pool = new Map<string, any>();
            const addRows = (list: any[] | null | undefined) => {
                for (const r of list || []) if (r?.id && !pool.has(r.id)) pool.set(r.id, r);
            };
            addRows(rows);
            addRows(exactSetFetch?.rows);
            addRows(partialRows);

            let scoreSearch: NameSearch | null = exactSetSearch ?? current;

            // Phase 2: only when no species resolved exactly and no row even
            // starts with what was typed. Guessing on a query that already
            // matched turns ordinary words into Pokémon ("holo" Hoothoot).
            // Never for a set's exact name that found the set: its cards are
            // the answer, and typo rows ("Evolving Wilds" for "Evolving Skies")
            // would only rank above them.
            const rpcRank = new Map<string, number>();
            const p2 = primary && primary.a.nameKey ? primary : scoreSearch && scoreSearch.a.nameKey ? scoreSearch : null;
            const setAnswered = setMatch.exact && firstPass.rows.length > 0;
            if (!totalMatch && !setAnswered && p2 && !p2.res && !scoreSearch?.res) {
                const gateCtx = buildScoreContext((scoreSearch ?? p2).a, null);
                let strong = false;
                for (const r of pool.values()) {
                    if (scoreName(r, gateCtx).band >= 3) { strong = true; break; }
                }
                if (!strong) {
                    const looseRes = dict ? resolveLoose(dict, p2.a) : null;
                    const res2 = looseRes && looseRes.groups.length > 0 ? looseRes : null;
                    // The number/set still narrow when phase 2 works on the same
                    // name the narrowed pass used ("charizrd 4" -> Charizard #4).
                    const narrowP2 = p2 === primary && narrowed && !setMatch.exact;
                    const species = (res: Resolution | null, includeResidual?: boolean) => (cols: NameColumns) =>
                        buildNamePredicate({ literal: '', resolution: res, cols, includeResidual });
                    // The same relaxation ladder as phase 1: number/set, then
                    // leftover words, then modifiers, each only on an empty fetch.
                    const groupTask = res2
                        ? (async () => {
                            let got = await fetchScopes(species(res2), narrowP2);
                            if (got.rows.length === 0 && narrowP2 && !signal?.aborted) got = await fetchScopes(species(res2), false);
                            if (got.rows.length === 0 && res2.residual.length > 0 && !signal?.aborted) got = await fetchScopes(species(res2, false), false);
                            if (got.rows.length === 0 && res2.modifiers.length > 0 && !signal?.aborted) {
                                got = await fetchScopes(species({ groups: res2.groups, modifiers: [], residual: [] }), false);
                            }
                            return got.rows;
                        })()
                        : Promise.resolve([] as any[]);
                    const text = p2.a.nameText;
                    // pg_trgm needs 4+ characters to say anything, and shop words
                    // ("sealed", "booster box") sit close to real names (Sealeo).
                    const rpcTask = fuzzyRpcAvailable && Array.from(text.trim()).length >= 4 && !p2.a.tokens.every(t => isStopword(t))
                        ? (async (): Promise<any[]> => {
                            let q = supabase
                                .rpc('search_cards_fuzzy_v2', {
                                    p_query: hiraganaToKatakana(widthFold(text)).replace(/\s+/g, ' ').trim(),
                                    p_limit: 30,
                                    p_game: searchAllGames ? null : game,
                                })
                                .select(SEARCH_SELECT);
                            if (signal) q = q.abortSignal(signal);
                            const { data, error, status } = await q;
                            if (error) {
                                if (status === 404 && (error as { code?: string }).code === 'PGRST202') fuzzyRpcAvailable = false;
                                else degraded = true;
                                return [];
                            }
                            return Array.isArray(data) ? (data as any[]) : [];
                        })()
                        : Promise.resolve([] as any[]);
                    const [groupRows, rpcRows] = await Promise.all([groupTask, rpcTask]);
                    if (signal?.aborted) return [];

                    addRows(groupRows);
                    // The RPC has no language or number parameter (a PostgREST
                    // filter would apply after its LIMIT), so narrow here.
                    let fuzzyRows = rpcRows.filter(r =>
                        !dbLang || r.language === dbLang || (searchAllGames && !multiLanguageGameIds.includes(r.game)));
                    if (narrowP2) {
                        const inPrint = fuzzyRows.filter(r =>
                            (!hasSet || setMatch.ids.includes(r.set_id))
                            && (!useNumber || rowMatchesNumber(r.number, parsed.numberVariants)));
                        if (inPrint.length > 0) fuzzyRows = inPrint;
                    }
                    // Its rows carry no similarity score; array position is the rank.
                    fuzzyRows.forEach((r, i) => { if (r?.id && !rpcRank.has(r.id)) rpcRank.set(r.id, i); });
                    addRows(fuzzyRows);
                    if (res2) scoreSearch = { a: p2.a, res: res2 };
                }
            }

            const finalAnalysis = scoreSearch ? scoreSearch.a : analyzeQuery('');
            const finalRes = scoreSearch?.res ?? null;

            // Cross-language alias pass, for what the dictionary cannot place: a
            // Thai or Japanese query only matches that language's `name` column,
            // and the English and other-language printings of the same card
            // carry the English name. Borrow the English base name the direct
            // hits share most ("Vulpix", not one hit's "Vulpix (Master Ball
            // Pattern)", which PostgREST cannot even search), fetch on it, and
            // fold the results in just below the direct matches. Shop words
            // (การ์ด, カード) are skipped: they only prefix-match some name.
            const aliasRows: any[] = [];
            let aliasCtx: ScoreContext | null = null;
            if (!dbLang && !finalRes && !totalMatch && pool.size > 0 && NON_LATIN_SCRIPT.test(finalAnalysis.nameText)
                && !finalAnalysis.tokens.every(t => isStopword(t))) {
                const ctx0 = buildScoreContext(finalAnalysis, null);
                const hits = Array.from(pool.values())
                    .filter(r => (r.english_name || '').trim())
                    .map(r => ({ r, s: scoreName(r, ctx0) }))
                    .filter(x => x.s.band >= 1)
                    .sort((x, y) => y.s.band - x.s.band || y.s.score - x.s.score);
                // Every hit votes, weighted by its band: a top-10 cut over
                // equal-band rows is arbitrary DB order, and for ルフィ it let
                // three Yu-Gi-Oh "Magical Musket" prints (エンドルフィン)
                // outvote ten Monkey.D.Luffy.
                const votes = new Map<string, { term: string; n: number; first: number }>();
                hits.forEach((x, i) => {
                    const term = baseEnglishName(x.r.english_name, dict);
                    if (!term) return;
                    const k = term.toLowerCase();
                    const v = votes.get(k);
                    if (v) v.n += x.s.band;
                    else votes.set(k, { term, n: x.s.band, first: i });
                });
                let alias: string | null = null;
                let best = { n: 0, first: Infinity };
                for (const v of votes.values()) {
                    if (v.n > best.n || (v.n === best.n && v.first < best.first)) {
                        best = v;
                        alias = v.term;
                    }
                }
                if (alias) {
                    const aliasSearch = prepare(alias);
                    const got = await fetchScopes(predFor(aliasSearch), false);
                    if (signal?.aborted) return [];
                    aliasCtx = buildScoreContext(aliasSearch.a, aliasSearch.res);
                    for (const r of got.rows) if (r?.id && !pool.has(r.id)) aliasRows.push(r);
                }
            }

            // Search popularity plus live inventory for the candidate set. The
            // inventory lookup is what lets a print that is actually for sale
            // outrank its unpurchasable siblings (and survive the top-30 cut).
            const allIds = [...Array.from(pool.keys()), ...aliasRows.map(r => r.id)];
            const chunks: string[][] = [];
            for (let i = 0; i < allIds.length; i += BOOST_CHUNK) chunks.push(allIds.slice(i, i + BOOST_CHUNK));
            const popularityMap = new Map<string, number>();
            const listedSet = new Set<string>();
            await Promise.all(chunks.map(async (ids) => {
                let pop = supabase.from('search_popularity').select('card_id, search_count').in('card_id', ids);
                let listed = supabase.from('listings').select('card_id').eq('status', 'active').in('card_id', ids);
                if (signal) {
                    pop = pop.abortSignal(signal);
                    listed = listed.abortSignal(signal);
                }
                const [{ data: popularityData, error: popError }, { data: listedRows, error: listedError }] = await Promise.all([pop, listed]);
                if (popError || listedError) degraded = true;
                for (const p of (popularityData || []) as { card_id: string; search_count: number }[]) popularityMap.set(p.card_id, p.search_count);
                for (const r of (listedRows || []) as { card_id: string }[]) listedSet.add(r.card_id);
            }));
            if (signal?.aborted) return [];

            const boost = (card: any) => {
                // Learned from user searches; capped so it reorders, never dominates.
                let b = Math.min(50, Math.floor((popularityMap.get(card.id) || 0) / 10));
                // A print with a live listing is the one the searcher can act on.
                if (listedSet.has(card.id)) b += 25;
                // Pokemon over Trainers/Energy, for Pokemon rows only.
                if ((searchAllGames ? card.game : game) === 'pokemon' && card.supertype === 'Pokémon') b += 10;
                return b;
            };

            const ctx = buildScoreContext(finalAnalysis, finalRes);
            interface Scored { card: any; band: number; score: number }
            const scored: Scored[] = [];
            let bestDirectBand = 0;
            for (const card of pool.values()) {
                let band: number;
                let score: number;
                if (totalMatch) {
                    // Every row already matches number and printed total.
                    band = 4;
                    score = String(card.number || '').endsWith(`/${totalMatch[2]}`) ? 100 : 90;
                } else {
                    const s = scoreName(card, ctx);
                    band = s.band;
                    score = s.score;
                    const rank = rpcRank.get(card.id);
                    // A typo the trigram RPC matched is as good as a contains
                    // match, below one, in the RPC's own order.
                    if (band === 0 && rank !== undefined) {
                        band = 1;
                        score = 45 - Math.min(20, rank / 2);
                    }
                    if (exactSetIds) {
                        // The query IS this set's name ("Jungle", "Team
                        // Rocket", "XY"): its cards are the answer, and only a
                        // card that is exactly the name ("Arceus", "Deoxys")
                        // ranks above them. Names that merely start with it
                        // ("Team Rocket's Mewtwo ex") come after.
                        if (exactSetIds.has(card.set_id)) {
                            if (band < 3) band = 3;
                            score = Math.max(score, 76);
                        } else if (band === 3) {
                            band = 2;
                        }
                    } else if (band < 3 && leadingSetIds.has(card.set_id)) {
                        // The start of a set's name ("evolving", "surging"):
                        // its cards rank with the names that start with the
                        // word, where listings and popularity decide, instead
                        // of under every name in every game containing it.
                        // At 70 (root-prefix level) the set's Pokémon (+10)
                        // edge past another game's prefix hits ("Evolving
                        // Wilds" for "evolving") but stay under Pokémon whose
                        // own name starts with the text.
                        band = 3;
                        score = Math.max(score, 70);
                    }
                }
                if (band > bestDirectBand) bestDirectBand = band;
                scored.push({ card, band, score: score + boost(card) });
            }
            for (const card of aliasRows) {
                const s = aliasCtx ? scoreName(card, aliasCtx) : { band: 0, score: 25 };
                // 0.9x and never above the best direct band: matched via the
                // borrowed English name, not the query itself.
                scored.push({ card, band: Math.min(s.band, bestDirectBand), score: s.score * 0.9 + boost(card) });
            }

            const byRank = (a: Scored, b: Scored) => b.band - a.band || b.score - a.score;
            // Equal-ranked rows come back in fetch order, which is en, ja, th
            // scope by scope, so "pikachu" filled the list with English prints
            // and left two Thai ones. Deal tied rows out one language at a time.
            const rank = (rows: Scored[]): Scored[] => {
                rows.sort(byRank);
                const out: Scored[] = [];
                for (let i = 0; i < rows.length;) {
                    let j = i + 1;
                    while (j < rows.length && byRank(rows[i], rows[j]) === 0) j++;
                    const byLang = new Map<string, Scored[]>();
                    for (let k = i; k < j; k++) {
                        const lang = rows[k].card.language || '';
                        const list = byLang.get(lang);
                        if (list) list.push(rows[k]);
                        else byLang.set(lang, [rows[k]]);
                    }
                    const queues = [...byLang.values()];
                    for (let n = 0; out.length < j; n++) {
                        for (const q of queues) if (n < q.length) out.push(q[n]);
                    }
                    i = j;
                }
                return out;
            };
            // Keep the top 30 — but guarantee genuine matches from every
            // language survive the cut. Without this, 30 English printings of a
            // popular name push every th/ja row off the list.
            const sorted = rank(scored);
            const top = sorted.slice(0, 30);
            if (!dbLang) {
                const MIN_PER_LANG = 2;
                const countOf = (lang: string) => top.filter(r => r.card.language === lang).length;
                // 'en' is in the list for the reverse direction: a Thai query for
                // a popular card matches 30+ Thai prints outright.
                for (const lang of ['th', 'ja', 'en']) {
                    const present = countOf(lang);
                    if (present >= MIN_PER_LANG) continue;
                    const inTop = new Set(top);
                    const candidates = sorted
                        .filter(r => r.card.language === lang && r.band >= 1 && !inTop.has(r))
                        .slice(0, MIN_PER_LANG - present);
                    for (const c of candidates) {
                        if (top.length < 30) { top.push(c); continue; }
                        // Evict the lowest-ranked row of an OVER-represented
                        // language only — evicting any non-`lang` row would let a
                        // later pass clobber the rows an earlier pass swapped in.
                        for (let i = top.length - 1; i >= 0; i--) {
                            if (countOf(top[i].card.language) > MIN_PER_LANG) { top[i] = c; break; }
                        }
                    }
                }
            }
            const topResults = rank(top).map(r => this.mapSupabaseCardToInternal(r.card));

            // Track search popularity for the top few results (learning!). Only
            // the strongest matches — one RPC write each, fire-and-forget, so a
            // keystroke-search doesn't fan out 10 writes site-wide at scale.
            if (topResults.length > 0) {
                topResults.slice(0, 3).forEach(card => {
                    // supabase-js builders only send the request when awaited or
                    // .then()-ed; `void` discarded the thenable unexecuted, so the
                    // popularity table stayed at zero rows for months.
                    supabase.rpc('increment_search_popularity', { p_card_id: card.id }).then(() => undefined, () => undefined);
                });
            }

            // Cache only complete answers: not one computed without the
            // dictionary, and not one a failed fetch (at any stage) left short.
            if (topResults.length > 0 && (!usesDictionary || dict) && !degraded) {
                searchIndex.set(`${cacheBase}-${usesDictionary ? 'd' : 'x'}`, topResults);
            }

            return topResults.length === 0 && degraded ? markFailedResult(topResults) : topResults;
        } catch (error) {
            if (signal?.aborted) return [];
            console.error("Search failure:", error);
            return markFailedResult([]);
        }
    },

    async fetchSealedProducts(opts: { game: string; setId?: string; q?: string; language?: string }): Promise<SealedProduct[]> {
        try {
            const params = new URLSearchParams({ game: opts.game });
            if (opts.setId) params.set('setId', opts.setId);
            if (opts.q) params.set('q', opts.q);
            if (opts.language) params.set('language', opts.language);
            const res = await fetch(`/api/sealed?${params.toString()}`);
            // Marked, so search analytics can tell a failed fetch from no match.
            if (!res.ok) return markFailedResult([]);
            const data = await res.json();
            return data.products || [];
        } catch (error) {
            console.error('Failed to fetch sealed products:', error);
            return markFailedResult([]);
        }
    },

    // Distinct set ids with at least one sealed product — lets the catalog's
    // sealed mode hide sets that would show an empty list.
    async fetchSealedSetIds(opts: { game: string; language?: string }): Promise<string[]> {
        try {
            const params = new URLSearchParams({ game: opts.game, setsOnly: '1' });
            if (opts.language) params.set('language', opts.language);
            const res = await fetch(`/api/sealed?${params.toString()}`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.setIds || [];
        } catch (error) {
            console.error('Failed to fetch sealed set ids:', error);
            return [];
        }
    },

    mapSupabaseCardToInternal(supabaseCard: any): Card {
        return mapSupabaseCardToInternal(supabaseCard);
    },

    async fetchCardsByIds(ids: string[]): Promise<Card[]> {
        if (!ids || ids.length === 0) return [];
        try {
            const supabase = createClient();
            const { data, error } = await supabase
                .from('pokemon_cards')
                .select(`
                    id, name, english_name, set_id, number, rarity, game,
                    image_small, image_large, language,
                    tcgplayer_url, tcgplayer:raw_data->tcgplayer,
                    market_values(condition, language, market_avg, currency, last_updated),
                    pokemon_sets(name, printed_total, total)
                `)
                .in('id', ids);
            if (error) {
                console.error('fetchCardsByIds error:', error);
                return [];
            }
            const byId = new Map((data || []).map(r => [r.id, r]));
            return ids.map(id => byId.get(id)).filter(Boolean).map(r => mapSupabaseCardToInternal(r));
        } catch (e) {
            console.error('fetchCardsByIds failed:', e);
            return [];
        }
    }
};
