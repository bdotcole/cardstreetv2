'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { marketplaceService, MarketplaceListing, type ListingFacets } from '@/services/marketplaceService';
import { pokemonService } from '@/services/pokemonService';
import { preloadSearchDictionary } from '@/lib/search/dictionary';
import { isFailedResult } from '@/lib/search/failedResult';
import { trackSearch } from '@/lib/searchEvents';
import type { Card } from '@/types';
import { getOptimizedImageUrl, getPreviewUrl, getThumbnailUrl, shouldSkipNextOptimization, CARD_BLUR_DATA_URL } from '@/lib/imageUtils';
import { GAMES } from '@/lib/games';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import DesktopFaqTeaser from '@/components/desktop/DesktopFaqTeaser';
import MarketMovers, { MARKET_MOVERS_ENABLED } from '@/components/MarketMovers';
import OfferModal from '@/components/OfferModal';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import ShippingNote from '@/components/ShippingNote';
import { showShippingNoteOnTile } from '@/lib/shippingDisplay';
import { getSellerTrust } from '@/lib/sellerTrust';
import { useConditionTranslation } from '@/lib/hooks/useCardTranslations';
import {
    getDealPercent,
    conditionBadgeLabel,
    LISTING_CONDITIONS,
    LISTING_GRADING_COMPANIES,
    MIN_GRADE_OPTIONS,
    minGradeLabel,
    NO_GRADING_FILTER,
} from '@/lib/listingDisplay';
import {
    PRICE_NO_MAX,
    PRICE_PRESETS,
    RARITY_RARE_AND_ABOVE,
    clearFilters,
    countActiveFilters,
    languageForGame,
    languageOptionsForGame,
    parseMarketplaceFilters,
    priceRangeFromInputs,
    rarityFilterOptions,
    setFilterOptions,
    toListingQuery,
    writeMarketplaceFilters,
    type MarketplaceFilterState,
} from '@/lib/listingFilters';
import CustomSelect from '@/components/CustomSelect';
import { groupSiblingListings, listingUnits } from '@/lib/listingSiblings';
import { formatTHB } from '@/lib/currency';
import SnipeBadge, { isSnipeListing } from '@/components/SnipeBadge';
import GradedSlabFrame from '@/components/GradedSlabFrame';
import ListingWatchBadge from '@/components/ListingWatchBadge';
import AuthModal from '@/components/AuthModal';
import { CartItem } from '@/types';

const PAGE_SIZE = 60;

// OBO offers are behind a single build-time flag; when off, every tile shows
// "Buy Now" regardless of a listing's accepts_offers value.
const OFFERS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

// Language values match the listing snapshot's `card_data.language`. The service
// expands 'ja' to also cover sealed's 'jp' code, so a single option covers both.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
    en: 'desktop.english',
    ja: 'desktop.japanese',
    th: 'desktop.thai',
};

// Re-exported for the desktop components that historically imported it here.
export { formatTHB };

const filterLabelClass = 'text-[10px] font-black uppercase tracking-widest text-slate-500 mr-1';

const filterSelectClass = (active: boolean) =>
    `w-full h-8 rounded-full border px-3 text-[11px] font-bold outline-none transition-colors ${
        active
            ? 'bg-brand-green border-brand-green text-brand-darker'
            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
    }`;

const priceInputText = (value: number, none: number) => (value === none ? '' : String(value));

export function listingToCartItem(listing: MarketplaceListing): CartItem {
    return {
        id: listing.id,
        cardId: listing.card_id,
        card: listing.card_data,
        price: listing.price,
        sellerId: listing.seller_id,
        sellerName: listing.seller?.display_name || 'Unknown Seller',
        condition: listing.condition,
    };
}

export default function DesktopMarketplace({ pathPrefix = '' }: {
    // '' on the Thai canonical, '/en' under the English prefix. Resolved by the
    // server page and passed down as a plain string, because lib/i18nRouting
    // imports next/headers.
    pathPrefix?: string;
}) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { t } = useTranslation();
    const conditionLabel = useConditionTranslation();
    const { showToast } = useToast();
    const q = searchParams?.get('q') ?? '';

    // OBO: listing whose "Make an offer" modal is open (from a grid tile). The
    // tile only surfaces the button to a signed-in buyer, so opening the modal
    // needs no auth gate here.
    const [offerListing, setOfferListing] = useState<MarketplaceListing | null>(null);

    // OBO: the offer-email CTA deep-links to /?view=offers; on desktop the
    // middleware rewrites that to the desktop home. Forward it to the Offers
    // inbox tab (the desktop offers inbox lives under /orders). The accepted-
    // offer pay link (/pay/<id> -> /?payOffer=<id>) lands here the same way and
    // used to stop at the homepage; it rides along so DesktopOrders can open
    // the payment. Gated on the offers flag so it's inert when off.
    useEffect(() => {
        if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') return;
        const payOffer = searchParams?.get('payOffer');
        if (payOffer) {
            router.replace(`${pathPrefix}/orders?tab=offers&payOffer=${encodeURIComponent(payOffer)}`);
        } else if (searchParams?.get('view') === 'offers') {
            router.replace(`${pathPrefix}/orders?tab=offers`);
        }
    }, [searchParams, router, pathPrefix]);

    // Seeded from the URL (game landing pages link ?game=<id>, and Back from a
    // card page lands on the filters the buyer left). The chips own it from
    // then on and the URL follows them, so a later click is not fought by it.
    const [filters, setFilters] = useState<MarketplaceFilterState>(() => parseMarketplaceFilters(searchParams));
    const { game, language, section, grading, condition, priceMin, priceMax, set, rarity, dealsOnly, acceptsOffers, sort } = filters;
    const patchFilters = (patch: Partial<MarketplaceFilterState>) => setFilters((f) => ({ ...f, ...patch }));
    const singles = section === 'singles';

    useEffect(() => {
        const url = new URL(window.location.href);
        const before = url.search;
        writeMarketplaceFilters(url.searchParams, filters);
        if (url.search !== before) window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        // searchParams: a nav search lands on a bare /?q= and must get the filters back.
    }, [filters, searchParams]);

    // Sign-in wall for a signed-out Watch tap on a tile.
    const [authOpen, setAuthOpen] = useState(false);

    const languageOptions = languageOptionsForGame(game);

    const selectGame = (g: string) => {
        patchFilters({
            game: g,
            language: languageForGame(g, language),
            // Sets belong to one game.
            set: '',
        });
    };

    // The boxes hold what was typed; the filter takes it once the typing pauses,
    // so a price costs one fetch rather than one per digit.
    const [minInput, setMinInput] = useState(priceInputText(priceMin, 0));
    const [maxInput, setMaxInput] = useState(priceInputText(priceMax, PRICE_NO_MAX));
    useEffect(() => {
        const timer = setTimeout(() => {
            const [min, max] = priceRangeFromInputs(minInput, maxInput);
            setFilters((f) => (f.priceMin === min && f.priceMax === max ? f : { ...f, priceMin: min, priceMax: max }));
        }, 500);
        return () => clearTimeout(timer);
    }, [minInput, maxInput]);
    const selectPrice = (min: number, max: number) => {
        setMinInput(priceInputText(min, 0));
        setMaxInput(priceInputText(max, PRICE_NO_MAX));
        patchFilters({ priceMin: min, priceMax: max });
    };
    // A fixed locale: these labels render on the server too, and a browser whose
    // locale groups digits differently would otherwise fail hydration on them.
    const baht = (n: number) => `฿${n.toLocaleString('en-US')}`;
    const priceLabel = (min: number, max: number) => {
        if (min === 0) return t('desktop.priceUnder').replace('{price}', baht(max));
        if (max === PRICE_NO_MAX) return `${baht(min)}+`;
        return `${baht(min)}–${max.toLocaleString('en-US')}`;
    };

    const activeFilterCount = countActiveFilters(filters);
    const clearAllFilters = () => {
        setFilters(clearFilters);
        setMinInput('');
        setMaxInput('');
    };

    // The Set and Rarity lists are read the first time a buyer reaches for
    // either one, not on every homepage view: this walks all active listings
    // for one column pair. A filter arriving by URL needs its label right away.
    const [facetsWanted, setFacetsWanted] = useState(!!set || !!rarity);
    const wantFacets = () => setFacetsWanted(true);
    const [facets, setFacets] = useState<ListingFacets | null>(null);
    useEffect(() => {
        if (!facetsWanted) return;
        let cancelled = false;
        setFacets(null);
        marketplaceService
            .getListingFacets({ game, kind: section, language: language === 'all' ? undefined : language })
            .then((next) => { if (!cancelled) setFacets(next); });
        return () => {
            cancelled = true;
        };
    }, [facetsWanted, game, section, language]);
    const setOptions = useMemo(() => (facets ? setFilterOptions(facets.sets) : null), [facets]);
    const rarityOptions = useMemo(() => (facets ? rarityFilterOptions(facets.rarities) : null), [facets]);

    // A set or rarity the new scope has no stock of goes, instead of holding the
    // grid empty behind a choice the dropdown no longer lists. Rarity is left
    // alone on Sealed, which ignores it and has none to compare with.
    useEffect(() => {
        if (!setOptions || !rarityOptions) return;
        setFilters((f) => {
            const setGone = !!f.set && !setOptions.some((o) => o.value === f.set);
            const rarityGone = f.section === 'singles'
                && !!f.rarity
                && f.rarity !== RARITY_RARE_AND_ABOVE
                && !rarityOptions.some((o) => o.value === f.rarity);
            if (!setGone && !rarityGone) return f;
            return { ...f, set: setGone ? '' : f.set, rarity: rarityGone ? '' : f.rarity };
        });
    }, [setOptions, rarityOptions]);

    // A value from the URL shows under its own text until the list arrives, and
    // "Loading" stands in for the rest.
    const facetSelectOptions = (
        anyLabel: string,
        options: Array<{ value: string; label: string }> | null,
        current: string,
        extra: Array<{ value: string; label: string }> = [],
    ) => [
        { value: '', label: anyLabel },
        ...extra,
        ...(options ?? [
            ...(current && !extra.some((o) => o.value === current) ? [{ value: current, label: current }] : []),
            { value: '__loading', label: t('desktop.loading'), disabled: true },
        ]),
    ];

    const [listings, setListings] = useState<MarketplaceListing[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);

    // Demand capture on a dead end: a /?q= search with no listings shows the
    // catalog cards it matched, each linking to its card page where the
    // visitor can wishlist it (alerted when a seller lists) or sell their own.
    //
    // Only once the listings fetch for the term has come back empty: a catalog
    // search is several catalog queries per term, and running it alongside
    // every listings search paid for a panel only an empty result shows.
    const [emptySearch, setEmptySearch] = useState<string | null>(null);
    const [catalogMatches, setCatalogMatches] = useState<Card[]>([]);
    useEffect(() => {
        const term = (emptySearch ?? '').trim();
        // Drop the previous term's matches up front, so the empty state never
        // shows them under the new term's heading while its search runs.
        setCatalogMatches([]);
        if (term.length < 3) return;
        // Aborted when the term changes, so a superseded search stops at its
        // next stage instead of running every catalog query to completion.
        const controller = new AbortController();
        pokemonService.searchCards(term, false, undefined, 'all', { signal: controller.signal })
            .then((cards) => { if (!controller.signal.aborted) setCatalogMatches(cards.slice(0, 4)); })
            .catch(() => { if (!controller.signal.aborted) setCatalogMatches([]); });
        return () => controller.abort();
    }, [emptySearch]);

    // GA4 `search` fires once per distinct /?q= term, not again when only a
    // filter chip or the sort changes.
    const lastTrackedSearchRef = useRef('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        // A /?q= page opened cold (a shared link, the SearchAction) has not
        // loaded the name dictionary the nav box preloads on focus. Start it,
        // typo index included, for the listings search and its fallbacks.
        if (q.trim()) preloadSearchDictionary();
        marketplaceService
            .getActiveListings({ ...toListingQuery(filters, q), limit: PAGE_SIZE })
            .then((rows) => {
                if (cancelled) return;
                // Identical copies fold into one tile with a unit count
                // (lib/listingSiblings.ts); hasMore reads the raw page size.
                setListings(groupSiblingListings(rows));
                setHasMore(rows.length === PAGE_SIZE);
                const term = q.trim();
                setEmptySearch(term && rows.length === 0 ? term : null);
                if (!term) {
                    lastTrackedSearchRef.current = '';
                } else if (term !== lastTrackedSearchRef.current) {
                    lastTrackedSearchRef.current = term;
                    // A failed fetch shows the same empty grid as a miss, but is not one.
                    trackSearch({ term, resultsCount: isFailedResult(rows) ? null : rows.length, surface: 'desktop_marketplace' });
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [q, filters]);

    const loadMore = async () => {
        setLoadingMore(true);
        try {
            const rows = await marketplaceService.getActiveListings({
                ...toListingQuery(filters, q),
                limit: PAGE_SIZE,
                // Rows, not tiles: a tile folds identical copies, so counting
                // tiles re-reads rows already loaded and can stall the button on
                // a page of them (one set from one bulk seller, say).
                offset: listings.reduce((count, l) => count + listingUnits(l), 0),
            });
            // Offset pagination over a live list: a listing created mid-browse
            // shifts the pages, so drop anything already rendered.
            setListings((prev) => {
                const seen = new Set(prev.flatMap((l) => l.siblingIds ?? [l.id]));
                return groupSiblingListings([...prev, ...rows.filter((r) => !seen.has(r.id))]);
            });
            setHasMore(rows.length === PAGE_SIZE);
        } finally {
            setLoadingMore(false);
        }
    };

    return (
        <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white">{t('desktop.marketplaceTitle')}</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        {q ? (
                            <>{t('desktop.resultsFor')} <span className="text-white font-bold">&ldquo;{q}&rdquo;</span></>
                        ) : (
                            t('desktop.liveListings')
                        )}
                    </p>
                </div>

                <div className="w-52">
                    <CustomSelect
                        value={sort}
                        onChange={(v) => patchFilters({ sort: v as MarketplaceFilterState['sort'] })}
                        ariaLabel={t('marketplace.sortBy')}
                        triggerClassName="w-full h-10 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white outline-none focus:border-brand-cyan/50"
                        options={[
                            { value: 'best_deals', label: t('desktop.sortBestDeals') },
                            { value: 'newest', label: t('desktop.sortNewest') },
                            { value: 'price_asc', label: t('desktop.sortPriceAsc') },
                            { value: 'price_desc', label: t('desktop.sortPriceDesc') },
                        ]}
                    />
                </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-6">
                {/* Singles / Sealed, matching the mobile shop screen. A section,
                    not a filter chip — see ListingKind in marketplaceService. */}
                <div className="flex gap-1 bg-white/5 border border-white/10 rounded-full p-1 mr-2">
                    {([
                        { id: 'singles' as const, label: t('marketplace.sectionSingles') },
                        { id: 'sealed' as const, label: t('marketplace.sectionSealed') },
                    ]).map(({ id, label }) => (
                        <button
                            key={id}
                            // Sealed products and singles share no set names.
                            onClick={() => patchFilters({ section: id, set: '' })}
                            className={`px-4 py-1 rounded-full text-xs font-bold transition-colors ${
                                section === id ? 'bg-brand-cyan text-brand-darker' : 'text-slate-300 hover:text-white'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <FilterChip label={t('desktop.allGames')} active={game === 'all'} onClick={() => selectGame('all')} />
                {GAMES.filter((g) => g.enabled).map((g) => (
                    <FilterChip key={g.id} label={g.shortName} active={game === g.id} onClick={() => selectGame(g.id)} />
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-3">
                {/* Language: every catalog language until a game narrows it. Hidden
                    for a game with only one, where there is nothing to choose. */}
                {languageOptions.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={filterLabelClass}>{t('desktop.browse.language')}</span>
                        <FilterChip
                            label={t('desktop.browse.allLanguages')}
                            active={language === 'all'}
                            tone="green"
                            small
                            onClick={() => patchFilters({ language: 'all' })}
                        />
                        {languageOptions.map((l) => (
                            <FilterChip
                                key={l}
                                label={t(LANGUAGE_LABEL_KEYS[l] ?? l)}
                                active={language === l}
                                tone="green"
                                small
                                onClick={() => patchFilters({ language: l })}
                            />
                        ))}
                    </div>
                )}

                {/* Grading: singles only; a sealed product is never graded. Graded
                    opens company and grade floor, Raw opens condition, each only
                    meaningful on that side (a slab has a grade, not a condition). */}
                {singles && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={filterLabelClass}>{t('marketplace.grading')}</span>
                        {([
                            { id: 'any' as const, label: t('marketplace.gradingAny') },
                            { id: 'raw' as const, label: t('marketplace.gradingRaw') },
                            { id: 'graded' as const, label: t('marketplace.gradingGraded') },
                        ]).map(({ id, label }) => (
                            <FilterChip
                                key={id}
                                label={label}
                                active={grading.grading === id}
                                tone="green"
                                small
                                onClick={() => patchFilters({
                                    grading: id === 'graded' ? { ...grading, grading: 'graded' } : { ...NO_GRADING_FILTER, grading: id },
                                    condition: id === 'raw' ? condition : '',
                                })}
                            />
                        ))}
                        {grading.grading === 'raw' && (
                            <>
                                <span className="w-px h-4 bg-white/10 mx-1" aria-hidden="true"></span>
                                <FilterChip
                                    label={t('desktop.anyCondition')}
                                    active={!condition}
                                    tone="green"
                                    small
                                    onClick={() => patchFilters({ condition: '' })}
                                />
                                {LISTING_CONDITIONS.map((c) => (
                                    <FilterChip
                                        key={c}
                                        label={conditionLabel(c)}
                                        active={condition === c}
                                        tone="green"
                                        small
                                        onClick={() => patchFilters({ condition: c })}
                                    />
                                ))}
                            </>
                        )}
                        {grading.grading === 'graded' && (
                            <>
                                <span className="w-px h-4 bg-white/10 mx-1" aria-hidden="true"></span>
                                <FilterChip
                                    label={t('marketplace.anyCompany')}
                                    active={!grading.gradingCompany}
                                    tone="green"
                                    small
                                    onClick={() => patchFilters({ grading: { ...grading, gradingCompany: '' } })}
                                />
                                {LISTING_GRADING_COMPANIES.map((company) => (
                                    <FilterChip
                                        key={company}
                                        label={company}
                                        active={grading.gradingCompany === company}
                                        tone="green"
                                        small
                                        onClick={() => patchFilters({ grading: { ...grading, gradingCompany: company } })}
                                    />
                                ))}
                                <span className="w-px h-4 bg-white/10 mx-1" aria-hidden="true"></span>
                                <FilterChip
                                    label={t('marketplace.anyGrade')}
                                    active={grading.minGrade === 0}
                                    tone="green"
                                    small
                                    onClick={() => patchFilters({ grading: { ...grading, minGrade: 0 } })}
                                />
                                {MIN_GRADE_OPTIONS.map((g) => (
                                    <FilterChip
                                        key={g}
                                        label={minGradeLabel(g)}
                                        active={grading.minGrade === g}
                                        tone="green"
                                        small
                                        onClick={() => patchFilters({ grading: { ...grading, minGrade: g } })}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Price: one click for a band, or any range typed in. */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className={filterLabelClass}>{t('marketplace.priceRange')}</span>
                <FilterChip
                    label={t('marketplace.anyPrice')}
                    active={priceMin === 0 && priceMax === PRICE_NO_MAX}
                    tone="green"
                    small
                    onClick={() => selectPrice(0, PRICE_NO_MAX)}
                />
                {PRICE_PRESETS.map(([min, max]) => (
                    <FilterChip
                        key={min}
                        label={priceLabel(min, max)}
                        active={priceMin === min && priceMax === max}
                        tone="green"
                        small
                        onClick={() => selectPrice(min, max)}
                    />
                ))}
                <span className="w-px h-4 bg-white/10 mx-1" aria-hidden="true"></span>
                <PriceInput label={t('marketplace.minPrice')} value={minInput} onChange={setMinInput} />
                <span className="text-slate-600 text-xs" aria-hidden="true">–</span>
                <PriceInput label={t('marketplace.maxPrice')} value={maxInput} onChange={setMaxInput} />
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
                <div className="w-60" onPointerEnter={wantFacets} onFocus={wantFacets}>
                    <CustomSelect
                        value={set}
                        onChange={(v) => patchFilters({ set: v })}
                        ariaLabel={t('desktop.filterSet')}
                        triggerClassName={filterSelectClass(!!set)}
                        listMaxHeight={360}
                        options={facetSelectOptions(t('desktop.allSets'), setOptions, set)}
                    />
                </div>
                {/* Singles only, like grading: sealed stores 'Sealed' as its rarity. */}
                {singles && (
                    <div className="w-60" onPointerEnter={wantFacets} onFocus={wantFacets}>
                        <CustomSelect
                            value={rarity}
                            onChange={(v) => patchFilters({ rarity: v })}
                            ariaLabel={t('desktop.filterRarity')}
                            triggerClassName={filterSelectClass(!!rarity)}
                            listMaxHeight={360}
                            options={facetSelectOptions(t('desktop.anyRarity'), rarityOptions, rarity, [
                                { value: RARITY_RARE_AND_ABOVE, label: t('desktop.rareAndAbove') },
                            ])}
                        />
                    </div>
                )}
                <FilterChip
                    label={t('desktop.dealsOnly')}
                    active={dealsOnly}
                    tone="green"
                    small
                    onClick={() => patchFilters({ dealsOnly: !dealsOnly })}
                />
                {OFFERS_ENABLED && (
                    <FilterChip
                        label={t('desktop.acceptsOffers')}
                        active={acceptsOffers}
                        tone="green"
                        small
                        onClick={() => patchFilters({ acceptsOffers: !acceptsOffers })}
                    />
                )}
                {activeFilterCount > 0 && (
                    <button
                        onClick={clearAllFilters}
                        className="ml-1 text-[11px] font-bold text-slate-400 hover:text-white underline underline-offset-2 transition-colors"
                    >
                        {t('marketplace.clearFilters')}
                    </button>
                )}
            </div>

            {loading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="rounded-2xl bg-white/5 animate-pulse aspect-[3/4.7]"></div>
                    ))}
                </div>
            ) : listings.length === 0 ? (
                <div className="text-center py-24">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                        <i className="fa-solid fa-satellite-dish text-2xl text-slate-600"></i>
                    </div>
                    <h2 className="text-white font-bold uppercase tracking-widest text-sm mb-1">{t('desktop.noListingsTitle')}</h2>
                    <p className="text-slate-500 text-sm">{t('desktop.noListingsDesc')}</p>
                    {activeFilterCount > 0 && (
                        <button
                            onClick={clearAllFilters}
                            className="mt-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold px-5 py-2 rounded-xl transition-colors"
                        >
                            {t('marketplace.clearFilters')}
                        </button>
                    )}
                    {catalogMatches.length > 0 && (
                        <div className="mt-8 text-left max-w-md mx-auto">
                            <p className="text-slate-300 text-sm font-bold mb-1">{t('searchFallback.title').replace('{q}', q.trim())}</p>
                            <p className="text-slate-500 text-xs mb-3">{t('searchFallback.hint')}</p>
                            <div className="space-y-2">
                                {catalogMatches.map((card) => (
                                    <Link
                                        key={card.id}
                                        href={`${pathPrefix}/card/${card.id}`}
                                        className="flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                                    >
                                        <span className="w-10 h-14 rounded-md overflow-hidden bg-brand-darker flex-shrink-0">
                                            {card.images?.small && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={getThumbnailUrl(card.images.small)} alt="" loading="lazy" className="w-full h-full object-cover" />
                                            )}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-white text-sm font-bold truncate">{card.name}</span>
                                            <span className="block text-slate-500 text-[11px] truncate">
                                                {card.set}{card.marketPrice ? ` · ${formatTHB(card.marketPrice)}` : ''}
                                            </span>
                                        </span>
                                        <span className="text-brand-cyan text-[10px] font-black uppercase tracking-widest">{t('searchFallback.viewCard')}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                        {listings.map((listing, idx) => (
                            <ListingTile
                                key={listing.id}
                                listing={listing}
                                eager={idx < 6}
                                onMakeOffer={setOfferListing}
                                onRequireAuth={() => setAuthOpen(true)}
                                pathPrefix={pathPrefix}
                            />
                        ))}
                    </div>

                    {hasMore && (
                        <div className="flex justify-center mt-10">
                            <button
                                onClick={loadMore}
                                disabled={loadingMore}
                                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold px-8 py-3 rounded-xl transition-colors disabled:opacity-50"
                            >
                                {loadingMore ? t('desktop.loading') : t('desktop.loadMore')}
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Homepage only, like the FAQ teaser: hidden once the visitor searches.
                Off for everyone until a better UI exists; see MARKET_MOVERS_ENABLED. */}
            {MARKET_MOVERS_ENABLED && !q && section === 'singles' && <MarketMovers game={game} pathPrefix={pathPrefix} className="mt-12" />}

            {/* Homepage only: the FAQ teaser is a marketing/SEO surface, not a
                search result. Hidden once the visitor is actively searching. */}
            {!q && <DesktopFaqTeaser pathPrefix={pathPrefix} />}

            {OFFERS_ENABLED && offerListing && (
                <OfferModal
                    listingId={offerListing.id}
                    listingPrice={offerListing.price}
                    cardName={offerListing.card_data?.name || ''}
                    onClose={() => setOfferListing(null)}
                    onSubmitted={() => showToast(t('offer.submitted'), 'success')}
                />
            )}

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} contextMessage={t('authGate.watch')} />
        </div>
    );
}

function FilterChip({
    label,
    active,
    onClick,
    tone = 'cyan',
    small,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    tone?: 'cyan' | 'green';
    small?: boolean;
}) {
    const activeClass = tone === 'green' ? 'bg-brand-green text-brand-darker' : 'bg-brand-cyan text-brand-darker';
    return (
        <button
            onClick={onClick}
            className={`rounded-full font-bold transition-colors ${small ? 'px-3 py-1 text-[11px]' : 'px-4 py-1.5 text-xs'} ${
                active ? activeClass : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
            }`}
        >
            {label}
        </button>
    );
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <span className="flex items-center h-7 w-24 rounded-full bg-white/5 border border-white/10 focus-within:border-brand-green/50 px-3 transition-colors">
            <span className="text-slate-500 text-[11px] font-bold mr-1" aria-hidden="true">฿</span>
            <input
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
                placeholder={label}
                aria-label={label}
                className="w-full min-w-0 bg-transparent text-[11px] font-bold text-white placeholder:text-slate-500 outline-none"
            />
        </span>
    );
}

function ListingTile({ listing, eager, onMakeOffer, onRequireAuth, pathPrefix = '' }: {
    listing: MarketplaceListing;
    eager: boolean;
    onMakeOffer: (listing: MarketplaceListing) => void;
    onRequireAuth: () => void;
    pathPrefix?: string;
}) {
    const { buyNow, user } = useDesktopCart();
    const { t } = useTranslation();
    // Catalog art is the default; if its host is unreachable (TCGdex outages
    // black out most EN card art) fall back to the seller's condition photo,
    // which lives in our own Supabase storage.
    const [catalogArtFailed, setCatalogArtFailed] = useState(false);
    const catalogUrl = getPreviewUrl(listing.card_data.images?.small || listing.card_data.imageUrl);
    const imageUrl = catalogArtFailed && listing.image_front_url
        ? getOptimizedImageUrl(listing.image_front_url, 300, 80)
        : catalogUrl;
    const dealPct = getDealPercent(listing.price, listing.card_data.marketPrice);
    // Graded listings render inside the slab frame; the deal badge drops below
    // its label bar.
    const slabbed = !!listing.is_graded && !!listing.grading_company;
    // Show "Make Offer" only on offer-accepting listings, and only to a signed-in
    // buyer who isn't the seller. Everyone else (incl. signed-out visitors and
    // the flag-off case) gets "Buy Now".
    const showMakeOffer =
        OFFERS_ENABLED && listing.accepts_offers === true && !!user && user.id !== listing.seller_id;
    return (
        <Link
            href={`${pathPrefix}/card/${listing.card_id}`}
            className="group bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 transition-all"
        >
            {/* Extra wrapper lets the snipe badge hang past the image's
                overflow-hidden edge, straddling the image/details boundary. */}
            <div className="relative">
                <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                    <GradedSlabFrame company={slabbed ? listing.grading_company : null} grade={listing.grade} size="md" title={listing.card_data.name} subtitle={listing.card_data.set}>
                        <Image
                            src={imageUrl}
                            alt={listing.card_data.name || 'Card'}
                            fill
                            sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                            loading={eager ? 'eager' : 'lazy'}
                            placeholder="blur"
                            blurDataURL={CARD_BLUR_DATA_URL}
                            unoptimized={shouldSkipNextOptimization(imageUrl)}
                            onError={() => setCatalogArtFailed(true)}
                            className={`group-hover:scale-[1.03] transition-transform duration-300 ${listing.card_data.isSealed ? 'object-contain p-3' : slabbed ? 'object-contain' : 'object-cover'}`}
                        />
                    </GradedSlabFrame>
                    {dealPct !== null && (
                        <span className={`absolute left-2 bg-brand-green text-brand-darker text-[10px] font-black px-2 py-0.5 rounded-md shadow-lg shadow-black/40 ${slabbed ? 'top-16' : 'top-2'}`}>
                            -{dealPct}%
                        </span>
                    )}
                    {/* Watchers in the top-right corner: the nudge for a buyer on
                        the fence. Below the slab label on graded tiles. */}
                    <ListingWatchBadge
                        listing={listing}
                        onRequireAuth={onRequireAuth}
                        size="md"
                        className={`absolute right-0.5 z-10 ${slabbed ? 'top-14' : 'top-0.5'}`}
                    />
                    {listingUnits(listing) > 1 && (
                        <span
                            title={t('cart.available').replace('{n}', String(listingUnits(listing)))}
                            className="absolute bottom-2 left-2 z-10 text-[10px] font-black px-2 py-0.5 rounded-md bg-black/60 text-white border border-white/10 backdrop-blur-sm"
                        >
                            ×{listingUnits(listing)}
                        </span>
                    )}
                </div>
                {isSnipeListing(listing.price) && (
                    <SnipeBadge className="absolute -bottom-3 right-2 z-10 h-14 w-auto" />
                )}
            </div>
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-white truncate">{listing.card_data.name}</h3>
                    <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded border bg-slate-700/60 text-slate-300 border-slate-600">
                        {conditionBadgeLabel(listing)}
                    </span>
                </div>
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                    {listing.card_data.set}
                </p>
                <div className="flex items-baseline gap-1.5 min-w-0 mt-2">
                    <p className="text-lg font-black text-brand-cyan">{formatTHB(listing.price)}</p>
                    {dealPct !== null && (
                        <p className="text-[11px] text-slate-500 font-bold line-through truncate">
                            {formatTHB(listing.card_data.marketPrice)}
                        </p>
                    )}
                </div>
                {/* Cheap cards only — same threshold and reason as the mobile grid. */}
                {showShippingNoteOnTile(listing.price) && <ShippingNote variant="short" className="block" />}
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-400">
                    <span className="w-4 h-4 rounded-full bg-slate-700 overflow-hidden shrink-0">
                        {listing.seller?.avatar_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={listing.seller.avatar_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                        )}
                    </span>
                    <span className="truncate font-bold">{listing.seller?.display_name || t('desktop.unknownSeller')}</span>
                    {getSellerTrust(listing.seller).kind === 'partner' && (
                        <span className="text-brand-cyan font-bold whitespace-nowrap flex items-center gap-0.5 shrink-0">
                            <i className="fa-solid fa-circle-check"></i>
                            {t('seller.officialPartner')}
                        </span>
                    )}
                </div>

                {/* Primary action: Make Offer (OBO) or Buy Now (straight to payment) */}
                {showMakeOffer ? (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onMakeOffer(listing);
                        }}
                        className="mt-3 w-full py-2 rounded-lg bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/40 text-brand-cyan text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                        aria-label={`Make an offer on ${listing.card_data.name}`}
                    >
                        <i className="fa-solid fa-hand-holding-dollar"></i>
                        {t('offer.makeOffer')}
                    </button>
                ) : (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            buyNow(listingToCartItem(listing));
                        }}
                        className="mt-3 w-full py-2 rounded-lg bg-brand-green hover:bg-brand-green/90 text-brand-darker text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                        aria-label={`Buy ${listing.card_data.name} now`}
                    >
                        <i className="fa-solid fa-bolt"></i>
                        {t('marketplace.buyNow')}
                    </button>
                )}
            </div>
        </Link>
    );
}
