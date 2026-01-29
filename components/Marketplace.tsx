import React, { useState, useMemo } from 'react';
import { Card } from '@/types';
import { THAI_SETS, ONE_PIECE_SETS, JAPANESE_SETS, CURRENCY_SYMBOLS } from '@/constants';

interface MarketplaceProps {
  initialGame?: string;
  onSelectCard: (card: Card) => void;
  onSelectListing?: (listing: any) => void;
  onSellerClick: (seller: any) => void;
  onAddToCart?: (item: any) => void;
  listings?: any[];
  currency?: string;
  exchangeRate?: number;
}

const Marketplace: React.FC<MarketplaceProps> = ({ initialGame = 'all', onSelectCard, onSelectListing, onSellerClick, onAddToCart, listings = [], currency = 'THB', exchangeRate = 1 }) => {
  const [selectedGame, setSelectedGame] = useState(initialGame);
  const [selectedLanguage, setSelectedLanguage] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100000]);

  // Filter Logic
  const filteredListings = useMemo(() => {
    return listings.filter(listing => {
      const card = listing.card_data;
      const set = card.set || '';

      // Game Filter
      let matchesGame = true;
      if (selectedGame === 'pokemon') {
        const isOp = ONE_PIECE_SETS.some(s => set.includes(s));
        matchesGame = !isOp;
      } else if (selectedGame === 'onepiece') {
        matchesGame = ONE_PIECE_SETS.some(s => set.includes(s));
      }

      // Language Filter
      let matchesLanguage = true;
      if (selectedLanguage === 'en') {
        const isThai = THAI_SETS.some(s => set.includes(s) || s.includes(set));
        const isJp = JAPANESE_SETS.some(s => set.includes(s) || s.includes(set));
        matchesLanguage = !isThai && !isJp;
      } else if (selectedLanguage === 'jp') {
        matchesLanguage = JAPANESE_SETS.some(s => set.includes(s) || s.includes(set));
      } else if (selectedLanguage === 'th') {
        matchesLanguage = THAI_SETS.some(s => set.includes(s) || s.includes(set));
      }

      // Price Filter
      const price = listing.price * exchangeRate;
      const matchesPrice = price >= priceRange[0] && price <= priceRange[1];

      // Search Filter
      const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        set.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesGame && matchesLanguage && matchesPrice && matchesSearch;
    }).sort((a, b) => {
      if (sortOrder === 'price_asc') return a.price - b.price;
      if (sortOrder === 'price_desc') return b.price - a.price;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [listings, selectedGame, selectedLanguage, priceRange, searchQuery, sortOrder, exchangeRate]);

  // Count active filters
  const activeFilterCount = [
    selectedGame !== 'all',
    selectedLanguage !== 'all',
    priceRange[0] > 0 || priceRange[1] < 100000
  ].filter(Boolean).length;

  return (
    <div className="space-y-6 animate-fadeIn pb-32">
      {/* Header */}
      <div className="pt-6 px-4">
        <div className="flex justify-between items-end mb-2">
          <div>
            <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg]">Global Exchange</p>
            <h2 className="text-3xl font-black text-white tracking-tighter italic skew-x-[-6deg]">
              Market <span className="text-brand-green">Live</span>
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
              placeholder="Search by card name or set..."
              className="w-full bg-transparent text-white text-xs font-bold focus:outline-none placeholder:text-slate-600 h-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Filter & Sort Bar */}
      <div className="sticky top-0 z-30 bg-brand-darker/95 backdrop-blur-xl border-b border-white/5 py-3 px-4 shadow-2xl">
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
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 w-4 h-4 rounded-full bg-brand-purple text-white text-[8px] flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sort Options */}
          <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
            {[
              { id: 'newest', label: 'New' },
              { id: 'price_asc', label: 'Low $' },
              { id: 'price_desc', label: 'High $' }
            ].map(sort => (
              <button
                key={sort.id}
                onClick={() => setSortOrder(sort.id as any)}
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
            {/* Card Game Filter */}
            <div>
              <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2 block">Card Game</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'all', label: 'All Games' },
                  { id: 'pokemon', label: 'Pokémon' },
                  { id: 'onepiece', label: 'One Piece' }
                ].map(game => (
                  <button
                    key={game.id}
                    onClick={() => setSelectedGame(game.id)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all border ${selectedGame === game.id
                      ? 'bg-brand-cyan/20 text-brand-cyan border-brand-cyan/30'
                      : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10'
                      }`}
                  >
                    {game.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Language Filter */}
            <div>
              <label className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-2 block">Language</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'en', label: 'English' },
                  { id: 'jp', label: 'Japanese' },
                  { id: 'th', label: 'Thai' }
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
                Price Range: {CURRENCY_SYMBOLS[currency] || currency}{priceRange[0].toLocaleString()} - {CURRENCY_SYMBOLS[currency] || currency}{priceRange[1].toLocaleString()}
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="100000"
                  step="500"
                  value={priceRange[0]}
                  onChange={(e) => setPriceRange([Math.min(Number(e.target.value), priceRange[1] - 500), priceRange[1]])}
                  className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-brand-cyan"
                />
                <input
                  type="range"
                  min="0"
                  max="100000"
                  step="500"
                  value={priceRange[1]}
                  onChange={(e) => setPriceRange([priceRange[0], Math.max(Number(e.target.value), priceRange[0] + 500)])}
                  className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-brand-purple"
                />
              </div>
            </div>

            {/* Clear Filters */}
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setSelectedGame('all');
                  setSelectedLanguage('all');
                  setPriceRange([0, 100000]);
                }}
                className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
              >
                <i className="fa-solid fa-xmark mr-2"></i>
                Clear All Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Listings Grid (Machine/Ticket Style) */}
      <div className="grid grid-cols-1 gap-2 px-2">
        {filteredListings.length > 0 ? filteredListings.map((listing) => (
          <div
            key={listing.id}
            onClick={() => onSelectListing ? onSelectListing(listing) : onSelectCard(listing.card_data)}
            className="bg-[#1e293b]/50 border border-white/5 hover:border-brand-cyan/30 rounded-xl p-2 flex gap-3 group active:scale-[0.98] transition-all relative overflow-hidden cursor-pointer"
          >
            {/* Highlight Bar */}
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-brand-cyan to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

            {/* Card Image */}
            <div className="w-20 aspect-[3/4] bg-brand-darker rounded-lg relative overflow-hidden flex-shrink-0 border border-white/10">
              <img
                src={listing.card_data.images?.small || listing.card_data.imageUrl}
                alt="Card"
                className="w-full h-full object-cover"
              />
            </div>

            {/* Card Details */}
            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              <div>
                <div className="flex justify-between items-start">
                  <h3 className="text-white font-bold text-sm truncate pr-2">{listing.card_data.name}</h3>
                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${listing.condition === 'NM' ? 'bg-brand-green/10 text-brand-green border-brand-green/20' :
                    'bg-slate-700 text-slate-300 border-slate-600'
                    }`}>
                    {listing.condition}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide truncate">{listing.card_data.set}</p>
              </div>

              {/* Seller */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (listing.seller) onSellerClick(listing.seller);
                }}
                className="flex items-center gap-1.5 mt-2 bg-black/20 p-1.5 rounded-lg w-fit cursor-pointer hover:bg-white/10 transition-colors"
              >
                <div className="w-4 h-4 rounded-full bg-slate-700 overflow-hidden">
                  {listing.seller?.avatar_url && <img src={listing.seller.avatar_url} className="w-full h-full object-cover" />}
                </div>
                <span className="text-[9px] text-slate-400 font-bold max-w-[80px] truncate">{listing.seller?.display_name || 'Ghost Seller'}</span>
                <span className="text-[8px] text-yellow-500">★ {listing.seller?.rating || '5.0'}</span>
              </div>
            </div>

            {/* Price & Action */}
            <div className="flex flex-col justify-between items-end border-l border-white/5 pl-3 min-w-[80px]">
              <div className="text-right">
                <p className="text-[9px] text-slate-500 font-bold uppercase">Ask Price</p>
                <p className="text-lg font-black text-brand-cyan leading-none">
                  {/* Use CURRENCY_SYMBOLS map if available, else fallback to currency code */}
                  {CURRENCY_SYMBOLS[currency] || currency}{' '}
                  {Math.round(listing.price * exchangeRate).toLocaleString()}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onAddToCart) {
                    onAddToCart({
                      id: listing.id,
                      card: listing.card_data,
                      price: listing.price,
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
        )) : (
          <div className="text-center py-20 px-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4 animate-pulse">
              <i className="fa-solid fa-satellite-dish text-2xl text-slate-600"></i>
            </div>
            <h3 className="text-white font-bold text-sm uppercase tracking-widest mb-1">Signal Lost</h3>
            <p className="text-slate-500 text-xs">No active listings found in this sector.</p>
            <button
              onClick={() => {
                setSelectedGame('all');
                setSelectedLanguage('all');
                setPriceRange([0, 100000]);
              }}
              className="mt-4 text-brand-cyan text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Marketplace;
