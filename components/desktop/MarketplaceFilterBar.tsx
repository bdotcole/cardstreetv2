'use client'

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GAMES } from '@/lib/games';
import { marketplaceService, type ListingFacets } from '@/services/marketplaceService';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useConditionTranslation } from '@/lib/hooks/useCardTranslations';
import {
    LISTING_CONDITIONS,
    LISTING_GRADING_COMPANIES,
    MIN_GRADE_OPTIONS,
    NO_GRADING_FILTER,
    gradingFilterLabel,
    minGradeLabel,
} from '@/lib/listingDisplay';
import {
    PRICE_NO_MAX,
    PRICE_PRESETS,
    RARITY_RARE_AND_ABOVE,
    clearFilters,
    countActiveFilters,
    languageForGame,
    languageOptionsForGame,
    priceRangeFromInputs,
    rarityFilterOptions,
    setFilterOptions,
    type FilterOption,
    type MarketplaceFilterState,
} from '@/lib/listingFilters';
import CustomSelect from '@/components/CustomSelect';

/**
 * The desktop marketplace toolbar: Singles/Sealed and the game tabs on one
 * line, then one row of dropdown pills. A pill names its filter until a value
 * is chosen and shows the value after, so the whole state reads at a glance
 * and nothing is laid out on the page until it is asked for. The previous bar
 * put every option of every filter on screen (four rows of chips) and read as
 * a form to fill in before browsing.
 */

// Language values match the listing snapshot's `card_data.language`. The service
// expands 'ja' to also cover sealed's 'jp' code, so a single option covers both.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
    en: 'desktop.english',
    ja: 'desktop.japanese',
    th: 'desktop.thai',
};

const priceInputText = (value: number, none: number) => (value === none ? '' : String(value));

const PILL_ACTIVE = 'border-brand-cyan/50 bg-brand-cyan/15 text-white';
const PILL_IDLE = 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10';

export default function MarketplaceFilterBar({ filters, setFilters, offersEnabled }: {
    filters: MarketplaceFilterState;
    setFilters: React.Dispatch<React.SetStateAction<MarketplaceFilterState>>;
    offersEnabled: boolean;
}) {
    const { t } = useTranslation();
    const conditionLabel = useConditionTranslation();
    const { game, language, section, grading, condition, priceMin, priceMax, set, rarity, dealsOnly, acceptsOffers, sort } = filters;
    const patch = (next: Partial<MarketplaceFilterState>) => setFilters((f) => ({ ...f, ...next }));
    const singles = section === 'singles';

    const languageOptions = languageOptionsForGame(game);
    const selectGame = (g: string) => {
        patch({
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
    }, [minInput, maxInput, setFilters]);
    // A range set from outside the boxes (a band, Clear all, the empty state's
    // button) shows in them; a range they produced themselves is left alone, so
    // typing is never undone under the cursor.
    useEffect(() => {
        const [min, max] = priceRangeFromInputs(minInput, maxInput);
        if (min === priceMin && max === priceMax) return;
        setMinInput(priceInputText(priceMin, 0));
        setMaxInput(priceInputText(priceMax, PRICE_NO_MAX));
        // minInput/maxInput: only a change of the applied range should sync the boxes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [priceMin, priceMax]);
    const selectPrice = (min: number, max: number) => {
        setMinInput(priceInputText(min, 0));
        setMaxInput(priceInputText(max, PRICE_NO_MAX));
        patch({ priceMin: min, priceMax: max });
    };
    const commitTypedPrice = () => {
        const [min, max] = priceRangeFromInputs(minInput, maxInput);
        patch({ priceMin: min, priceMax: max });
    };
    // A fixed locale: these labels render on the server too, and a browser whose
    // locale groups digits differently would otherwise fail hydration on them.
    const baht = (n: number) => `฿${n.toLocaleString('en-US')}`;
    const priceLabel = (min: number, max: number) => {
        if (min === 0) return t('desktop.priceUnder').replace('{price}', baht(max));
        if (max === PRICE_NO_MAX) return `${baht(min)}+`;
        return `${baht(min)}–${max.toLocaleString('en-US')}`;
    };
    const priceActive = priceMin > 0 || priceMax < PRICE_NO_MAX;

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
    // grid empty behind a choice the list no longer offers. Rarity is left
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
    }, [setOptions, rarityOptions, setFilters]);

    const gradingActive = singles && (grading.grading !== 'any' || !!condition);
    const gradingValue = condition
        ? conditionLabel(condition)
        : gradingFilterLabel(grading, { raw: t('marketplace.gradingRaw'), graded: t('marketplace.gradingGraded') });
    const setGrading = (id: 'any' | 'raw' | 'graded') => patch({
        grading: id === 'graded' ? { ...grading, grading: 'graded' } : { ...NO_GRADING_FILTER, grading: id },
        condition: id === 'raw' ? condition : '',
    });

    // A value from the URL shows under its own text until the list arrives.
    const setValue = set ? (setOptions?.find((o) => o.value === set)?.label ?? set) : null;
    const rarityValue = !singles || !rarity
        ? null
        : rarity === RARITY_RARE_AND_ABOVE
            ? t('desktop.rareAndAbove')
            : (rarityOptions?.find((o) => o.value === rarity)?.label ?? rarity);

    const activeCount = countActiveFilters(filters);

    return (
        <div className="mt-5">
            {/* Singles / Sealed and the games are navigation, not filters: they
                decide what the grid is of. Kept on their own line, as tabs. */}
            <div className="flex flex-wrap items-center gap-x-5 border-b border-white/10">
                <div className="my-1 flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
                    {([
                        { id: 'singles' as const, label: t('marketplace.sectionSingles') },
                        { id: 'sealed' as const, label: t('marketplace.sectionSealed') },
                    ]).map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={section === id}
                            // Sealed products and singles share no set names.
                            onClick={() => patch({ section: id, set: '' })}
                            className={`h-7 rounded-full px-4 text-xs font-bold transition-colors ${
                                section === id ? 'bg-brand-cyan text-brand-darker' : 'text-slate-300 hover:text-white'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <nav className="-mb-px flex flex-wrap items-center" aria-label={t('marketplace.game')}>
                    <GameTab label={t('desktop.allGames')} active={game === 'all'} onClick={() => selectGame('all')} />
                    {GAMES.filter((g) => g.enabled).map((g) => (
                        <GameTab key={g.id} label={g.shortName} active={game === g.id} onClick={() => selectGame(g.id)} />
                    ))}
                </nav>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Language: every catalog language until a game narrows it. Hidden
                    for a game with only one, where there is nothing to choose. */}
                {languageOptions.length > 1 && (
                    <FilterMenu
                        label={t('desktop.browse.language')}
                        value={language === 'all' ? null : t(LANGUAGE_LABEL_KEYS[language] ?? language)}
                        onClear={() => patch({ language: 'all' })}
                        panelClass="w-52"
                    >
                        {(close) => (
                            <>
                                <MenuRow selected={language === 'all'} onClick={() => { patch({ language: 'all' }); close(); }}>
                                    {t('desktop.allLanguages')}
                                </MenuRow>
                                {languageOptions.map((l) => (
                                    <MenuRow key={l} selected={language === l} onClick={() => { patch({ language: l }); close(); }}>
                                        {t(LANGUAGE_LABEL_KEYS[l] ?? l)}
                                    </MenuRow>
                                ))}
                            </>
                        )}
                    </FilterMenu>
                )}

                {/* Price: one click for a band, or any range typed in. */}
                <FilterMenu
                    label={t('desktop.filterPrice')}
                    value={priceActive ? priceLabel(priceMin, priceMax) : null}
                    onClear={() => selectPrice(0, PRICE_NO_MAX)}
                    panelClass="w-64"
                >
                    {(close) => (
                        <>
                            <MenuRow selected={!priceActive} onClick={() => { selectPrice(0, PRICE_NO_MAX); close(); }}>
                                {t('desktop.anyPrice')}
                            </MenuRow>
                            {PRICE_PRESETS.map(([min, max]) => (
                                <MenuRow
                                    key={min}
                                    selected={priceMin === min && priceMax === max}
                                    onClick={() => { selectPrice(min, max); close(); }}
                                >
                                    {priceLabel(min, max)}
                                </MenuRow>
                            ))}
                            <PanelDivider />
                            <PanelHeading>{t('desktop.customRange')}</PanelHeading>
                            <div className="flex items-center gap-2 px-2 pb-1">
                                <PriceInput
                                    label={t('marketplace.minPrice')}
                                    value={minInput}
                                    onChange={setMinInput}
                                    onEnter={() => { commitTypedPrice(); close(); }}
                                />
                                <span className="text-xs text-slate-500" aria-hidden="true">–</span>
                                <PriceInput
                                    label={t('marketplace.maxPrice')}
                                    value={maxInput}
                                    onChange={setMaxInput}
                                    onEnter={() => { commitTypedPrice(); close(); }}
                                />
                            </div>
                        </>
                    )}
                </FilterMenu>

                {/* Grading: singles only; a sealed product is never graded. Graded
                    opens company and grade floor, Raw opens condition, each only
                    meaningful on that side (a slab has a grade, not a condition). */}
                {singles && (
                    <FilterMenu
                        label={t('marketplace.grading')}
                        value={gradingActive ? gradingValue : null}
                        onClear={() => setGrading('any')}
                        panelClass="w-96"
                    >
                        {(close) => (
                            <>
                                <MenuRow selected={grading.grading === 'any'} onClick={() => { setGrading('any'); close(); }}>
                                    {t('marketplace.gradingAny')}
                                </MenuRow>
                                <MenuRow selected={grading.grading === 'raw'} onClick={() => setGrading('raw')}>
                                    {t('marketplace.gradingRaw')}
                                </MenuRow>
                                <MenuRow selected={grading.grading === 'graded'} onClick={() => setGrading('graded')}>
                                    {t('marketplace.gradingGraded')}
                                </MenuRow>
                                {grading.grading === 'raw' && (
                                    <>
                                        <PanelDivider />
                                        <PanelHeading>{t('desktop.filterCondition')}</PanelHeading>
                                        <ChipGroup>
                                            <MiniChip selected={!condition} onClick={() => patch({ condition: '' })}>
                                                {t('desktop.anyCondition')}
                                            </MiniChip>
                                            {LISTING_CONDITIONS.map((c) => (
                                                <MiniChip key={c} selected={condition === c} onClick={() => patch({ condition: c })}>
                                                    {conditionLabel(c)}
                                                </MiniChip>
                                            ))}
                                        </ChipGroup>
                                    </>
                                )}
                                {grading.grading === 'graded' && (
                                    <>
                                        <PanelDivider />
                                        <PanelHeading>{t('marketplace.gradingCompany')}</PanelHeading>
                                        <ChipGroup>
                                            <MiniChip
                                                selected={!grading.gradingCompany}
                                                onClick={() => patch({ grading: { ...grading, gradingCompany: '' } })}
                                            >
                                                {t('marketplace.anyCompany')}
                                            </MiniChip>
                                            {LISTING_GRADING_COMPANIES.map((company) => (
                                                <MiniChip
                                                    key={company}
                                                    selected={grading.gradingCompany === company}
                                                    onClick={() => patch({ grading: { ...grading, gradingCompany: company } })}
                                                >
                                                    {company}
                                                </MiniChip>
                                            ))}
                                        </ChipGroup>
                                        <PanelHeading>{t('marketplace.minGrade')}</PanelHeading>
                                        <ChipGroup>
                                            <MiniChip
                                                selected={grading.minGrade === 0}
                                                onClick={() => patch({ grading: { ...grading, minGrade: 0 } })}
                                            >
                                                {t('marketplace.anyGrade')}
                                            </MiniChip>
                                            {MIN_GRADE_OPTIONS.map((g) => (
                                                <MiniChip
                                                    key={g}
                                                    selected={grading.minGrade === g}
                                                    onClick={() => patch({ grading: { ...grading, minGrade: g } })}
                                                >
                                                    {minGradeLabel(g)}
                                                </MiniChip>
                                            ))}
                                        </ChipGroup>
                                    </>
                                )}
                                {grading.grading !== 'any' && (
                                    <div className="flex justify-end px-1 pt-2 pb-1">
                                        <button
                                            type="button"
                                            onClick={close}
                                            className="h-8 rounded-full bg-brand-cyan px-4 text-xs font-bold text-brand-darker transition-opacity hover:opacity-90"
                                        >
                                            {t('desktop.done')}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </FilterMenu>
                )}

                <FilterMenu
                    label={t('desktop.filterSet')}
                    value={setValue}
                    onClear={() => patch({ set: '' })}
                    onOpen={wantFacets}
                    panelClass="w-80"
                >
                    {(close) => (
                        <SetPanel
                            options={setOptions}
                            value={set}
                            onSelect={(v) => { patch({ set: v }); close(); }}
                        />
                    )}
                </FilterMenu>

                {/* Singles only, like grading: sealed stores 'Sealed' as its rarity. */}
                {singles && (
                    <FilterMenu
                        label={t('desktop.filterRarity')}
                        value={rarityValue}
                        onClear={() => patch({ rarity: '' })}
                        onOpen={wantFacets}
                        panelClass="w-72"
                    >
                        {(close) => (
                            <div className="max-h-80 overflow-y-auto">
                                <MenuRow selected={!rarity} onClick={() => { patch({ rarity: '' }); close(); }}>
                                    {t('desktop.anyRarity')}
                                </MenuRow>
                                <MenuRow
                                    selected={rarity === RARITY_RARE_AND_ABOVE}
                                    onClick={() => { patch({ rarity: RARITY_RARE_AND_ABOVE }); close(); }}
                                >
                                    {t('desktop.rareAndAbove')}
                                </MenuRow>
                                <PanelDivider />
                                <OptionRows
                                    options={rarityOptions}
                                    value={rarity}
                                    onSelect={(v) => { patch({ rarity: v }); close(); }}
                                    emptyText={t('desktop.noListingsTitle')}
                                />
                            </div>
                        )}
                    </FilterMenu>
                )}

                <TogglePill label={t('desktop.dealsOnly')} active={dealsOnly} onClick={() => patch({ dealsOnly: !dealsOnly })} />
                {offersEnabled && (
                    <TogglePill
                        label={t('desktop.acceptsOffers')}
                        active={acceptsOffers}
                        onClick={() => patch({ acceptsOffers: !acceptsOffers })}
                    />
                )}

                {activeCount > 0 && (
                    <button
                        type="button"
                        onClick={() => setFilters(clearFilters)}
                        className="h-9 px-2 text-xs font-bold text-slate-400 underline-offset-2 transition-colors hover:text-white hover:underline"
                    >
                        {t('desktop.clearAll')} ({activeCount})
                    </button>
                )}

                <div className="ml-auto flex items-center gap-2">
                    <i className="fa-solid fa-arrow-down-wide-short text-xs text-slate-500" aria-hidden="true"></i>
                    <div className="w-44">
                        <CustomSelect
                            value={sort}
                            onChange={(v) => patch({ sort: v as MarketplaceFilterState['sort'] })}
                            ariaLabel={t('marketplace.sortBy')}
                            triggerClassName="h-9 w-full rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-bold text-white outline-none transition-colors hover:bg-white/10 focus:border-brand-cyan/50"
                            options={[
                                { value: 'best_deals', label: t('desktop.sortBestDeals') },
                                { value: 'newest', label: t('desktop.sortNewest') },
                                { value: 'price_asc', label: t('desktop.sortPriceAsc') },
                                { value: 'price_desc', label: t('desktop.sortPriceDesc') },
                            ]}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function GameTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={`relative px-3 py-3 text-sm font-bold transition-colors ${active ? 'text-white' : 'text-slate-400 hover:text-white'}`}
        >
            {label}
            {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-cyan" aria-hidden="true"></span>}
        </button>
    );
}

/**
 * A pill that opens its options underneath. `value` is the chosen value's text
 * (null while the filter is off); an active pill shows it with a clear button.
 * The panel sits in the page flow rather than a portal: nothing between the
 * toolbar and the document clips or transforms it, unlike the checkout forms
 * CustomSelect was built for.
 */
function FilterMenu({ label, value, onClear, onOpen, panelClass, children }: {
    label: string;
    value: string | null;
    onClear: () => void;
    /** Fires on hover and open, for a list that is only loaded when reached for. */
    onOpen?: () => void;
    panelClass: string;
    children: (close: () => void) => React.ReactNode;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [alignRight, setAlignRight] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const active = value !== null;
    const close = () => setOpen(false);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    // A pill near the right edge opens its panel leftwards so it stays on screen.
    useLayoutEffect(() => {
        if (!open || !rootRef.current || !panelRef.current) return;
        const left = rootRef.current.getBoundingClientRect().left;
        setAlignRight(left + panelRef.current.offsetWidth > window.innerWidth - 8);
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <span
                className={`inline-flex h-9 items-stretch rounded-full border transition-colors ${active ? PILL_ACTIVE : PILL_IDLE} ${
                    open ? 'ring-2 ring-brand-cyan/30' : ''
                }`}
            >
                <button
                    type="button"
                    aria-haspopup="true"
                    aria-expanded={open}
                    aria-label={active ? `${label}: ${value}` : label}
                    onPointerEnter={onOpen}
                    onClick={() => {
                        onOpen?.();
                        setOpen((o) => !o);
                    }}
                    className={`flex items-center gap-1.5 pl-3.5 text-xs font-bold ${active ? 'pr-2' : 'pr-3'}`}
                >
                    <span className="max-w-[180px] truncate">{active ? value : label}</span>
                    <i
                        className={`fa-solid fa-chevron-down text-[9px] transition-transform ${active ? 'text-brand-cyan' : 'text-slate-500'} ${open ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                    ></i>
                </button>
                {active && (
                    <button
                        type="button"
                        onClick={onClear}
                        aria-label={`${t('marketplace.reset')}: ${label}`}
                        className="flex items-center border-l border-brand-cyan/30 pl-2 pr-3 text-slate-400 transition-colors hover:text-white"
                    >
                        <i className="fa-solid fa-xmark text-[11px]" aria-hidden="true"></i>
                    </button>
                )}
            </span>
            {open && (
                <div
                    ref={panelRef}
                    role="group"
                    aria-label={label}
                    className={`absolute top-full z-40 mt-2 ${alignRight ? 'right-0' : 'left-0'} ${panelClass} rounded-2xl border border-white/10 bg-brand-darker p-2 shadow-2xl`}
                >
                    {children(close)}
                </div>
            )}
        </div>
    );
}

function TogglePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition-colors ${active ? PILL_ACTIVE : PILL_IDLE}`}
        >
            {active && <i className="fa-solid fa-check text-[10px] text-brand-cyan" aria-hidden="true"></i>}
            {label}
        </button>
    );
}

function MenuRow({ selected, onClick, trailing, children }: {
    selected: boolean;
    onClick: () => void;
    trailing?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            onClick={onClick}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors ${
                selected ? 'bg-brand-cyan/15 text-white' : 'text-slate-200 hover:bg-white/5'
            }`}
        >
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {trailing !== undefined && <span className="text-[11px] font-bold tabular-nums text-slate-500">{trailing}</span>}
            {selected && <i className="fa-solid fa-check text-xs text-brand-cyan" aria-hidden="true"></i>}
        </button>
    );
}

/** Option rows for a list the service is still reading, with a stand-in until it arrives. */
function OptionRows({ options, value, onSelect, emptyText }: {
    options: FilterOption[] | null;
    value: string;
    onSelect: (value: string) => void;
    emptyText: string;
}) {
    const { t } = useTranslation();
    if (options === null) return <PanelNote>{t('desktop.loading')}</PanelNote>;
    if (options.length === 0) return <PanelNote>{emptyText}</PanelNote>;
    return (
        <>
            {options.map((o) => (
                <MenuRow key={o.value} selected={o.value === value} onClick={() => onSelect(o.value)} trailing={o.count}>
                    {o.label}
                </MenuRow>
            ))}
        </>
    );
}

/** The set list with a search box: a game's sets run to dozens, and a buyer usually knows the name. */
function SetPanel({ options, value, onSelect }: {
    options: FilterOption[] | null;
    value: string;
    onSelect: (value: string) => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        inputRef.current?.focus();
    }, []);
    const term = query.trim().toLowerCase();
    const shown = useMemo(
        () => (options ? options.filter((o) => !term || o.label.toLowerCase().includes(term)) : null),
        [options, term],
    );
    return (
        <>
            <div className="px-1 pb-2">
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('desktop.browse.searchSets')}
                    aria-label={t('desktop.browse.searchSets')}
                    className="h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-brand-cyan/50"
                />
            </div>
            <div className="max-h-72 overflow-y-auto">
                {!term && (
                    <MenuRow selected={!value} onClick={() => onSelect('')}>
                        {t('desktop.allSets')}
                    </MenuRow>
                )}
                <OptionRows options={shown} value={value} onSelect={onSelect} emptyText={t('desktop.browse.noSets')} />
            </div>
        </>
    );
}

function PriceInput({ label, value, onChange, onEnter }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    onEnter: () => void;
}) {
    return (
        <span className="flex h-9 min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-brand-cyan/50">
            <span className="mr-1 text-xs font-bold text-slate-500" aria-hidden="true">฿</span>
            <input
                type="text"
                inputMode="numeric"
                value={value}
                onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onEnter();
                }}
                placeholder={label}
                aria-label={label}
                className="w-full min-w-0 bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-500"
            />
        </span>
    );
}

function MiniChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                selected ? 'border-brand-cyan bg-brand-cyan text-brand-darker' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
        >
            {children}
        </button>
    );
}

function ChipGroup({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-wrap gap-1.5 px-2 pb-2">{children}</div>;
}

function PanelHeading({ children }: { children: React.ReactNode }) {
    return <div className="px-2 pt-2 pb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">{children}</div>;
}

function PanelDivider() {
    return <div className="my-1.5 border-t border-white/10" aria-hidden="true"></div>;
}

function PanelNote({ children }: { children: React.ReactNode }) {
    return <div className="px-3 py-2 text-sm text-slate-500">{children}</div>;
}
