import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { CURRENCY_SYMBOLS } from '@/constants';
import { getThumbnailUrl, shouldSkipNextOptimization, CARD_BLUR_DATA_URL } from '@/lib/imageUtils';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { MarketplaceListing, marketplaceService, ListingSort } from '@/services/marketplaceService';
import { Card } from '@/types';
import { GAMES } from '@/lib/games';
import { getSellerTrust } from '@/lib/sellerTrust';
import { getDealPercent, conditionBadgeLabel, isTopCondition } from '@/lib/listingDisplay';

interface MarketplaceProps {
  initialGame?: string;
  onSelectCard: (card: Card) => void;
  onSelectListing?: (listing: any) => void;
  onSellerClick: (seller: any) => void;
  onAddToCart?: (item: any) => void;
  listings?: MarketplaceListing[];   // used only for Explore price overlay, marketplace fetches its own
  currency?: string;
  exchangeRate?: number;
}

const Marketplace: React.FC<MarketplaceProps> = ({
  initialGame,
  onSelectCard,
  onSelectListing,
  onSellerClick,
  onAddToCart,
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
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100000]);

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
    priceRange[0] > 0 || priceRange[1] < 100000,
  ].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full animate-fadeIn -mx-6 w-[calc(100%+48px)]">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0 px-6 pt-6 pb-2 space-y-4 bg-brand-darker">
        <div>
          <div className="flex justify-between items-end mb-2">
            <div>
              <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg]">{t('marketplace.globalExchange')}</p>
              <h2 className="text-3xl font-black text-white tracking-tighter italic skew-x-[-6deg]">
                {t('marketplace.market')} <span className="text-brand-green">{t('marketplace.live')}</span>
              </h2>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative group z-20">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-brand-cyan via-brand-green to-brand-cyan rounded-xl opacity-20 group-focus-within:opacity-100 transition duration-500 blur"></div>
            <div className="relative flex items-center bg-[#0f172a] rounded-xl border border-white/10 p-1">
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
        <div className="bg-brand-darker/95 backdrop-blur-xl border-b border-white/5 py-3 px-6 shadow-2xl">
          <div className="flex justify-between items-center">
            {/* Filter Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all border ${showFilters || activeFilterCount > 0
                ? 'bg-brand-purple/20 text-brand-purple border-brand-purple/30'
                : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-white'
                }`}
            >
              <i className="fa-solid fa-sliders"></i>
              {t('marketplace.filters') || 'Filters'}
              {activeFilterCount > 0 && (
                <span className="ml-1 w-4 h-4 rounded-full bg-brand-purple text-white text-[8px] flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Sort Options */}
            <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
              {([
                { id: 'best_deals', label: t('marketplace.deals') },
                { id: 'newest', label: t('marketplace.new') },
                { id: 'price_asc', label: t('marketplace.lowPrice') },
                { id: 'price_desc', label: t('marketplace.highPrice') }
              ] as const).map(sort => (
                <button
                  key={sort.id}
                  onClick={() => setSortOrder(sort.id)}
                  className={`px-3 py-1 rounded-md text-[9px] font-bold uppercase transition-all ${sortOrder === sort.id ? 'bg-brand-cyan text-brand-darker shadow-md' : 'text-slate-500 hover:text-white'}`}
                >
                  {sort.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="mt-4 p-4 bg-[#0f172a] rounded-xl border border-white/10 space-y-4 animate-fadeIn">
              {/* Game Filter */}
              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2 block">{t('marketplace.game') || 'Game'}</label>
                <div className="flex gap-2 flex-wrap">
                  {[{ id: 'all', shortName: t('marketplace.allGames') || 'All' }, ...GAMES].map(g => (
                    <button
                      key={g.id}
                      onClick={() => setSelectedGame(g.id)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all border ${selectedGame === g.id
                        ? 'bg-brand-green/20 text-brand-green border-brand-green/30'
                        : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10'
                        }`}
                    >
                      {g.shortName}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language Filter */}
              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2 block">{t('marketplace.language') || 'Language'}</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { id: 'all', label: t('marketplace.allLanguages') || 'All' },
                    { id: 'en', label: t('marketplace.english') || 'English' },
                    { id: 'jp', label: t('marketplace.japanese') || 'Japanese' },
                    { id: 'th', label: t('marketplace.thai') || 'Thai' }
                  ].map(lang => (
                    <button
                      key={lang.id}
                      onClick={() => setSelectedLanguage(lang.id)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all border ${selectedLanguage === lang.id
                        ? 'bg-brand-green/20 text-brand-green border-brand-green/30'
                        : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10'
                        }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div>
                <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2 block">
                  {t('marketplace.priceRange') || 'Price Range'}: {CURRENCY_SYMBOLS[currency] || currency}{priceRange[0].toLocaleString()} - {CURRENCY_SYMBOLS[currency] || currency}{priceRange[1].toLocaleString()}
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range" min="0" max="100000" step="500"
                    value={priceRange[0]}
                    onChange={(e) => setPriceRange([Math.min(Number(e.target.value), priceRange[1] - 500), priceRange[1]])}
                    className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-brand-cyan"
                  />
                  <input
                    type="range" min="0" max="100000" step="500"
                    value={priceRange[1]}
                    onChange={(e) => setPriceRange([priceRange[0], Math.max(Number(e.target.value), priceRange[0] + 500)])}
                    className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-brand-purple"
                  />
                </div>
              </div>

              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setSelectedGame('all'); setSelectedLanguage('all'); setPriceRange([0, 100000]); }}
                  className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                >
                  <i className="fa-solid fa-xmark mr-2"></i>
                  {t('marketplace.clearFilters') || 'Clear All Filters'}
                </button>
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
            const formatPrice = (thb: number) => {
              const v = thb * exchangeRate;
              return `${CURRENCY_SYMBOLS[currency] || currency}${v < 1 ? v.toFixed(2) : Math.round(v).toLocaleString()}`;
            };
            return (
              <div
                key={listing.id}
                onClick={() => onSelectListing ? onSelectListing(listing) : onSelectCard(listing.card_data)}
                className="bg-[#1e293b]/50 border border-white/5 hover:border-brand-cyan/30 rounded-xl overflow-hidden flex flex-col group active:scale-[0.98] transition-all cursor-pointer"
              >
                {/* Card Image — fixed aspect to prevent CLS */}
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

                {/* Card Details */}
                <div className="p-2 flex flex-col flex-1 min-w-0">
                  <h3 className="text-white font-bold text-xs truncate">{listing.card_data.name}</h3>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">{listing.card_data.set}</p>

                  {/* Price & Action */}
                  <div className="flex items-end justify-between gap-1 mt-auto pt-1.5">
                    <div className="min-w-0">
                      <p className="text-base font-black text-brand-cyan leading-none truncate">
                        {formatPrice(listing.price)}
                      </p>
                      {dealPct !== null && (
                        <p className="text-[9px] text-slate-500 font-bold line-through mt-0.5 truncate">
                          {formatPrice(listing.card_data.marketPrice)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onAddToCart) {
                          onAddToCart({
                            id: listing.id,
                            cardId: listing.card_id,
                            card: listing.card_data,
                            price: listing.price,
                            sellerId: listing.seller_id,
                            sellerName: listing.seller?.display_name || 'Unknown',
                            condition: listing.condition
                          });
                        }
                      }}
                      className="w-8 h-8 flex-shrink-0 rounded-full bg-white/5 hover:bg-brand-green hover:text-brand-darker text-brand-green flex items-center justify-center transition-all shadow-lg shadow-black/20 active:scale-90"
                      aria-label={`Add ${listing.card_data.name} to cart`}
                    >
                      <i className="fa-solid fa-cart-plus text-xs"></i>
                    </button>
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
                onClick={() => { setSelectedLanguage('all'); setPriceRange([0, 100000]); setSearchQuery(''); }}
                className="mt-4 text-brand-cyan text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
              >
                {t('marketplace.clearFilters') || 'Reset Filters'}
              </button>
            </div>
          ) : null}

          {/* Loading skeleton */}
          {isLoading && [1, 2, 3, 4, 5, 6].map(i => (
            <div key={`skeleton-${i}`} className="bg-[#1e293b]/50 border border-white/5 rounded-xl overflow-hidden animate-pulse">
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
    </div>
  );
};

export default Marketplace;
