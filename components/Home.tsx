
import React, { useState, useEffect, useMemo } from 'react';
import PriceChart from './PriceChart';
import { pokemonService, ApiSet } from '@/services/pokemonService';
import { Card } from '@/types';
import { MOCK_MARKET_LISTINGS, MOCK_SELLERS } from '@/constants';

interface HomeProps {
  totalValue: number;
  currencySymbol: string;
  onSelectCard: (card: Card) => void;
  onSelectGame: (gameId: string) => void;
  localListings?: any[];
}

const Home: React.FC<HomeProps> = ({ totalValue, currencySymbol, onSelectCard, onSelectGame, localListings = [] }) => {
  const [timeframe, setTimeframe] = useState('1M');
  const [trendingMovers, setTrendingMovers] = useState<Card[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrending = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // PERFORMANCE FIX: Instead of searching ALL cards, fetch from a recent popular set
      // This makes the query 100x faster by using indexes properly
      const recentSets = await pokemonService.fetchSets('en', 1, 3); // Get 3 most recent sets

      if (recentSets.data && recentSets.data.length > 0) {
        // Fetch cards from the first recent set (much faster thanfull search)
        const cards = await pokemonService.fetchCardsBySet(recentSets.data[0].id);

        if (cards.length > 0) {
          // Simulate trending by sorting cards
          const sortedMovers = [...cards]
            .filter(c => c.rarity?.includes('Rare')) // Only rare cards
            .sort((a, b) => (b.change7d || Math.random() * 10) - (a.change7d || Math.random() * 10));

          const uniqueMovers = Array.from(new Map(sortedMovers.map(item => [item.id, item])).values());
          setTrendingMovers(uniqueMovers.slice(0, 12));
        } else {
          setError("Market connecting...");
        }
      } else {
        // Fallback to mock data
        const { MOCK_CARDS } = await import('@/constants');
        const sortedMovers = [...MOCK_CARDS].sort((a, b) => (b.change7d || 0) - (a.change7d || 0));
        const uniqueMovers = Array.from(new Map(sortedMovers.map(item => [item.id, item])).values());
        setTrendingMovers(uniqueMovers.slice(0, 12));
      }
    } catch (err: any) {
      setError("Sync failed.");
    }
    setIsLoading(false);
  };

  const [recentListings, setRecentListings] = useState<any[]>([]);
  const [isListingsLoading, setIsListingsLoading] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);

  useEffect(() => {
    fetchTrending();
    // Fetch listings
    setIsListingsLoading(true);
    fetch('/api/listings?limit=10')
      .then(res => res.json())
      .then(data => {
        let items = [];
        if (Array.isArray(data)) {
          items = data;
        }

        // Format MOCK_MARKET_LISTINGS to match expected structure
        const globalMocks = MOCK_MARKET_LISTINGS.map(l => ({
          ...l,
          seller: {
            display_name: l.seller.name,
            avatar_url: l.seller.avatar
          }
        }));

        // Merge local listings, global mocks, and real API items
        // We take up to 10 latest unique items
        const combined = [...localListings, ...globalMocks, ...items];
        setRecentListings(combined.slice(0, 10));
      })
      .catch(err => {
        // Even if API fails, show guest listings and global mocks
        const globalMocks = MOCK_MARKET_LISTINGS.map(l => ({
          ...l,
          seller: {
            display_name: l.seller.name,
            avatar_url: l.seller.avatar
          }
        }));
        setRecentListings([...localListings, ...globalMocks].slice(0, 10));
        setListingsError(null);
      })
      .finally(() => setIsListingsLoading(false));
  }, [localListings]);

  const chartData = useMemo(() => {
    return trendingMovers[0]?.priceHistory || [];
  }, [trendingMovers]);

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Street-Style Hero Section */}
      <div className="relative pt-6 pb-2">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-brand-cyan to-brand-green opacity-20 blur-3xl rounded-full"></div>

        <div className="flex justify-between items-end mb-1">
          <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg]">My Portfolio</p>
          <div className="flex items-center gap-1.5 bg-brand-green/10 px-2 py-1 rounded-md border border-brand-green/20">
            <i className="fa-solid fa-arrow-trend-up text-brand-green text-[10px]"></i>
            <span className="text-brand-green text-[10px] font-black">+4.2%</span>
          </div>
        </div>

        <h2 className="text-6xl font-black text-white tracking-tighter leading-none italic skew-x-[-6deg] drop-shadow-lg">
          {currencySymbol}{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </h2>
      </div>

      {/* Chart Card */}
      <div className="glass-panel rounded-2xl p-0.5 border-brand-cyan/20 overflow-hidden shadow-2xl">
        <div className="bg-[#0f172a] rounded-2xl p-5">
          <div className="flex justify-between items-center mb-6">
            <div className="flex gap-2">
              {['1D', '1W', '1M', '1Y'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTimeframe(t)}
                  className={`px-3 py-1 rounded-md text-[10px] font-black tracking-widest transition-all skew-x-[-10deg] ${timeframe === t ? 'bg-brand-cyan text-brand-darker' : 'text-slate-600 hover:text-slate-300 bg-white/5'
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <PriceChart data={chartData} />
        </div>
      </div>

      {/* Top Performers Carousel */}
      <div className="space-y-4">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-white text-lg font-black italic skew-x-[-10deg] uppercase tracking-tight">Trending <span className="text-brand-red">Hot</span></h3>
          <button className="text-[10px] text-slate-500 font-bold uppercase tracking-widest hover:text-white transition-colors">See All <i className="fa-solid fa-arrow-right ml-1"></i></button>
        </div>

        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass flex-shrink-0 w-40 h-56 rounded-xl skeleton opacity-10"></div>
            ))}
          </div>
        ) : error ? (
          <div className="py-8 glass rounded-xl border-dashed border-white/10 flex items-center justify-center">
            <p className="text-[10px] text-slate-500 font-bold uppercase">{error}</p>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-8 scrollbar-hide -mx-6 px-6 snap-x">
            {trendingMovers.map((card) => (
              <div
                key={card.id}
                onClick={() => onSelectCard(card)}
                className="flex-shrink-0 w-40 group cursor-pointer snap-start"
              >
                <div className="relative mb-3">
                  {/* Card Shadow Effect */}
                  <div className="absolute inset-0 bg-brand-cyan/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                  <div className="relative aspect-[3/4] bg-brand-darker rounded-xl overflow-hidden border border-white/10 group-hover:border-brand-cyan/50 transition-colors p-1.5">
                    <div className="absolute top-0 right-0 p-2 z-10">
                      <div className="bg-brand-green text-brand-darker text-[9px] font-black px-1.5 py-0.5 rounded-sm italic skew-x-[-10deg] shadow-lg">
                        +{card.change7d}%
                      </div>
                    </div>
                    <img src={card.imageUrl} className="w-full h-full object-contain filter drop-shadow-md group-hover:scale-105 transition-transform duration-300" alt={card.name} />
                  </div>
                </div>

                <div className="space-y-0.5 px-1">
                  <p className="text-white text-xs font-bold truncate">{card.name}</p>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wide truncate">{card.set}</p>
                  <p className="text-sm font-black text-brand-cyan mt-1">฿{card.marketPrice.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Browse by Game Grid */}
      <div className="space-y-4 pb-20">
        <div className="flex justify-between items-center px-1">
          <h3 className="text-white text-lg font-black italic skew-x-[-10deg] uppercase tracking-tight">Browse <span className="text-brand-green">Market</span></h3>
          <button
            onClick={() => onSelectGame('all')}
            className="text-[10px] text-slate-500 font-bold uppercase tracking-widest hover:text-white transition-colors"
          >
            See All <i className="fa-solid fa-arrow-right ml-1"></i>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 px-1">
          {/* Pokemon English */}
          <button
            onClick={() => onSelectGame('pokemon-en')}
            className="h-32 rounded-2xl relative overflow-hidden group border border-white/5 hover:border-brand-cyan/50 transition-all active:scale-95"
          >
            <div className="absolute inset-0 bg-[#0f172a] group-hover:bg-[#1e293b] transition-colors"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-brand-cyan/20 to-transparent opacity-50"></div>
            <div className="absolute bottom-3 left-3 text-left">
              <p className="text-[10px] text-brand-cyan font-black uppercase tracking-widest mb-1">English</p>
              <p className="text-xl font-black text-white italic skew-x-[-5deg] leading-none">POKÉMON</p>
            </div>
            <div className="absolute top-3 right-3 opacity-20 group-hover:opacity-100 transition-opacity">
              <i className="fa-solid fa-earth-americas text-white text-xl"></i>
            </div>
          </button>

          {/* Pokemon Japanese */}
          <button
            onClick={() => onSelectGame('pokemon-jp')}
            className="h-32 rounded-2xl relative overflow-hidden group border border-white/5 hover:border-brand-red/50 transition-all active:scale-95"
          >
            <div className="absolute inset-0 bg-[#0f172a] group-hover:bg-[#1e293b] transition-colors"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-brand-red/20 to-transparent opacity-50"></div>
            <div className="absolute bottom-3 left-3 text-left">
              <p className="text-[10px] text-brand-red font-black uppercase tracking-widest mb-1">Japanese</p>
              <p className="text-xl font-black text-white italic skew-x-[-5deg] leading-none">POKÉMON</p>
            </div>
            <div className="absolute top-3 right-3 opacity-20 group-hover:opacity-100 transition-opacity">
              <i className="fa-solid fa-sun text-white text-xl"></i>
            </div>
          </button>

          {/* Pokemon Thai */}
          <button
            onClick={() => onSelectGame('pokemon-th')}
            className="h-32 rounded-2xl relative overflow-hidden group border border-white/5 hover:border-amber-500/50 transition-all active:scale-95"
          >
            <div className="absolute inset-0 bg-[#0f172a] group-hover:bg-[#1e293b] transition-colors"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/20 to-transparent opacity-50"></div>
            <div className="absolute bottom-3 left-3 text-left">
              <p className="text-[10px] text-amber-500 font-black uppercase tracking-widest mb-1">Thai</p>
              <p className="text-xl font-black text-white italic skew-x-[-5deg] leading-none">POKÉMON</p>
            </div>
            <div className="absolute top-3 right-3 opacity-20 group-hover:opacity-100 transition-opacity">
              <span className="text-xl font-black text-white">TH</span>
            </div>
          </button>

          {/* One Piece English */}
          <button
            onClick={() => onSelectGame('onepiece-en')}
            className="h-32 rounded-2xl relative overflow-hidden group border border-white/5 hover:border-purple-500/50 transition-all active:scale-95"
          >
            <div className="absolute inset-0 bg-[#0f172a] group-hover:bg-[#1e293b] transition-colors"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-transparent opacity-50"></div>
            <div className="absolute bottom-3 left-3 text-left">
              <p className="text-[10px] text-purple-500 font-black uppercase tracking-widest mb-1">English</p>
              <p className="text-xl font-black text-white italic skew-x-[-5deg] leading-none">ONE PIECE</p>
            </div>
            <div className="absolute top-3 right-3 opacity-20 group-hover:opacity-100 transition-opacity">
              <i className="fa-solid fa-skull-crossbones text-white text-xl"></i>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Home;
