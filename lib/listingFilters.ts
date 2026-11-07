import { GAMES, getGameLanguages } from '@/lib/games';
import {
    LISTING_CONDITIONS,
    LISTING_GRADING_COMPANIES,
    MIN_GRADE_OPTIONS,
    NO_GRADING_FILTER,
    type GradingFilter,
} from '@/lib/listingDisplay';
import type { FacetValue, ListingFilters, ListingSort } from '@/services/marketplaceService';

/**
 * The desktop marketplace's filter state: its defaults, what it asks the
 * service for, and how it rides in the URL. The URL is what brings a buyer's
 * filters back when they press Back from a card page, since the grid remounts.
 */

export const PRICE_NO_MAX = 100000;

/**
 * Bands cut to the stock: on 2026-11-05, 66% of active listings were under
 * ฿100 and 90% under ฿500, so the mobile sheet's "under ฿500" would hold nearly
 * everything.
 */
export const PRICE_PRESETS: ReadonlyArray<readonly [number, number]> = [
    [0, 100],
    [100, 500],
    [500, 2000],
    [2000, 10000],
    [10000, PRICE_NO_MAX],
];

/** Rarity option that hides the commons: 63% of active listings on 2026-11-05. */
export const RARITY_RARE_AND_ABOVE = 'rare_and_above';

/**
 * Rarity is not normalized in listing snapshots: the same tier reads "AR" on a
 * Thai card and "Illustration rare" on an English one. Spellings are lower-case
 * because the service matches them case-insensitively. The spelling-to-code
 * pairs follow THAI_RARITY_DISPLAY in lib/cardMapper.ts. Labels stay English
 * with the code, which is how Thai collectors say them too.
 *
 * Any rarity not listed here still gets an option of its own, under its printed
 * name, after these. That is how "Super Rare" (Lorcana's tier, not SR) lands.
 */
const RARITY_GROUPS: ReadonlyArray<{ key: string; label: string; spellings: readonly string[] }> = [
    { key: 'c', label: 'Common (C)', spellings: ['c', 'common'] },
    { key: 'u', label: 'Uncommon (U)', spellings: ['u', 'uc', 'uncommon'] },
    { key: 'r', label: 'Rare (R)', spellings: ['r', 'rare'] },
    { key: 'rr', label: 'Double Rare (RR)', spellings: ['rr', 'double rare'] },
    { key: 'rrr', label: 'Triple Rare (RRR)', spellings: ['rrr', 'triple rare'] },
    { key: 'ar', label: 'Illustration Rare (AR)', spellings: ['ar', 'illustration rare'] },
    { key: 'sr', label: 'Ultra Rare (SR)', spellings: ['sr', 'ultra rare'] },
    { key: 'sar', label: 'Special Illustration (SAR)', spellings: ['sar', 'special illustration rare'] },
    { key: 'ur', label: 'Hyper Rare (UR)', spellings: ['ur', 'hyper rare'] },
    { key: 'mur', label: 'Mega Ultra Rare (MUR)', spellings: ['mur'] },
    { key: 'sec', label: 'Secret (SEC)', spellings: ['sec', 'secret rare'] },
    { key: 'l', label: 'Leader (L)', spellings: ['l', 'leader'] },
    { key: 'pb', label: 'Pokeball Holo (PB)', spellings: ['pb'] },
    { key: 'eh', label: 'Energy Holo (EH)', spellings: ['eh'] },
    // Not a rarity, but the catalog stores it as one under two spellings.
    { key: 'trainer', label: 'Trainer', spellings: ['trainer', 'เทรนเนอร์'] },
];

const BELOW_RARE_SPELLINGS = RARITY_GROUPS
    .filter((g) => g.key === 'c' || g.key === 'u')
    .flatMap((g) => g.spellings);

const facetKey = (value: string) => value.trim().toLowerCase();

export interface FilterOption {
    value: string;
    label: string;
    /** Active listings behind the option, so a buyer can see what a choice leaves. */
    count: number;
}

/**
 * One option per set, stocked first. Set names are matched case-insensitively,
 * so "30th CELEBRATION" and "30th Celebration" are one set, labelled with the
 * spelling most listings use.
 */
export function setFilterOptions(sets: FacetValue[]): FilterOption[] {
    const merged = new Map<string, { label: string; labelCount: number; total: number }>();
    for (const { value, count } of sets) {
        const key = facetKey(value);
        if (!key) continue;
        const entry = merged.get(key);
        if (!entry) {
            merged.set(key, { label: value.trim(), labelCount: count, total: count });
        } else {
            entry.total += count;
            if (count > entry.labelCount) {
                entry.label = value.trim();
                entry.labelCount = count;
            }
        }
    }
    return [...merged.entries()]
        .sort(([, a], [, b]) => b.total - a.total || a.label.localeCompare(b.label))
        .map(([value, { label, total }]) => ({ value, label, count: total }));
}

/** The tiers in stock, low to high, then anything else, most stocked first. */
export function rarityFilterOptions(rarities: FacetValue[]): FilterOption[] {
    const stocked = new Map<string, number>();
    for (const { value, count } of rarities) {
        const key = facetKey(value);
        stocked.set(key, (stocked.get(key) ?? 0) + count);
    }
    const grouped = RARITY_GROUPS
        .map((g) => ({ value: g.key, label: g.label, count: g.spellings.reduce((n, s) => n + (stocked.get(s) ?? 0), 0) }))
        .filter((g) => g.count > 0);
    const known = new Set(RARITY_GROUPS.flatMap((g) => g.spellings));
    const others = setFilterOptions(rarities.filter((r) => !known.has(facetKey(r.value))));
    return [...grouped, ...others];
}

export interface MarketplaceFilterState {
    game: string;
    section: 'singles' | 'sealed';
    language: string;
    grading: GradingFilter;
    /** A raw card's condition; reachable only under the Raw grading choice. */
    condition: string;
    priceMin: number;
    priceMax: number;
    /** facetKey of the set name, '' = all. */
    set: string;
    /** A rarity option's value, or RARITY_RARE_AND_ABOVE; '' = any. */
    rarity: string;
    dealsOnly: boolean;
    acceptsOffers: boolean;
    sort: ListingSort;
}

export const DEFAULT_MARKETPLACE_FILTERS: MarketplaceFilterState = {
    game: 'all',
    section: 'singles',
    language: 'all',
    grading: NO_GRADING_FILTER,
    condition: '',
    priceMin: 0,
    priceMax: PRICE_NO_MAX,
    set: '',
    rarity: '',
    dealsOnly: false,
    acceptsOffers: false,
    // Deals-first, matching the mobile marketplace's default sort.
    sort: 'best_deals',
};

/** Language codes the chips offer. games.ts declares Japanese as 'jp'; listing snapshots use 'ja'. */
export function languageOptionsForGame(game: string): string[] {
    return game === 'all'
        ? ['en', 'ja', 'th']
        : getGameLanguages(game).map((l) => (l.code === 'jp' ? 'ja' : l.code));
}

/** The language to carry into `game`: kept only where that game can show a choice of it. */
export function languageForGame(game: string, language: string): string {
    const options = languageOptionsForGame(game);
    return options.length > 1 && options.includes(language) ? language : 'all';
}

/** Filters a buyer set and can clear. Game and section are navigation; sort is not a filter. */
export function countActiveFilters(f: MarketplaceFilterState): number {
    const singles = f.section === 'singles';
    return [
        f.language !== 'all',
        singles && (f.grading.grading !== 'any' || !!f.grading.gradingCompany || f.grading.minGrade > 0),
        singles && !!f.condition,
        f.priceMin > 0 || f.priceMax < PRICE_NO_MAX,
        !!f.set,
        singles && !!f.rarity,
        f.dealsOnly,
        f.acceptsOffers,
    ].filter(Boolean).length;
}

export function clearFilters(f: MarketplaceFilterState): MarketplaceFilterState {
    return { ...DEFAULT_MARKETPLACE_FILTERS, game: f.game, section: f.section, sort: f.sort };
}

/** Typed price boxes to a range: blank is open-ended and a reversed pair is swapped. */
export function priceRangeFromInputs(minText: string, maxText: string): [number, number] {
    const min = Number(minText) || 0;
    const max = Number(maxText) || PRICE_NO_MAX;
    const range: [number, number] = min > max ? [max, min] : [min, max];
    return [range[0], Math.min(range[1], PRICE_NO_MAX)];
}

export function toListingQuery(f: MarketplaceFilterState, search: string): ListingFilters {
    const rareAndAbove = f.rarity === RARITY_RARE_AND_ABOVE;
    const group = RARITY_GROUPS.find((g) => g.key === f.rarity);
    return {
        search: search || undefined,
        game: f.game,
        kind: f.section,
        language: f.language === 'all' ? undefined : f.language,
        grading: f.grading.grading === 'any' ? undefined : f.grading.grading,
        gradingCompany: f.grading.gradingCompany || undefined,
        minGrade: f.grading.minGrade || undefined,
        condition: f.condition || undefined,
        minPrice: f.priceMin,
        maxPrice: f.priceMax,
        setName: f.set || undefined,
        rarities: f.rarity && !rareAndAbove ? [...(group?.spellings ?? [f.rarity])] : undefined,
        excludeRarities: rareAndAbove ? [...BELOW_RARE_SPELLINGS] : undefined,
        dealsOnly: f.dealsOnly || undefined,
        acceptsOffers: f.acceptsOffers || undefined,
        sort: f.sort,
    };
}

const SORTS: readonly ListingSort[] = ['best_deals', 'newest', 'price_asc', 'price_desc'];

// Whole baht and in range, or the default: a hand-edited URL must not reach the query.
function parsePrice(value: string | null, fallback: number): number {
    const n = Number(value);
    return value && Number.isInteger(n) && n >= 0 && n <= PRICE_NO_MAX ? n : fallback;
}

/** Reads the state from a URL. Anything unknown falls back, rather than filtering to nothing. */
export function parseMarketplaceFilters(params: Pick<URLSearchParams, 'get'> | null | undefined): MarketplaceFilterState {
    const get = (key: string) => params?.get(key) ?? null;
    const gameParam = get('game') ?? '';
    const game = GAMES.some((g) => g.id === gameParam) ? gameParam : DEFAULT_MARKETPLACE_FILTERS.game;
    const section = get('section') === 'sealed' ? 'sealed' : 'singles';

    const gradingParam = get('grading');
    const graded = gradingParam === 'graded';
    const companyParam = get('company') ?? '';
    const minGradeParam = Number(get('minGrade'));
    const grading: GradingFilter = {
        grading: graded ? 'graded' : gradingParam === 'raw' ? 'raw' : 'any',
        gradingCompany: graded && (LISTING_GRADING_COMPANIES as readonly string[]).includes(companyParam) ? companyParam : '',
        minGrade: graded && (MIN_GRADE_OPTIONS as readonly number[]).includes(minGradeParam) ? minGradeParam : 0,
    };

    const conditionParam = get('condition') ?? '';
    const sortParam = get('sort') as ListingSort | null;

    return {
        game,
        section,
        language: languageForGame(game, get('language') ?? ''),
        grading,
        condition: grading.grading === 'raw' && (LISTING_CONDITIONS as readonly string[]).includes(conditionParam) ? conditionParam : '',
        priceMin: parsePrice(get('min'), 0),
        priceMax: parsePrice(get('max'), PRICE_NO_MAX),
        set: facetKey(get('set') ?? ''),
        rarity: facetKey(get('rarity') ?? ''),
        dealsOnly: get('deals') === '1',
        acceptsOffers: get('offers') === '1',
        sort: sortParam && SORTS.includes(sortParam) ? sortParam : DEFAULT_MARKETPLACE_FILTERS.sort,
    };
}

/**
 * Writes the state onto a URL's params in place, leaving every other param
 * (q, UTMs) alone. Defaults are removed, so an unfiltered page keeps a clean URL.
 */
export function writeMarketplaceFilters(params: URLSearchParams, f: MarketplaceFilterState): void {
    const put = (key: string, value: string | number | false) => {
        if (value === false || value === '') params.delete(key);
        else params.set(key, String(value));
    };
    put('game', f.game !== 'all' && f.game);
    put('section', f.section !== 'singles' && f.section);
    put('language', f.language !== 'all' && f.language);
    put('grading', f.grading.grading !== 'any' && f.grading.grading);
    put('company', f.grading.gradingCompany);
    put('minGrade', f.grading.minGrade > 0 && f.grading.minGrade);
    put('condition', f.condition);
    put('min', f.priceMin > 0 && f.priceMin);
    put('max', f.priceMax < PRICE_NO_MAX && f.priceMax);
    put('set', f.set);
    put('rarity', f.rarity);
    put('deals', f.dealsOnly && '1');
    put('offers', f.acceptsOffers && '1');
    put('sort', f.sort !== DEFAULT_MARKETPLACE_FILTERS.sort && f.sort);
}
