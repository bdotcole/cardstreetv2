import type { Modifier } from './modifiers';
import type { Script } from './normalize';

/**
 * One Pokémon species and every name it goes by.
 *
 * DB-bound spellings (`en`, `enDb`, `ja`, `th`) become ILIKE legs, so the
 * build guarantees they appear in the catalog (or are the official name), are
 * at least 2 characters, and contain none of `,()%*_\"`. Resolution-only names
 * (`aliases`, `late`) are matched against the query and never sent anywhere.
 */
export interface NameGroup {
    /** Index into SearchDictionary.groups. */
    idx: number;
    /** National Pokédex number. */
    dex: number;
    /** Canonical English name (PokeAPI). */
    en: string;
    /** English spellings the catalog actually uses for this species ("Farfetch'd", "Farfetch’d"; "Flabébé", "Flabebe"). */
    enDb: string[];
    /** Japanese spellings in catalog names, most frequent first (max 3). */
    ja: string[];
    /** Thai spellings in catalog names, most frequent first (max 3). */
    th: string[];
    /** Phase-1 resolution-only names: ko, zh-Hans, zh-Hant, Thai fan/historical spellings, extra catalog spellings. */
    aliases: string[];
    /** Phase-2-only names (romaji, fr, de, es, it): consulted only when the literal search finds nothing, because many are ordinary English words ("fire" is Moltres in romaji). */
    late: string[];
}

/** Serialized shape of lib/search/data/pokemonNames.json. */
export interface SearchDictionaryFile {
    v: 1;
    foldVersion: number;
    built: string;
    /** [dex, en, enDb, ja, th, aliases, late] */
    groups: Array<[number, string, string[], string[], string[], string[], string[]]>;
    /**
     * Precomputed fold keys mirroring `groups`: [enKey, enDbKeys, jaKeys, thKeys, aliasKeys, lateKeys].
     * Ignored (recomputed) when foldVersion differs from normalize.ts FOLD_VERSION.
     */
    keys: Array<[string, string[], string[], string[], string[], string[]]>;
}

export type MatchKind = 'exact' | 'late' | 'prefix' | 'loose' | 'fuzzy';

export interface GroupMatch {
    group: NameGroup;
    kind: MatchKind;
    /** Edit distance for 'fuzzy', else 0. */
    distance: number;
    /** The dictionary name the query matched. */
    matched: string;
}

export interface ModifierMatch {
    modifier: Modifier;
    /** The query text that triggered it. */
    matched: string;
}

export type CatalogLanguage = 'en' | 'ja' | 'th';

export interface QueryAnalysis {
    raw: string;
    /** The query minus language and rarity tokens; what literal ILIKE legs search for. */
    nameText: string;
    nameKey: string;
    /**
     * The whole query (whitespace collapsed), the same as nameText unless
     * words were stripped. Searched and ranked as a literal too: "sir hiss" is
     * a card name as well as rarity "sir" + "hiss".
     */
    fullText: string;
    fullKey: string;
    /** Words of nameText. */
    tokens: string[];
    script: Script;
    languagePref: CatalogLanguage[];
    rarityPref: string[];
}

export interface Resolution {
    /** Species the query names, at most 3. Empty when nothing resolved. */
    groups: GroupMatch[];
    /** Modifiers that must also appear on matching rows (ANDed). */
    modifiers: ModifierMatch[];
    /**
     * Leftover name fragments that are neither species nor modifiers ("misty"
     * in "misty's magikarp", "ของคาซุมิ" in "คอยคิงของคาซุมิ"). ANDed as name
     * legs; callers retry without them when that returns nothing.
     */
    residual: string[];
}
