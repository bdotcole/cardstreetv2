import React, { useState, useEffect, useRef, useMemo } from 'react';
import { pokemonService, ApiSet } from '../services/pokemonService';
import { Card } from '../types';
import { CURRENCY_SYMBOLS } from '@/constants';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface ExploreProps {
  onSelectCard: (card: Card) => void;
  searchRequest?: { term: string, timestamp: number } | null;
  localListings?: any[];
  currency?: string;
  exchangeRate?: number;
}

const Explore: React.FC<ExploreProps> = ({ onSelectCard, searchRequest, localListings = [], currency = 'THB', exchangeRate = 1 }) => {
  const { t } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'jp' | 'th'>('en');
  const [selectedGame, setSelectedGame] = useState<'pokemon' | 'onepiece'>('pokemon');
  const [sets, setSets] = useState<ApiSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>('');
  const [cards, setCards] = useState<Card[]>([]);
  const [isLoadingSets, setIsLoadingSets] = useState(true);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [sortOption, setSortOption] = useState<'number' | 'priceHigh' | 'priceLow'>('number');

  // In-memory sets cache: avoid re-fetching on language/game toggle
  const setsCache = useRef<Map<string, ApiSet[]>>(new Map());

  // Custom Set Selector State
  const [isSetListOpen, setIsSetListOpen] = useState(false);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [isGameOpen, setIsGameOpen] = useState(false);
  const setListRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<HTMLDivElement>(null);
  const cardListRef = useRef<HTMLDivElement>(null);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (setListRef.current && !setListRef.current.contains(event.target as Node)) setIsSetListOpen(false);
      if (languageRef.current && !languageRef.current.contains(event.target as Node)) setIsLanguageOpen(false);
      if (gameRef.current && !gameRef.current.contains(event.target as Node)) setIsGameOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle Search Request from props
  useEffect(() => {
    if (searchRequest) setSearchTerm(searchRequest.term);
  }, [searchRequest]);

  // ── Fetch Sets — with in-memory cache ────────────────────────────────────────
  useEffect(() => {
    const loadSets = async () => {
      setIsLoadingSets(true);
      if (selectedGame === 'onepiece') {
        setSets([]); setSelectedSetId(''); setCards([]); setIsLoadingSets(false);
        return;
      }
      const cacheKey = `${selectedLanguage}:${selectedGame}`;
      if (setsCache.current.has(cacheKey)) {
        const cached = setsCache.current.get(cacheKey)!;
        setSets(cached);
        if (cached.length > 0) setSelectedSetId(cached[0].id);
        setIsLoadingSets(false);
        return;
      }
      // Restored from 50 -> 300 to ensure all physical sets are accessible
      // Edge caching (s-maxage=3600) prevents this from hurting load times
      const result = await pokemonService.fetchSets(selectedLanguage, 1, 300);
      setsCache.current.set(cacheKey, result.data);
      setSets(result.data);
      if (result.data.length > 0) setSelectedSetId(result.data[0].id);
      else { setSelectedSetId(''); setCards([]); }
      setIsLoadingSets(false);
    };
    loadSets();
  }, [selectedLanguage, selectedGame]);

  // Fetch Cards when set changes
  useEffect(() => {
    if (!selectedSetId || debouncedSearchTerm.length > 2) return;
    const loadCards = async () => {
      setIsLoadingCards(true);
      const apiCards = await pokemonService.fetchCardsBySet(selectedSetId, selectedLanguage);
      setCards(apiCards);
      cardListRef.current?.scrollTo({ top: 0 });
      setIsLoadingCards(false);
    };
    loadCards();
  }, [selectedSetId, debouncedSearchTerm, selectedLanguage]);

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
      const loadCards = async () => {
        setIsLoadingCards(true);
        const apiCards = await pokemonService.fetchCardsBySet(selectedSetId, selectedLanguage);
        setCards(apiCards);
        setIsLoadingCards(false);
      };
      loadCards();
    }
  }, [debouncedSearchTerm, selectedSetId, selectedLanguage]);

  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

  // ── O(1) listing lookups — precomputed Map instead of O(n) .filter() per row ─
  const listingMap = useMemo(() => {
    const map = new Map<string, { count: number; minPrice: number }>();
    for (const l of localListings) {
      const key = l.card_id || l.card_data?.id;
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        if (l.price < existing.minPrice) existing.minPrice = l.price;
      } else {
        map.set(key, { count: 1, minPrice: l.price });
      }
    }
    return map;
  }, [localListings]);

  // Handle scroll for back-to-top button
  const handleScroll = () => {
    if (cardListRef.current) setShowBackToTop(cardListRef.current.scrollTop > 200);
  };

  const scrollToTop = () => cardListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const selectedSet = sets.find(s => s.id === selectedSetId);

  // Sort cards based on option
  const sortedCards = useMemo(() => {
    const sorted = [...cards];
    const getCardNum = (c: Card) => parseInt(c.number.split('/')[0].replace(/[^0-9]/g, '')) || 999999;
    switch (sortOption) {
      case 'priceHigh': return sorted.sort((a, b) => (b.marketPrice || 0) - (a.marketPrice || 0));
      case 'priceLow': return sorted.sort((a, b) => {
        const priceA = a.marketPrice || Infinity, priceB = b.marketPrice || Infinity;
        if (priceA === Infinity && priceB === Infinity) return 0;
        if (priceA === Infinity) return 1;
        if (priceB === Infinity) return -1;
        return priceA - priceB;
      });
      default: return sorted.sort((a, b) => getCardNum(a) - getCardNum(b));
    }
  }, [cards, sortOption]);

  return (
    <div className="flex flex-col h-full animate-fadeIn -mx-6 w-[calc(100%+48px)]">
      {/* Fixed Header Section */}
      <div className="flex-shrink-0 px-6 pt-6 pb-2 space-y-4 bg-brand-darker">
        {/* Search Engine */}
        <div className="relative group">
          <div className="absolute inset-0 bg-brand-cyan/20 blur-md rounded-xl group-focus-within:opacity-100 opacity-0 transition-opacity"></div>
          <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-cyan transition-colors z-10"></i>
          <input
            type="text"
            placeholder={t('explore.searchPlaceholder')}
            className="relative w-full h-12 pl-12 pr-4 bg-[#1e293b] border border-white/10 rounded-xl focus:border-brand-cyan outline-none text-sm font-medium text-white placeholder:text-slate-500 transition-all z-10 shadow-lg"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Database Selectors - Language → Game → Set */}
        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <h2 className="text-white text-lg font-black italic skew-x-[-10deg] uppercase tracking-tighter">
              {t('explore.cardDatabase').split(' ')[0]}
              {t('explore.cardDatabase').split(' ')[1] && (
                <span className="text-brand-cyan"> {t('explore.cardDatabase').split(' ')[1]}</span>
              )}
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-2 z-30 relative">
            {/* Language Dropdown */}
            <div className="relative" ref={languageRef}>
              <button
                onClick={() => { setIsLanguageOpen(!isLanguageOpen); setIsGameOpen(false); }}
                className="w-full h-10 bg-brand-darker rounded-lg px-3 flex items-center justify-between border border-white/10 outline-none focus:border-brand-cyan active:bg-white/5 transition-colors"
              >
                <span className="text-xs font-bold text-slate-300">
                  {selectedLanguage === 'en' ? t('explore.english') : t('explore.thai')}
                </span>
                <i className={`fa-solid fa-chevron-down text-slate-600 text-[10px] transition-transform ${isLanguageOpen ? 'rotate-180' : ''}`}></i>
              </button>
              {isLanguageOpen && (
                <div className="absolute top-full left-0 w-full mt-1 bg-[#0f172a] rounded-xl border border-white/10 shadow-2xl z-50 overflow-hidden">
                  {(['en', 'th'] as const).map((lang) => (
                    <button
                      key={lang}
                      onClick={() => { setSelectedLanguage(lang); setIsLanguageOpen(false); }}
                      className={`w-full px-3 py-2.5 text-left text-xs font-bold transition-colors ${selectedLanguage === lang ? 'text-brand-cyan bg-brand-cyan/10' : 'text-slate-300 hover:bg-white/5'}`}
                    >
                      {lang === 'en' ? t('explore.english') : t('explore.thai')}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Game Dropdown */}
            <div className="relative" ref={gameRef}>
              <button
                onClick={() => { setIsGameOpen(!isGameOpen); setIsLanguageOpen(false); }}
                className="w-full h-10 bg-brand-darker rounded-lg px-3 flex items-center justify-between border border-white/10 outline-none focus:border-brand-cyan active:bg-white/5 transition-colors"
              >
                <span className="text-xs font-bold text-slate-300">Pokémon</span>
                <i className={`fa-solid fa-chevron-down text-slate-600 text-[10px] transition-transform ${isGameOpen ? 'rotate-180' : ''}`}></i>
              </button>
              {isGameOpen && (
                <div className="absolute top-full left-0 w-full mt-1 bg-[#0f172a] rounded-xl border border-white/10 shadow-2xl z-50 overflow-hidden">
                  <button
                    onClick={() => { setSelectedGame('pokemon'); setIsGameOpen(false); }}
                    className={`w-full px-3 py-2.5 text-left text-xs font-bold transition-colors ${selectedGame === 'pokemon' ? 'text-brand-cyan bg-brand-cyan/10' : 'text-slate-300 hover:bg-white/5'}`}
                  >
                    Pokémon
                  </button>
                </div>
              )}
            </div>

            {/* Set Dropdown */}
            <div className="relative" ref={setListRef}>
              {isLoadingSets ? (
                <div className="w-full h-10 bg-white/5 rounded-lg skeleton opacity-20"></div>
              ) : sets.length === 0 ? (
                <div className="w-full h-10 bg-brand-darker rounded-lg px-3 flex items-center border border-white/10">
                  <span className="text-xs font-bold text-slate-500">No sets available</span>
                </div>
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
                    <div className="absolute top-full right-0 w-[280px] max-w-[90vw] mt-2 bg-[#0f172a] rounded-xl border border-white/10 shadow-2xl max-h-80 overflow-y-auto z-50">
                      <div className="sticky top-0 bg-[#0f172a]/95 backdrop-blur-md p-2 border-b border-white/10 z-10 flex justify-between items-center">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 pl-2">{t('explore.selectExpansion')}</span>
                        <span className="text-[9px] font-bold text-brand-cyan bg-brand-cyan/10 px-1.5 rounded">{sets.length} {t('explore.found')}</span>
                      </div>
                      {sets.map(set => (
                        <button
                          key={set.id}
                          onClick={() => { setSelectedSetId(set.id); setIsSetListOpen(false); }}
                          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors text-left group"
                        >
                          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-brand-cyan/20 to-brand-purple/20 rounded-lg border border-white/10">
                            {set.images.logo ? (
                              <img
                                src={set.images.logo}
                                alt=""
                                width={32}
                                height={32}
                                loading="lazy"
                                decoding="async"
                                className="max-h-8 max-w-8 object-contain"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <span className="text-lg font-black text-white/60">{set.name.charAt(0)}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className={`text-xs font-bold truncate block ${selectedSetId === set.id ? 'text-brand-cyan' : 'text-slate-300 group-hover:text-white'}`}>{set.name}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">{set.series || t('explore.expansion')}</span>
                              <span className="text-[8px] text-slate-700 font-bold">•</span>
                              <span className="text-[8px] text-slate-600 font-bold">{set.total} {t('explore.cards')}</span>
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
      </div>

      {/* Scrollable Results Section */}
      <div className="flex-1 overflow-hidden px-6 pb-4">
        <div className="h-full bg-[#1e293b]/50 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl flex flex-col">
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
          ) : cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                <i className="fa-solid fa-box-open text-2xl text-slate-600"></i>
              </div>
              <h3 className="text-white font-bold text-sm uppercase tracking-widest mb-1">{t('explore.noCards')}</h3>
              <p className="text-slate-500 text-xs text-center">
                {selectedGame === 'onepiece' ? t('explore.onePieceSoon') : t('explore.selectSet')}
              </p>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Fixed Header Row */}
              <div className="flex-shrink-0 grid grid-cols-[auto_1fr_auto] gap-4 px-5 py-3 bg-white/5 border-b border-white/5">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                  {t('explore.asset')}
                  <span className="text-[8px] font-bold text-slate-700 normal-case tracking-normal">{sortedCards.length}</span>
                </span>
                <div
                  className="flex items-center justify-end gap-1 cursor-pointer group"
                  onClick={() => setSortOption(prev => {
                    if (prev === 'number') return 'priceHigh';
                    if (prev === 'priceHigh') return 'priceLow';
                    return 'number';
                  })}
                  title="Toggle Sort: Number → Price High → Price Low"
                >
                  <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${sortOption !== 'number' ? 'text-brand-cyan' : 'text-slate-500 group-hover:text-slate-300'}`}>
                    {t('explore.marketPrice')}
                  </span>
                  <div className="flex flex-col -space-y-1 opacity-70 group-hover:opacity-100 transition-opacity">
                    <i className={`fa-solid fa-caret-up text-[8px] ${sortOption === 'priceLow' ? 'text-brand-cyan' : 'text-slate-600'}`}></i>
                    <i className={`fa-solid fa-caret-down text-[8px] ${sortOption === 'priceHigh' ? 'text-brand-cyan' : 'text-slate-600'}`}></i>
                  </div>
                </div>
                <span className="w-8">{/* add button placeholder */}</span>
              </div>

              {/* Scrollable Card List — with CSS content-visibility for layout performance */}
              <div
                ref={cardListRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto divide-y divide-white/[0.03] relative [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)' }}
              >
                {sortedCards.map((card, idx) => {
                  const listing = listingMap.get(card.id);
                  return (
                    <div
                      key={card.id}
                      className="grid grid-cols-[auto_1fr_auto] gap-4 items-center px-5 py-3 active:bg-white/[0.05] transition-colors group cursor-pointer"
                      // content-visibility: auto skips rendering off-screen rows in layout engine
                      // contain-intrinsic-size provides a placeholder height so scrollbar stays accurate
                      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 72px' } as React.CSSProperties}
                      onClick={() => onSelectCard(card)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-14 bg-brand-darker rounded overflow-hidden flex-shrink-0 border border-white/5">
                          <img
                            src={card.imageUrl}
                            width={40}
                            height={56}
                            loading={idx < 10 ? 'eager' : 'lazy'}
                            decoding="async"
                            className="w-full h-full object-contain"
                            alt={card.name}
                          />
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
                        {listing ? (
                          <>
                            <p className="text-brand-green text-sm font-black tracking-tight">Buy from {currencySymbol}{Math.round((listing.minPrice || 0) * exchangeRate).toLocaleString()}</p>
                            <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">{listing.count} {t('explore.listings')}</p>
                          </>
                        ) : (
                          <p className="text-white text-sm font-black tracking-tight">
                            {(!card.marketPrice || card.marketPrice === 0)
                              ? 'N/A'
                              : currency === 'USD'
                                ? `${currencySymbol}${(card.marketPrice * exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : `${currencySymbol}${Math.round(card.marketPrice * exchangeRate).toLocaleString()}`
                            }
                          </p>
                        )}
                      </div>

                      <div className="text-right">
                        <button className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${listing ? 'bg-brand-green text-brand-darker hover:bg-white' : 'bg-white/5 text-brand-cyan hover:bg-brand-cyan/20'}`}>
                          {listing ? <i className="fa-solid fa-cart-shopping text-[10px]"></i> : <i className="fa-solid fa-plus text-[10px]"></i>}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Back to Top Button */}
                {showBackToTop && (
                  <div className="sticky bottom-4 left-0 right-0 flex justify-center pointer-events-none pb-4">
                    <button
                      onClick={scrollToTop}
                      className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 bg-brand-cyan text-brand-darker rounded-full font-bold text-xs uppercase tracking-wider shadow-lg shadow-brand-cyan/30 hover:bg-white active:scale-95 transition-all"
                    >
                      <i className="fa-solid fa-arrow-up text-xs"></i>
                      {t('common.backToTop') || 'Back to Top'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Explore;