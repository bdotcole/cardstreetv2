import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { CURRENCY_SYMBOLS } from '@/constants';
import { getThumbnailUrl, shouldSkipNextOptimization, CARD_BLUR_DATA_URL } from '@/lib/imageUtils';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { MarketplaceListing, marketplaceService, ListingSort } from '@/services/marketplaceService';
import { Card } from '@/types';
import { gamesAvailableInLanguage, getGame, CATALOG_LANGUAGES } from '@/lib/games';
import { getSellerTrust } from '@/lib/sellerTrust';
import { getDealPercent, conditionBadgeLabel, isTopCondition } from '@/lib/listingDisplay';
import SnipeBadge, { isSnipeListing } from '@/components/SnipeBadge';

interface MarketplaceProps {
  initialGame?: string;
  onSelectCard: (card: Card) => void;
  onSelectListing?: (listing: any) => void;
  onSellerClick: (seller: any) => void;
  /** Straight-to-payment purchase of a single listing (skips the cart). */
  onBuyNow?: (listing: MarketplaceListing) => void;
  /** Opens the OBO "Make an offer" modal for an offer-accepting listing. */
  onMakeOffer?: (listing: MarketplaceListing) => void;
  /** Signed-in buyer id (null for guests) — gates which tiles show "Make Offer". */
  currentUserId?: string | null;
  listings?: MarketplaceListing[];   // used only for Explore price overlay, marketplace fetches its own
  currency?: string;
  exchangeRate?: number;
}

// OBO offers are behind a single build-time flag; when off, every tile shows
// "Buy Now" regardless of a listing's accepts_offers value.
const OFFERS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

// The service treats maxPrice >= 100000 as "no upper bound" — keep that
// sentinel so an untouched price filter never constrains the query.
const PRICE_MAX = 100000;
const PRICE_PRESETS: Array<[number, number]> = [
  [0, PRICE_MAX],
  [0, 500],
  [500, 2000],
  [2000, 10000],
  [10000, PRICE_MAX],
];

/** Removable pill for a currently-applied filter, shown under the filter bar. */
const AppliedChip: React.FC<{ label: React.ReactNode; onRemove: () => void }> = ({ label, onRemove }) => (
  <button
    onClick={onRemove}
    className="flex-shrink-0 inline-flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-full bg-brand-green/10 border border-brand-green/30 text-brand-green text-[10px] font-bold whitespace-nowrap active:scale-95 transition-all"
  >
    {label}
    <i className="fa-solid fa-xmark text-[9px] opacity-70"></i>
  </button>
);

const sheetChipClass = (active: boolean) =>
  `inline-flex items-center gap-2 h-9 px-4 rounded-full text-[11px] font-bold tracking-wide transition-all border active:scale-95 ${active
    ? 'bg-brand-green text-brand-darker border-brand-green shadow-lg shadow-brand-green/20'
    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
  }`;

const sheetSectionLabelClass = 'text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-3 block';

const Marketplace: React.FC<MarketplaceProps> = ({
  initialGame,
  onSelectCard,
  onSelectListing,
  onSellerClick,
  onBuyNow,
  onMakeOffer,
  currentUserId = null,
  currency = 'THB',
  exchangeRate = 1,
}) => {
  const { t } = useTranslation();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedGame, setSelectedGame] = useState(initialGame || 'all');
  const [selectedLanguage, setSelectedLanguage] = useState('all');
  // Best deals first: discount vs. market snapshot is the default browse order.
  const [sortOrder, setSortOrder] = useState<ListingSort>('best_deals');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, PRICE_MAX]);

  // ── Filter sheet ────────────────────────────────────────────────────────────
  // Selections inside the sheet are drafts; they only hit the query (one fetch,
  // no grid reflow mid-selection) when the user taps "Show Results".
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftGame, setDraftGame] = useState('all');
  const [draftLanguage, setDraftLanguage] = useState('all');
  const [draftPrice, setDraftPrice] = useState<[number, number]>([0, PRICE_MAX]);
  // Portal target only exists in the browser; gate on mount so SSR is clean.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const openSheet = () => {
    setDraftGame(selectedGame);
    setDraftLanguage(selectedLanguage);
    setDraftPrice(priceRange);
    setSheetOpen(true);
  };

  const applyDrafts = () => {
    const [min, max] = draftPrice;
    // A hand-typed min above a bounded max is a swap, not an error.
    const ordered: [number, number] = max !== PRICE_MAX && min > max ? [max, min] : [min, max];
    setSelectedGame(draftGame);
    setSelectedLanguage(draftLanguage);
    setPriceRange(ordered);
    setSheetOpen(false);
  };

  // Lock the page behind the sheet and allow Escape to dismiss it.
  useEffect(() => {
    if (!sheetOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [sheetOpen]);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  // Debounce search input 400ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Fetch listings whenever filters change ──────────────────────────────────
  const fetchListings = useCallback(async (reset = false) => {
    setIsLoading(true);
    const currentOffset = reset ? 0 : offset;

    const data = await marketplaceService.getActiveListings({
      search: debouncedSearch,
      language: selectedLanguage === 'all' ? undefined : selectedLanguage,
      game: selectedGame === 'all' ? undefined : selectedGame,
      minPrice: priceRange[0],
      maxPrice: priceRange[1],
      sort: sortOrder,
      limit: PAGE_SIZE,
      offset: currentOffset,
    });

    if (reset) {
      setListings(data);
      setOffset(PAGE_SIZE);
    } else {
      setListings(prev => [...prev, ...data]);
      setOffset(prev => prev + PAGE_SIZE);
    }
    setHasMore(data.length === PAGE_SIZE);
    setIsLoading(false);
  }, [debouncedSearch, selectedLanguage, selectedGame, priceRange, sortOrder, offset]);

  // When filters change, reset and re-fetch
  useEffect(() => {
    setOffset(0);
    fetchListings(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, selectedLanguage, selectedGame, priceRange, sortOrder]);

  // ── Infinite scroll observer ─────────────────────────────────────────────────
  const observerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!observerRef.current || !hasMore || isLoading) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) fetchListings(false);
    }, { threshold: 0.1 });
    io.observe(observerRef.current);
    return () => io.disconnect();
  }, [hasMore, isLoading, fetchListings]);

  // Count active filters
  const activeFilterCount = [
    selectedGame !== 'all',
    selectedLanguage !== 'all',
    priceRange[0] > 0 || priceRange[1] < PRICE_MAX,
  ].filter(Boolean).length;

  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;
  const formatFilterPrice = (n: number) => `${currencySymbol}${n.toLocaleString()}`;
  const priceRangeLabel = ([min, max]: [number, number]) => {
    if (min === 0 && max === PRICE_MAX) return t('marketplace.anyPrice') || 'Any';
    if (min === 0) return `< ${formatFilterPrice(max)}`;
    if (max === PRICE_MAX) return `${formatFilterPrice(min)}+`;
    return `${formatFilterPrice(min)}–${formatFilterPrice(max)}`;
  };
  const languageLabel = (code: string) =>
    code === 'en' ? (t('marketplace.english') || 'English')
      : code === 'jp' ? (t('marketplace.japanese') || 'Japanese')
        : code === 'th' ? (t('marketplace.thai') || 'Thai')
          : (t('marketplace.allLanguages') || 'All');

  return (
    <div className="flex flex-col h-full animate-fadeIn -mx-6 w-[calc(100%+48px)]">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0 px-6 pt-6 pb-2 space-y-4 bg-brand-darker">
        <div>
          <div className="flex justify-between items-end mb-2">
            <div>
              <h2 className="text-3xl font-black text-white tracking-tighter italic skew-x-[-6deg]">
                {t('marketplace.market')} <span className="text-brand-green">{t('marketplace.live')}</span>
              </h2>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative group z-20">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-brand-cyan via-brand-green to-brand-cyan rounded-xl opacity-20 group-focus-within:opacity-100 transition duration-500 blur"></div>
            <div className="relative flex items-center bg-slate-900 rounded-xl border border-white/10 p-1">
              <i className="fa-solid fa-magnifying-glass text-slate-500 ml-3 mr-2"></i>
              <input
                type="text"
                placeholder={t('marketplace.searchPlaceholder') || 'Search by card name or set...'}
                className="w-full bg-transparent text-white text-xs font-bold focus:outline-none placeholder:text-slate-600 h-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {debouncedSearch !== searchQuery && (
                <div className="w-3 h-3 border-2 border-brand-cyan/60 border-t-transparent rounded-full animate-spin mr-3" />
              )}
            </div>
          </div>
        </div>

        {/* Filter & Sort Bar */}
        <div className="space-y-3">
          <div className="flex justify-between items-center gap-2">
            {/* Filter Button — opens the bottom sheet */}
            <button
              onClick={openSheet}
              className={`flex items-center gap-2 h-9 px-4 rounded-full text-[10px] font-black uppercase tracking-wider transition-all border active:scale-95 ${activeFilterCount > 0
                ? 'bg-brand-green/15 text-brand-green border-brand-green/40'
                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
                }`}
            >
              <i className="fa-solid fa-sliders"></i>
              {t('marketplace.filters') || 'Filters'}
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-brand-green text-brand-darker text-[8px] font-black flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Sort Options */}
            <div className="flex bg-white/5 rounded-full p-1 border border-white/10">
              {([
                { id: 'best_deals', label: t('marketplace.deals') },
                { id: 'newest', label: t('marketplace.new') },
                { id: 'price_asc', label: t('marketplace.lowPrice') },
                { id: 'price_desc', label: t('marketplace.highPrice') }
              ] as const).map(sort => (
                <button
                  key={sort.id}
                  onClick={() => setSortOrder(sort.id)}
                  className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase transition-all ${sortOrder === sort.id ? 'bg-brand-cyan text-brand-darker shadow-md' : 'text-slate-500 hover:text-white'}`}
                >
                  {sort.label}
                </button>
              ))}
            </div>
          </div>

          {/* Applied filters — removable without reopening the sheet */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto -mx-6 px-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {selectedGame !== 'all' && (
                <AppliedChip label={getGame(selectedGame).shortName} onRemove={() => setSelectedGame('all')} />
              )}
              {selectedLanguage !== 'all' && (
                <AppliedChip label={languageLabel(selectedLanguage)} onRemove={() => setSelectedLanguage('all')} />
              )}
              {(priceRange[0] > 0 || priceRange[1] < PRICE_MAX) && (
                <AppliedChip label={priceRangeLabel(priceRange)} onRemove={() => setPriceRange([0, PRICE_MAX])} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Listings Grid */}
      <div className="flex-1 overflow-y-auto px-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)' }}>
        <div className="grid grid-cols-2 gap-3">
          {listings.length > 0 ? listings.map((listing, idx) => {
            const dealPct = getDealPercent(listing.price, listing.card_data.marketPrice);
            const thumbUrl = getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl);
            // Show "Make Offer" only on offer-accepting listings, and only to a
            // signed-in buyer who isn't the seller. Everyone else (incl. guests
            // and the flag-off case) gets "Buy Now".
            const showMakeOffer =
              OFFERS_ENABLED &&
              listing.accepts_offers === true &&
              !!currentUserId &&
              currentUserId !== listing.seller_id;
            const formatPrice = (thb: number) => {
              const v = thb * exchangeRate;
              return `${CURRENCY_SYMBOLS[currency] || currency}${v < 1 ? v.toFixed(2) : Math.round(v).toLocaleString()}`;
            };
            return (
              <div
                key={listing.id}
                onClick={() => onSelectListing ? onSelectListing(listing) : onSelectCard(listing.card_data)}
                className="bg-slate-800/50 border border-white/5 hover:border-brand-cyan/30 rounded-xl overflow-hidden flex flex-col group active:scale-[0.98] transition-all cursor-pointer"
              >
                {/* Card Image — fixed aspect to prevent CLS. The extra wrapper
                    lets the snipe badge hang past the image's overflow-hidden
                    edge, straddling the image/details boundary. */}
                <div className="relative">
                  <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                    <Image
                      src={thumbUrl}
                      alt={listing.card_data.name || 'Card'}
                      fill
                      sizes="(max-width: 768px) 45vw, 200px"
                      loading={idx < 6 ? 'eager' : 'lazy'}
                      placeholder="blur"
                      blurDataURL={CARD_BLUR_DATA_URL}
                      unoptimized={shouldSkipNextOptimization(thumbUrl)}
                      className={listing.card_data.isSealed ? 'object-contain p-2' : 'object-cover'}
                    />
                    {dealPct !== null && (
                      <span className="absolute top-1.5 left-1.5 bg-brand-green text-brand-darker text-[9px] font-black px-1.5 py-0.5 rounded-md shadow-lg shadow-black/40">
                        -{dealPct}%
                      </span>
                    )}
                    <span className={`absolute top-1.5 right-1.5 text-[8px] font-black px-1.5 py-0.5 rounded-md border backdrop-blur-sm ${isTopCondition(listing) ? 'bg-brand-green/20 text-brand-green border-brand-green/30' : 'bg-black/50 text-slate-300 border-white/10'}`}>
                      {conditionBadgeLabel(listing)}
                    </span>
                  </div>
                  {isSnipeListing(listing.price) && (
                    <SnipeBadge className="absolute -bottom-3 right-1.5 z-10 h-12 w-auto" />
                  )}
                </div>

                {/* Card Details */}
                <div className="p-2 flex flex-col flex-1 min-w-0">
                  <h3 className="text-white font-bold text-xs truncate">{listing.card_data.name}</h3>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">{listing.card_data.set}</p>

                  {/* Price — asking price with the market price struck through beside it */}
                  <div className="flex items-baseline gap-1.5 mt-auto pt-1.5 min-w-0">
                    <p className="text-base font-black text-brand-cyan leading-none whitespace-nowrap">
                      {formatPrice(listing.price)}
                    </p>
                    {dealPct !== null && (
                      <p className="text-[9px] text-slate-500 font-bold line-through truncate">
                        {formatPrice(listing.card_data.marketPrice)}
                      </p>
                    )}
                  </div>

                  {/* Seller */}
                  <div
                    onClick={(e) => { e.stopPropagation(); if (listing.seller) onSellerClick(listing.seller); }}
                    className="flex items-center gap-1 mt-1.5 cursor-pointer hover:bg-white/5 rounded-md p-0.5 -m-0.5 transition-colors"
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-slate-700 overflow-hidden flex-shrink-0">
                      {listing.seller?.avatar_url && (
                        <img
                          src={listing.seller.avatar_url}
                          alt=""
                          width={14}
                          height={14}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400 font-bold truncate">{listing.seller?.display_name || 'Unknown Seller'}</span>
                    {(() => {
                      const trust = getSellerTrust(listing.seller);
                      if (trust.kind === 'partner')
                        return <i className="fa-solid fa-circle-check text-[8px] text-brand-cyan flex-shrink-0" title={t('seller.officialPartner')}></i>;
                      if (trust.kind === 'new')
                        return null;
                      return <span className="text-[8px] text-yellow-500 whitespace-nowrap flex-shrink-0">★ {trust.rating.toFixed(1)}</span>;
                    })()}
                  </div>

                  {/* Primary action: Make Offer (OBO) or Buy Now (straight to payment) */}
                  {showMakeOffer ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onMakeOffer?.(listing); }}
                      className="mt-2 w-full h-8 rounded-lg bg-brand-cyan/10 border border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/20 font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                      aria-label={`Make an offer on ${listing.card_data.name}`}
                    >
                      <i className="fa-solid fa-hand-holding-dollar"></i>
                      {t('offer.makeOffer')}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); onBuyNow?.(listing); }}
                      className="mt-2 w-full h-8 rounded-lg bg-brand-green text-brand-darker hover:bg-brand-green/90 font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-brand-green/20 active:scale-95 transition-all"
                      aria-label={`Buy ${listing.card_data.name} now`}
                    >
                      <i className="fa-solid fa-bolt"></i>
                      {t('marketplace.buyNow')}
                    </button>
                  )}
                </div>
              </div>
            );
          }) : !isLoading ? (
            <div className="col-span-2 text-center py-20 px-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                <i className="fa-solid fa-satellite-dish text-2xl text-slate-600"></i>
              </div>
              <h3 className="text-white font-bold text-sm uppercase tracking-widest mb-1">Signal Lost</h3>
              <p className="text-slate-500 text-xs">No active listings found in this sector.</p>
              <button
                onClick={() => { setSelectedGame('all'); setSelectedLanguage('all'); setPriceRange([0, PRICE_MAX]); setSearchQuery(''); }}
                className="mt-4 text-brand-cyan text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
              >
                {t('marketplace.clearFilters') || 'Reset Filters'}
              </button>
            </div>
          ) : null}

          {/* Loading skeleton */}
          {isLoading && [1, 2, 3, 4, 5, 6].map(i => (
            <div key={`skeleton-${i}`} className="bg-slate-800/50 border border-white/5 rounded-xl overflow-hidden animate-pulse">
              <div className="aspect-[3/4] bg-white/5" />
              <div className="p-2 space-y-2">
                <div className="h-3 bg-white/5 rounded w-3/4" />
                <div className="h-2 bg-white/5 rounded w-1/2" />
              </div>
            </div>
          ))}

          {/* Infinite scroll trigger */}
          {!isLoading && hasMore && <div ref={observerRef} className="col-span-2 h-8" />}

          {/* End of results */}
          {!isLoading && !hasMore && listings.length > 0 && (
            <p className="col-span-2 text-center text-[10px] text-slate-600 font-bold uppercase tracking-widest py-4">
              — {listings.length} listings shown —
            </p>
          )}
        </div>
      </div>

      {/* Filter bottom sheet — portaled so the SPA shell's transforms/overflow
          can't clip it. Stays mounted; open/close is pure CSS transitions with
          `inert` gating interaction. Interactivity is state-driven on purpose:
          exit-animation-driven unmounting (AnimatePresence-style) leaves an
          invisible backdrop eating taps whenever the animation clock is
          throttled (hidden/backgrounded tab), because the exit never finishes. */}
      {mounted && createPortal(
        <>
          <div
            onClick={() => setSheetOpen(false)}
            inert={!sheetOpen}
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
            style={{ opacity: sheetOpen ? 1 : 0, transition: 'opacity 300ms ease' }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('marketplace.filters') || 'Filters'}
            inert={!sheetOpen}
            className="fixed inset-x-0 bottom-0 z-[61] bg-slate-900 rounded-t-[1.75rem] border-t border-x border-white/10 shadow-2xl shadow-black/60 max-h-[85dvh] flex flex-col"
            style={{
              transform: sheetOpen ? 'translateY(0%)' : 'translateY(100%)',
              transition: 'transform 350ms cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          >
                {/* Handle — also a tap target to dismiss */}
                <div onClick={() => setSheetOpen(false)} className="pt-3 pb-1 flex justify-center flex-shrink-0">
                  <div className="w-10 h-1 rounded-full bg-white/20" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-1 pb-4 flex-shrink-0">
                  <h3 className="text-white text-base font-black uppercase tracking-widest">
                    {t('marketplace.filters') || 'Filters'}
                  </h3>
                  <button
                    onClick={() => { setDraftGame('all'); setDraftLanguage('all'); setDraftPrice([0, PRICE_MAX]); }}
                    className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                  >
                    {t('marketplace.reset') || 'Reset'}
                  </button>
                </div>

                {/* Sections */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 pb-6 space-y-7">
                  {/* Game */}
                  <section>
                    <label className={sheetSectionLabelClass}>{t('marketplace.game') || 'Card Game'}</label>
                    <div className="flex flex-wrap gap-2">
                      {[{ id: 'all', shortName: t('marketplace.allGames') || 'All Games' }, ...gamesAvailableInLanguage(draftLanguage)].map(g => (
                        <button key={g.id} onClick={() => setDraftGame(g.id)} className={sheetChipClass(draftGame === g.id)}>
                          {draftGame === g.id && <i className="fa-solid fa-check text-[10px]"></i>}
                          {g.shortName}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Language */}
                  <section>
                    <label className={sheetSectionLabelClass}>{t('marketplace.language') || 'Language'}</label>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setDraftLanguage('all')} className={sheetChipClass(draftLanguage === 'all')}>
                        <i className="fa-solid fa-globe text-[11px]"></i>
                        {t('marketplace.allLanguages') || 'All'}
                      </button>
                      {CATALOG_LANGUAGES.map(lang => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setDraftLanguage(lang.code);
                            // The drafted game may not exist in the new language
                            // (its chip is about to disappear) — fall back to all.
                            if (draftGame !== 'all' && !gamesAvailableInLanguage(lang.code).some(g => g.id === draftGame)) {
                              setDraftGame('all');
                            }
                          }}
                          className={sheetChipClass(draftLanguage === lang.code)}
                        >
                          <img src={lang.flagUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                          {languageLabel(lang.code)}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Price */}
                  <section>
                    <label className={sheetSectionLabelClass}>{t('marketplace.priceRange') || 'Price Range'}</label>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {PRICE_PRESETS.map(([min, max]) => (
                        <button
                          key={`${min}-${max}`}
                          onClick={() => setDraftPrice([min, max])}
                          className={sheetChipClass(draftPrice[0] === min && draftPrice[1] === max)}
                        >
                          {priceRangeLabel([min, max])}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-1.5 block">
                          {t('marketplace.minPrice') || 'Min'}
                        </span>
                        <div className="flex items-center h-11 rounded-xl bg-white/5 border border-white/10 focus-within:border-brand-green/50 px-3.5 transition-colors">
                          <span className="text-slate-500 text-xs font-bold mr-1.5">{currencySymbol}</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="0"
                            value={draftPrice[0] === 0 ? '' : draftPrice[0]}
                            onChange={(e) => {
                              const n = Number(e.target.value.replace(/\D/g, '')) || 0;
                              setDraftPrice([n, draftPrice[1]]);
                            }}
                            className="w-full bg-transparent text-white text-sm font-bold focus:outline-none placeholder:text-slate-600"
                          />
                        </div>
                      </div>
                      <span className="text-slate-600 font-bold mt-5">–</span>
                      <div className="flex-1">
                        <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-1.5 block">
                          {t('marketplace.maxPrice') || 'Max'}
                        </span>
                        <div className="flex items-center h-11 rounded-xl bg-white/5 border border-white/10 focus-within:border-brand-green/50 px-3.5 transition-colors">
                          <span className="text-slate-500 text-xs font-bold mr-1.5">{currencySymbol}</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="∞"
                            value={draftPrice[1] === PRICE_MAX ? '' : draftPrice[1]}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/\D/g, '');
                              setDraftPrice([draftPrice[0], raw === '' ? PRICE_MAX : Number(raw)]);
                            }}
                            className="w-full bg-transparent text-white text-sm font-bold focus:outline-none placeholder:text-slate-600"
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Apply */}
                <div className="flex-shrink-0 px-6 pt-4 border-t border-white/10 bg-slate-900" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
                  <button
                    onClick={applyDrafts}
                    className="w-full h-12 rounded-xl bg-brand-green text-brand-darker font-black uppercase tracking-[0.2em] text-xs hover:bg-brand-green/90 active:scale-[0.98] transition-all shadow-lg shadow-brand-green/20"
                  >
                    {t('marketplace.showResults') || 'Show Results'}
                  </button>
                </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default Marketplace;
