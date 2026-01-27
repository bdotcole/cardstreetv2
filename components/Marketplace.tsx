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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');

  // Filter Logic
  const filteredListings = useMemo(() => {
    return listings.filter(listing => {
      const card = listing.card_data;
      const set = card.set || '';

      // Game Filter
      let matchesGame = true;
      if (selectedGame === 'pokemon-th') {
        matchesGame = THAI_SETS.some(s => set.includes(s) || s.includes(set));
      } else if (selectedGame === 'pokemon-jp') {
        matchesGame = JAPANESE_SETS.some(s => set.includes(s) || s.includes(set));
      } else if (selectedGame === 'onepiece-en') {
        matchesGame = ONE_PIECE_SETS.some(s => set.includes(s));
      } else if (selectedGame === 'pokemon-en') {
        // Assume English if not Thai, JP, or One Piece (simplified logic for MVP)
        const isThai = THAI_SETS.some(s => set.includes(s) || s.includes(set));
        const isJp = JAPANESE_SETS.some(s => set.includes(s) || s.includes(set));
        const isOp = ONE_PIECE_SETS.some(s => set.includes(s));
        matchesGame = !isThai && !isJp && !isOp;
      }

      // Search Filter
      const matchesSearch = card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        set.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesGame && matchesSearch;
    }).sort((a, b) => {
      if (sortOrder === 'price_asc') return a.price - b.price;
      if (sortOrder === 'price_desc') return b.price - a.price;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [listings, selectedGame, searchQuery, sortOrder]);

  return (
    <div className="space-y-6 animate-fadeIn pb-32">
      {/* Header & Stats */}
      <div className="pt-6 px-4">
        <div className="flex justify-between items-end mb-2">
          <div>
            <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg]">Global Exchange</p>
            <h2 className="text-3xl font-black text-white tracking-tighter italic skew-x-[-6deg]">
              Market <span className="text-brand-green">Live</span>
            </h2>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active Listings</p>
            <p className="text-xl font-black text-white">{filteredListings.length}</p>
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

      {/* Sticky Game Filter Tabs */}
      <div className="sticky top-0 z-30 bg-brand-darker/95 backdrop-blur-xl border-b border-white/5 py-3 px-4 shadow-2xl">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {[
            { id: 'all', label: 'All', icon: 'fa-globe' },
            { id: 'pokemon-en', label: 'PKMN EN', icon: 'fa-earth-americas' },
            { id: 'pokemon-jp', label: 'PKMN JP', icon: 'fa-sun' },
            { id: 'pokemon-th', label: 'PKMN TH', icon: 'fa-flag' },
            { id: 'onepiece-en', label: 'One Piece', icon: 'fa-skull-crossbones' }
          ].map((game) => (
            <button
              key={game.id}
              onClick={() => setSelectedGame(game.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-wider whitespace-nowrap transition-all border ${selectedGame === game.id
                ? 'bg-brand-cyan text-brand-darker border-brand-cyan shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-white hover:border-white/20'
                }`}
            >
              <i className={`fa-solid ${game.icon}`}></i>
              {game.label}
            </button>
          ))}
        </div>

        {/* Sort Options */}
        <div className="flex justify-end mt-2">
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
              onClick={() => setSelectedGame('all')}
              className="mt-4 text-brand-cyan text-xs font-bold uppercase tracking-widest hover:text-white transition-colors"
            >
              Reset Sensors
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Marketplace;
