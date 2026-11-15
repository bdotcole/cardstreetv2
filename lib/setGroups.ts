// How the set browser breaks one game's sets into sections.
//
// The /sets index used to be a single grid of every set in the catalog (about
// 1,400), newest first, with English, Japanese and Thai prints interleaved.
// Nobody finds "Evolving Skies" by scrolling past 300 tiles, so each game is
// now cut the way its own players think about it:
//
//   Pokemon    by era (Mega Evolution, Scarlet & Violet, Sword & Shield, ...)
//   One Piece  by product line (boosters, extra boosters, starter decks)
//   Magic      by set type (expansions, Commander, supplemental, art series)
//   the rest   by release year
//
// The catalog's own `series` column cannot be used as-is: it is a real era for
// English Pokemon, the placeholder "Pokémon (JP)" / "Pokémon (TH)" for half of
// the Japanese and Thai rows, empty for the Thai starter decks, and the game's
// name for Yu-Gi-Oh, One Piece, Lorcana and Riftbound. So the era is read from
// the series when it names one, then from the set code, then from the date.
//
// Pure and client-safe: no imports from server modules.

export interface GroupableSet {
    id: string;
    game: string;
    language: string;
    series?: string | null;
    release_date?: string | null;
}

/** One set as the browser shows it. Built server-side by getSetBrowserData. */
export interface BrowserSet extends GroupableSet {
    name: string;
    /** The code printed on the cards ("SV8a", "OP-09"), where the id is one. */
    code: string | null;
    total: number;
    /** Pictures to try in order; a tile falls through to the next on error. */
    art: string[];
}

export interface SetGroup {
    /** Stable within one game: the section's anchor and React key. */
    key: string;
    label: { en: string; th: string };
    /** Sections render in ascending order. */
    order: number;
}

const same = (label: string) => ({ en: label, th: label });

// Era names stay in English in both UI languages. They are product names
// (the Thai boxes print "Scarlet & Violet" too), most eras never had a Thai
// release to take a Thai name from, and the catalog itself spells the few
// that did two ways.
const POKEMON_ERAS: [key: string, label: string][] = [
    ['mega', 'Mega Evolution'],
    ['sv', 'Scarlet & Violet'],
    ['swsh', 'Sword & Shield'],
    ['sm', 'Sun & Moon'],
    ['xy', 'XY'],
    ['bw', 'Black & White'],
    ['hgss', 'HeartGold & SoulSilver'],
    ['pl', 'Platinum'],
    ['dp', 'Diamond & Pearl'],
    ['ex', 'EX'],
    ['ecard', 'e-Card'],
    ['neo', 'Neo'],
    ['gym', 'Gym'],
    ['base', 'Base'],
];

// Japan numbered these eras differently: the EX years were the PCG series and
// the first sets carry no "Base" name at all.
const POKEMON_ERA_LABELS_JA: Record<string, string> = {
    ex: 'PCG',
    ecard: 'e-Card, VS & web',
    base: 'Original series',
};

const SERIES_TO_ERA: [RegExp, string][] = [
    [/mega|メガ/, 'mega'],
    [/scarlet|スカーレット/, 'sv'],
    [/sword|ソード/, 'swsh'],
    [/sun ?& ?moon|サン/, 'sm'],
    [/^xy/, 'xy'],
    [/black ?& ?white/, 'bw'],
    [/heartgold/, 'hgss'],
    [/platinum/, 'pl'],
    [/diamond/, 'dp'],
    [/^ex$/, 'ex'],
    [/e-card/, 'ecard'],
    [/^neo/, 'neo'],
    [/^gym/, 'gym'],
    [/^base/, 'base'],
];

// Set codes, for the rows whose series says nothing. Order matters: "sv" and
// "sm" are tested before the bare Sword & Shield "s", and "mcd" (McDonald's
// promos) is kept out of the Mega era. The one-off ids are English sets the
// catalog files under no series: Southern Islands shipped with Neo, Call of
// Legends closed HeartGold & SoulSilver, POP Series 1-5 ran through the EX
// years and 6-9 through Diamond & Pearl, and Legendary Collection is a reprint
// of the Base-era sets.
const CODE_TO_ERA: [RegExp, string][] = [
    [/^m(?!cd)/, 'mega'],
    [/^sv/, 'sv'],
    [/^(sm|as\d|det1$)/, 'sm'],
    [/^(swsh|s\d|s-p|sc|sh$|cel25)/, 'swsh'],
    [/^(xy|g1$|dc1$)/, 'xy'],
    [/^(bw|dv1$)/, 'bw'],
    [/^(hgss|col1$)/, 'hgss'],
    [/^(pl\d|ru1$)/, 'pl'],
    [/^(dp|pop[6-9]$)/, 'dp'],
    [/^(ex|pcg|np$|pop[1-5]$)/, 'ex'],
    [/^(ecard|e\d|vs\d|web\d)/, 'ecard'],
    [/^(neo|si1$)/, 'neo'],
    [/^gym/, 'gym'],
    [/^(base|pmcg|lc$)/, 'base'],
];

// Last resort for a code nothing above recognises: the era on sale that day.
// Dates are when the English series began, which is the latest of the three
// languages, so a Japanese or Thai set near a boundary lands one era early at
// worst. Platinum has no entry: it overlaps Diamond & Pearl month for month.
const ERA_STARTS: [from: string, era: string][] = [
    ['2025-08-01', 'mega'],
    ['2023-01-01', 'sv'],
    ['2020-02-01', 'swsh'],
    ['2017-01-01', 'sm'],
    ['2013-11-01', 'xy'],
    ['2011-04-01', 'bw'],
    ['2010-02-01', 'hgss'],
    ['2007-05-01', 'dp'],
    ['2003-06-01', 'ex'],
    ['2002-03-01', 'ecard'],
    ['2000-12-01', 'neo'],
    ['2000-08-01', 'gym'],
    ['1996-01-01', 'base'],
];

const OTHER: SetGroup = { key: 'other', label: { en: 'Other sets', th: 'ชุดอื่น ๆ' }, order: 9000 };

function pokemonEraKey(set: GroupableSet): string | null {
    const series = (set.series || '').toLowerCase();
    for (const [pattern, era] of SERIES_TO_ERA) if (pattern.test(series)) return era;

    const code = set.id.toLowerCase().replace(/-(?:th|jp|ja|en)$/, '');
    for (const [pattern, era] of CODE_TO_ERA) if (pattern.test(code)) return era;

    const date = set.release_date || '';
    if (date) for (const [from, era] of ERA_STARTS) if (date >= from) return era;
    return null;
}

function pokemonGroup(set: GroupableSet): SetGroup {
    const key = pokemonEraKey(set);
    const index = POKEMON_ERAS.findIndex(([era]) => era === key);
    if (index === -1) return OTHER;
    const label = (set.language === 'ja' && POKEMON_ERA_LABELS_JA[POKEMON_ERAS[index][0]]) || POKEMON_ERAS[index][1];
    return { key: POKEMON_ERAS[index][0], label: same(label), order: index };
}

// Thai spellings follow the One Piece landing copy (lib/gameLanding.ts), which
// already names these product lines.
const ONE_PIECE_GROUPS: [RegExp, SetGroup][] = [
    [/^op-op/, { key: 'booster', label: { en: 'Booster packs', th: 'บูสเตอร์แพ็ค' }, order: 0 }],
    [/^op-(eb|prb)-/, { key: 'extra', label: { en: 'Extra & premium boosters', th: 'เอ็กซ์ตร้าและพรีเมียมบูสเตอร์' }, order: 1 }],
    [/^op-(st-|set-sail)/, { key: 'starter', label: { en: 'Starter decks', th: 'สตาร์ทเตอร์เด็ค' }, order: 2 }],
];
const ONE_PIECE_OTHER: SetGroup = { key: 'promo', label: { en: 'Promos & other', th: 'การ์ดโปรโมและอื่น ๆ' }, order: 3 };

function onePieceGroup(set: GroupableSet): SetGroup {
    const id = set.id.toLowerCase();
    return ONE_PIECE_GROUPS.find(([pattern]) => pattern.test(id))?.[1] ?? ONE_PIECE_OTHER;
}

// `series` holds Scryfall's set_type for Magic. The art series and token sets
// ("memorabilia") are a third of the catalog and are not what anyone opens the
// page for, so they go last instead of sitting beside the expansion they
// shadow.
const MTG_MAIN: SetGroup = { key: 'main', label: { en: 'Expansions & core sets', th: 'ชุดหลัก' }, order: 0 };
const MTG_COMMANDER: SetGroup = { key: 'commander', label: same('Commander'), order: 1 };
const MTG_SUPPLEMENTAL: SetGroup = { key: 'supplemental', label: { en: 'Supplemental sets', th: 'ชุดเสริม' }, order: 2 };
const MTG_MEMORABILIA: SetGroup = { key: 'memorabilia', label: { en: 'Art series & memorabilia', th: 'อาร์ตซีรีส์และของสะสม' }, order: 3 };

function mtgGroup(set: GroupableSet): SetGroup {
    const type = (set.series || '').toLowerCase();
    if (type === 'expansion' || type === 'core') return MTG_MAIN;
    if (type === 'commander') return MTG_COMMANDER;
    if (type === 'memorabilia' || type === 'token' || type === 'promo') return MTG_MEMORABILIA;
    return MTG_SUPPLEMENTAL;
}

const UNDATED: SetGroup = { key: 'undated', label: { en: 'Undated', th: 'ไม่ระบุปี' }, order: 9000 };

function yearGroup(set: GroupableSet): SetGroup {
    const year = Number((set.release_date || '').slice(0, 4));
    if (!year) return UNDATED;
    return { key: `y${year}`, label: same(String(year)), order: 3000 - year };
}

export function setGroupFor(set: GroupableSet): SetGroup {
    switch (set.game) {
        case 'pokemon':
            return pokemonGroup(set);
        case 'onepiece':
            return onePieceGroup(set);
        case 'mtg':
            return mtgGroup(set);
        default:
            return yearGroup(set);
    }
}

/** Newest first; undated rows (the Thai starter decks) after the dated ones. */
export function byNewest(a: GroupableSet, b: GroupableSet): number {
    const da = a.release_date || '';
    const db = b.release_date || '';
    if (da !== db) return da > db ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface GroupedSets<T> {
    group: SetGroup;
    sets: T[];
}

/** Sections in display order, each newest first. Give it one game's sets. */
export function groupSets<T extends GroupableSet>(sets: T[]): GroupedSets<T>[] {
    const byKey = new Map<string, GroupedSets<T>>();
    for (const set of sets) {
        const group = setGroupFor(set);
        const bucket = byKey.get(group.key);
        if (bucket) bucket.sets.push(set);
        else byKey.set(group.key, { group, sets: [set] });
    }
    const groups = [...byKey.values()].sort((a, b) => a.group.order - b.group.order);
    for (const g of groups) g.sets.sort(byNewest);
    return groups;
}

// Catalog language codes are the database's ('ja'), not the 'jp' the mobile
// pickers pass around; lib/games.ts documents the split.
export const SET_LANGUAGE_ORDER = ['en', 'ja', 'th'];

export const SET_LANGUAGE_LABELS: Record<string, { en: string; th: string; flag: string }> = {
    en: { en: 'English', th: 'อังกฤษ', flag: 'https://flagcdn.com/w40/us.png' },
    ja: { en: 'Japanese', th: 'ญี่ปุ่น', flag: 'https://flagcdn.com/w40/jp.png' },
    th: { en: 'Thai', th: 'ไทย', flag: 'https://flagcdn.com/w40/th.png' },
};

/** 'jp' (mobile pickers, old links) and 'ja' both mean the Japanese catalog. */
export function normalizeSetLanguage(code: string | null | undefined): string {
    const c = (code || '').toLowerCase();
    return c === 'jp' ? 'ja' : c;
}
