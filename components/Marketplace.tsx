import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { CURRENCY_SYMBOLS } from '@/constants';
import { getThumbnailUrl, shouldSkipNextOptimization, CARD_BLUR_DATA_URL } from '@/lib/imageUtils';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { MarketplaceListing, marketplaceService } from '@/services/marketplaceService';
import { Card } from '@/types';
import { GAMES } from '@/lib/games';
import { getSellerTrust } from '@/lib/sellerTrust';

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
  const [sortOrder, setSortOrder] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');
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
        <div className="grid grid-cols-1 gap-2">
          {listings.length > 0 ? listings.map((listing, idx) => (
            <div
              key={listing.id}
              onClick={() => onSelectListing ? onSelectListing(listing) : onSelectCard(listing.card_data)}
              className="bg-[#1e293b]/50 border border-white/5 hover:border-brand-cyan/30 rounded-xl p-2 flex gap-3 group active:scale-[0.98] transition-all relative overflow-hidden cursor-pointer"
            >
              {/* Highlight Bar */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-brand-cyan to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

              {/* Card Image — lazy load, fixed dimensions to prevent CLS */}
              <div className="w-20 aspect-[3/4] bg-brand-darker rounded-lg relative overflow-hidden flex-shrink-0 border border-white/10">
                <Image
                  src={getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl)}
                  alt={listing.card_data.name || 'Card'}
                  fill
                  sizes="80px"
                  loading={idx < 4 ? 'eager' : 'lazy'}
                  placeholder="blur"
                  blurDataURL={CARD_BLUR_DATA_URL}
                  unoptimized={shouldSkipNextOptimization(getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl))}
                  className="object-cover"
                />
              </div>

              {/* Card Details */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <div className="flex justify-between items-start">
                    <h3 className="text-white font-bold text-sm truncate pr-2">{listing.card_data.name}</h3>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${listing.condition === 'NM' ? 'bg-brand-green/10 text-brand-green border-brand-green/20' : 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                      {listing.condition}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide truncate">{listing.card_data.set}</p>
                </div>

                {/* Seller */}
                <div
                  onClick={(e) => { e.stopPropagation(); if (listing.seller) onSellerClick(listing.seller); }}
                  className="flex items-center gap-1.5 mt-2 bg-black/20 p-1.5 rounded-lg w-fit cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <div className="w-4 h-4 rounded-full bg-slate-700 overflow-hidden">
                    {listing.seller?.avatar_url && (
                      <img
                        src={listing.seller.avatar_url}
                        alt=""
                        width={16}
                        height={16}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <span className="text-[9px] text-slate-400 font-bold max-w-[80px] truncate">{listing.seller?.display_name || 'Unknown Seller'}</span>
                  {(() => {
                    const trust = getSellerTrust(listing.seller);
                    if (trust.kind === 'partner')
                      return <span className="text-[8px] text-brand-cyan font-bold whitespace-nowrap">{t('seller.officialPartner')}</span>;
                    if (trust.kind === 'new')
                      return <span className="text-[8px] text-slate-500 font-bold whitespace-nowrap">{t('seller.newSeller')}</span>;
                    return <span className="text-[8px] text-yellow-500 whitespace-nowrap">★ {trust.rating.toFixed(1)}</span>;
                  })()}
                </div>
              </div>

              {/* Price & Action */}
              <div className="flex flex-col justify-between items-end border-l border-white/5 pl-3 min-w-[80px]">
                <div className="text-right">
                  <p className="text-[9px] text-slate-500 font-bold uppercase">{t('card.askPrice')}</p>
                  <p className="text-lg font-black text-brand-cyan leading-none">
                    {CURRENCY_SYMBOLS[currency] || currency}{' '}
                    {(listing.price * exchangeRate) < 1
                      ? (listing.price * exchangeRate).toFixed(2)
                      : Math.round(listing.price * exchangeRate).toLocaleString()}
                  </p>
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
                  className="w-10 h-10 rounded-full bg-white/5 hover:bg-brand-green hover:text-brand-darker text-brand-green flex items-center justify-center transition-all shadow-lg shadow-black/20 active:scale-90"
                >
                  <i className="fa-solid fa-cart-plus"></i>
                </button>
              </div>
            </div>
          )) : !isLoading ? (
            <div className="text-center py-20 px-6">
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
          {isLoading && (
            <div className="space-y-2 mt-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-[#1e293b]/50 border border-white/5 rounded-xl p-2 flex gap-3 animate-pulse">
                  <div className="w-20 aspect-[3/4] bg-white/5 rounded-lg flex-shrink-0" />
                  <div className="flex-1 space-y-2 py-2">
                    <div className="h-3 bg-white/5 rounded w-3/4" />
                    <div className="h-2 bg-white/5 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Infinite scroll trigger */}
          {!isLoading && hasMore && <div ref={observerRef} className="h-8" />}

          {/* End of results */}
          {!isLoading && !hasMore && listings.length > 0 && (
            <p className="text-center text-[10px] text-slate-600 font-bold uppercase tracking-widest py-4">
              — {listings.length} listings shown —
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Marketplace;
