import React, { useState, useEffect, useRef } from 'react';
import { pokemonService, ApiSet } from '../services/pokemonService';
import { Card } from '../types';
import { CURRENCY_SYMBOLS } from '@/constants';

interface ExploreProps {
  onSelectCard: (card: Card) => void;
  searchRequest?: { term: string, timestamp: number } | null;
  localListings?: any[];
  currency?: string;
  exchangeRate?: number;
}

const Explore: React.FC<ExploreProps> = ({ onSelectCard, searchRequest, localListings = [], currency = 'THB', exchangeRate = 1 }) => {
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'jp' | 'th'>('en');
  const [selectedGame, setSelectedGame] = useState<'pokemon' | 'onepiece'>('pokemon');
  const [sets, setSets] = useState<ApiSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>('');
  const [cards, setCards] = useState<Card[]>([]);
  const [isLoadingSets, setIsLoadingSets] = useState(true);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Custom Set Selector State
  const [isSetListOpen, setIsSetListOpen] = useState(false);
  const setListRef = useRef<HTMLDivElement>(null);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 400); // 400ms delay

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (setListRef.current && !setListRef.current.contains(event.target as Node)) {
        setIsSetListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle Search Request from props (e.g. from Wishlist "Shop" button)
  useEffect(() => {
    if (searchRequest) {
      setSearchTerm(searchRequest.term);
    }
  }, [searchRequest]);

  // Fetch Sets on mount or language/game change
  useEffect(() => {
    const loadSets = async () => {
      setIsLoadingSets(true);
      // Fetch only first page (50 items) for the dropdown to keep it lightweight initially
      const result = await pokemonService.fetchSets(selectedLanguage, 1, 50);
      setSets(result.data);
      if (result.data.length > 0) {
        setSelectedSetId(result.data[0].id);
      } else {
        setSelectedSetId('');
        setCards([]);
      }
      setIsLoadingSets(false);
    };
    loadSets();
  }, [selectedLanguage, selectedGame]);

  // Fetch Cards when set changes, but ONLY if we aren't performing a text search
  useEffect(() => {
    if (!selectedSetId || debouncedSearchTerm.length > 2) return;
    const loadCards = async () => {
      setIsLoadingCards(true);
      const apiCards = await pokemonService.fetchCardsBySet(selectedSetId);
      setCards(apiCards);
      setIsLoadingCards(false);
    };
    loadCards();
  }, [selectedSetId, debouncedSearchTerm]);

  // Perform search when debounced term changes
  useEffect(() => {
    if (debouncedSearchTerm.length > 2) {
      const performSearch = async () => {
        setIsLoadingCards(true);
        const results = await pokemonService.searchCards(debouncedSearchTerm, false, selectedLanguage);
        setCards(results);
        setIsLoadingCards(false);
      };
      performSearch();
    } else if (debouncedSearchTerm.length === 0 && selectedSetId) {
      // Revert to set view if cleared
      const loadCards = async () => {
        setIsLoadingCards(true);
        const apiCards = await pokemonService.fetchCardsBySet(selectedSetId);
        setCards(apiCards);
        setIsLoadingCards(false);
      };
      loadCards();
    }
  }, [debouncedSearchTerm, selectedSetId, selectedLanguage]);

  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

  const getLowestListingPrice = (card: Card) => {
    // Robust matching: ID or Name+Set
    const matches = localListings.filter(l => l.card_data.id === card.id || (l.card_data.name === card.name && l.card_data.set === card.set));
    if (matches.length === 0) return null;
    return Math.min(...matches.map(m => m.price));
  };

  const getListingCount = (card: Card) => {
    return localListings.filter(l => l.card_data.id === card.id || (l.card_data.name === card.name && l.card_data.set === card.set)).length;
  };

  const selectedSet = sets.find(s => s.id === selectedSetId);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Search Engine */}
      <div className="relative group">
        <div className="absolute inset-0 bg-brand-cyan/20 blur-md rounded-xl group-focus-within:opacity-100 opacity-0 transition-opacity"></div>
        <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-cyan transition-colors z-10"></i>
        <input
          type="text"
          placeholder="Search Card Registry..."
          className="relative w-full h-12 pl-12 pr-4 bg-[#1e293b] border border-white/10 rounded-xl focus:border-brand-cyan outline-none text-sm font-medium text-white placeholder:text-slate-500 transition-all z-10 shadow-lg"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Database Selectors - Cascading: Language → Game → Set */}
      <div className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-white text-lg font-black italic skew-x-[-10deg] uppercase tracking-tighter">Card <span className="text-brand-cyan">Database</span></h2>
        </div>

        <div className="grid grid-cols-3 gap-2 z-30 relative">
          {/* Language Dropdown */}
          <div className="relative">
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as any)}
              className="w-full h-10 bg-brand-darker rounded-lg px-3 text-xs font-bold text-slate-300 border border-white/10 appearance-none outline-none focus:border-brand-cyan"
            >
              <option value="en">English</option>
              <option value="jp">Japanese</option>
              <option value="th">Thai</option>
            </select>
            <i className="fa-solid fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-[10px] pointer-events-none"></i>
          </div>

          {/* Game Dropdown */}
          <div className="relative">
            <select
              value={selectedGame}
              onChange={(e) => setSelectedGame(e.target.value as any)}
              className="w-full h-10 bg-brand-darker rounded-lg px-3 text-xs font-bold text-slate-300 border border-white/10 appearance-none outline-none focus:border-brand-cyan"
            >
              <option value="pokemon">Pokémon</option>
              <option value="onepiece">One Piece</option>
            </select>
            <i className="fa-solid fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-[10px] pointer-events-none"></i>
          </div>

          {/* Set Dropdown */}
          <div className="relative" ref={setListRef}>
            {isLoadingSets ? (
              <div className="w-full h-10 bg-white/5 rounded-lg skeleton opacity-20"></div>
            ) : (
              <>
                <button
                  onClick={() => setIsSetListOpen(!isSetListOpen)}
                  className="w-full h-10 bg-brand-darker rounded-lg px-2 flex items-center justify-between border border-white/10 outline-none focus:border-brand-cyan text-left active:bg-white/5 transition-colors"
                >
                  {selectedSet ? (
                    <span className="text-xs font-bold text-slate-300 truncate pr-4">{selectedSet.name}</span>
                  ) : (
                    <span className="text-xs font-bold text-slate-500">Select Set</span>
                  )}
                  <i className="fa-solid fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 text-[10px]"></i>
                </button>

                {isSetListOpen && (
                  <div className="absolute top-full right-0 w-[240px] max-w-[90vw] mt-2 bg-[#0f172a] rounded-xl border border-white/10 shadow-2xl max-h-80 overflow-y-auto z-50">
                    <div className="sticky top-0 bg-[#0f172a]/95 backdrop-blur-md p-2 border-b border-white/10 z-10 flex justify-between items-center">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 pl-2">Select Expansion</span>
                      <span className="text-[9px] font-bold text-brand-cyan bg-brand-cyan/10 px-1.5 rounded">{sets.length} Found</span>
                    </div>
                    {sets.map(set => (
                      <button
                        key={set.id}
                        onClick={() => { setSelectedSetId(set.id); setIsSetListOpen(false); }}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors text-left group"
                      >
                        <div className="w-12 h-8 flex items-center justify-center flex-shrink-0 bg-white/5 rounded p-1 border border-white/5 group-hover:border-white/10">
                          {set.images.logo ? (
                            <img
                              src={set.images.logo}
                              alt={set.name}
                              className="max-h-full max-w-full object-contain filter group-hover:brightness-110 transition-all"
                              onError={(e) => {
                                // Hide broken image and show fallback
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span className="text-xs font-black text-slate-500">{set.name.charAt(0)}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={`text-xs font-bold truncate block ${selectedSetId === set.id ? 'text-brand-cyan' : 'text-slate-300 group-hover:text-white'}`}>{set.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">{set.series}</span>
                            <span className="text-[8px] text-slate-700 font-bold">•</span>
                            <span className="text-[8px] text-slate-600 font-bold">{set.total} Cards</span>
                          </div>
                        </div>
                        {selectedSetId === set.id && <i className="fa-solid fa-check text-brand-cyan text-xs"></i>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="bg-[#1e293b]/50 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden shadow-2xl min-h-[400px]">
        {isLoadingCards ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="flex gap-4 items-center">
                <div className="w-10 h-14 skeleton rounded-lg opacity-20"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-2 w-32 skeleton rounded opacity-20"></div>
                  <div className="h-1.5 w-20 skeleton rounded opacity-20"></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full">
            <div className="grid grid-cols-[auto_1fr_auto] gap-4 px-5 py-3 bg-white/5 border-b border-white/5">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Asset</span>
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Market Price</span>
              <span></span>
            </div>
            <div className="divide-y divide-white/[0.03]">
              {cards.map(card => (
                <div
                  key={card.id}
                  className="grid grid-cols-[auto_1fr_auto] gap-4 items-center px-5 py-3 active:bg-white/[0.05] transition-colors group cursor-pointer"
                  onClick={() => onSelectCard(card)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-14 bg-brand-darker rounded overflow-hidden flex-shrink-0 border border-white/5">
                      <img src={card.imageUrl} className="w-full h-full object-contain" alt={card.name} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-xs font-bold truncate group-hover:text-brand-cyan transition-colors">{card.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-slate-400 font-bold uppercase">{card.rarity}</span>
                        <span className="text-[9px] text-slate-600 font-bold">#{card.number}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    {getListingCount(card) > 0 ? (
                      <>
                        <p className="text-brand-green text-sm font-black tracking-tight">Buy from {currencySymbol}{Math.round((getLowestListingPrice(card) || 0) * exchangeRate).toLocaleString()}</p>
                        <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">{getListingCount(card)} Listing(s)</p>
                      </>
                    ) : (
                      <p className="text-white text-sm font-black tracking-tight">{currencySymbol}{Math.round(card.marketPrice * exchangeRate).toLocaleString()}</p>
                    )}
                  </div>

                  <div className="text-right">
                    <button className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${getListingCount(card) > 0 ? 'bg-brand-green text-brand-darker hover:bg-white' : 'bg-white/5 text-brand-cyan hover:bg-brand-cyan/20'}`}>
                      {getListingCount(card) > 0 ? <i className="fa-solid fa-cart-shopping text-[10px]"></i> : <i className="fa-solid fa-plus text-[10px]"></i>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Explore;