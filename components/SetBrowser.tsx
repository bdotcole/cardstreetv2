
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { ApiSet, pokemonService } from '../services/pokemonService';
import { useTranslation } from '@/lib/hooks/useTranslation';
import Image from 'next/image';

const ImageFallback = ({ src, alt }: { src: string, alt: string }) => {
  const [error, setError] = useState(false);
  
  if (error) {
    return (
      <span className="logo-fallback text-3xl font-black text-slate-500 flex items-center justify-center w-full h-full">
        {alt.charAt(0)}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="150px"
      className="object-contain filter drop-shadow-lg p-2"
      unoptimized={src.includes('asia.pokemon-card.com')}
      onError={() => setError(true)}
    />
  );
};

interface SetBrowserProps {
  region: string;
  onBack: () => void;
  onSelectSet: (set: ApiSet, language: 'en' | 'jp' | 'th') => void;
  ownedCardIds?: Set<string>; // For completion % calculation
}

type SortOption = 'newest' | 'oldest' | 'completion-desc' | 'completion-asc' | 'recent-update';

const SetBrowser: React.FC<SetBrowserProps> = ({ region, onBack, onSelectSet, ownedCardIds = new Set() }) => {
  const [sets, setSets] = useState<ApiSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalSets, setTotalSets] = useState(0);
  const observer = useRef<IntersectionObserver | null>(null);

  // New state for search and sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const { t, isThai } = useTranslation();

  // Close sort menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setIsSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSetPage = async (pageNum: number) => {
    setLoading(true);
    // region is "<game>-<lang>" (e.g. "pokemon-th", "mtg-en"). The game prefix
    // selects the catalog; fetchSets maps the rest to the DB language.
    const game = region?.split('-')[0] || 'pokemon';
    const result = await pokemonService.fetchSets(
      region as 'en' | 'jp' | 'th',
      pageNum,
      50, // Load more at once since we're doing client-side filtering/sorting
      game
    );

    if (result.totalCount > 0) {
      setTotalSets(result.totalCount);
    }

    if (pageNum === 1) {
      setSets(result.data);
    } else {
      setSets(prev => [...prev, ...result.data]);
    }

    const currentTotal = pageNum === 1 ? result.data.length : sets.length + result.data.length;
    setHasMore(currentTotal < result.totalCount);

    setLoading(false);
  };

  useEffect(() => {
    setSets([]);
    setPage(1);
    setHasMore(true);
    setSearchQuery(''); // Reset search on region change
    fetchSetPage(1);
  }, [region]);

  // Extract language from region
  const getLanguageFromRegion = () => {
    if (region?.includes('jp')) return 'jp' as const;
    if (region?.includes('th')) return 'th' as const;
    return 'en' as const;
  };

  // Calculate completion % for a set
  const getSetCompletion = useCallback((set: ApiSet) => {
    if (!ownedCardIds.size || !set.total) return 0;
    // This is a simplified calculation - in production you'd need to fetch set cards
    // and actually check which ones are owned. For now, we'll use a placeholder.
    return 0; // TODO: Implement actual completion tracking
  }, [ownedCardIds]);

  // Filter and sort sets
  const processedSets = useMemo(() => {
    // Filter by search query
    let filtered = sets;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = sets.filter(set =>
        set.name.toLowerCase().includes(query) ||
        (set.series && set.series.toLowerCase().includes(query))
      );
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          // Parse dates properly - handle various formats including empty strings
          const dateA = new Date(a.releaseDate || '1900-01-01');
          const dateB = new Date(b.releaseDate || '1900-01-01');
          return dateA.getTime() - dateB.getTime();
        case 'newest':
          const dateANewer = new Date(a.releaseDate || '1900-01-01');
          const dateBNewer = new Date(b.releaseDate || '1900-01-01');
          return dateBNewer.getTime() - dateANewer.getTime();
        case 'completion-desc':
          return getSetCompletion(b) - getSetCompletion(a);
        case 'recent-update':
          // Sort by updatedAt if available, otherwise releaseDate
          const updateA = new Date(a.updatedAt || a.releaseDate || '1900-01-01');
          const updateB = new Date(b.updatedAt || b.releaseDate || '1900-01-01');
          return updateB.getTime() - updateA.getTime();
        default:
          return 0;
      }
    });

    return sorted;
  }, [sets, searchQuery, sortBy, getSetCompletion]);

  const lastSetElementRef = useCallback((node: HTMLButtonElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prevPage => {
          const nextPage = prevPage + 1;
          fetchSetPage(nextPage);
          return nextPage;
        });
      }
    });
    if (node) observer.current.observe(node);
  }, [loading, hasMore]);

  const getRegionTitle = () => {
    switch (region) {
      case 'pokemon-jp': return isThai ? 'ชุดการ์ดญี่ปุ่น' : 'Japanese Sets';
      case 'pokemon-th': return isThai ? 'ชุดการ์ดไทย' : 'Thai Sets';
      default: return isThai ? 'ชุดการ์ดอังกฤษ' : 'English Sets';
    }
  };

  const getSortLabel = () => {
    switch (sortBy) {
      case 'oldest': return t('vault.oldestFirst');
      case 'newest': return t('vault.newestFirst');
      case 'completion-desc': return t('vault.mostComplete');
      case 'completion-asc': return t('vault.leastComplete');
      case 'recent-update': return t('vault.recentlyUpdated');
      default: return t('vault.newestFirst');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-brand-darker flex flex-col" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 140px)' }}>
      {/* Fixed Header */}
      <div className="flex-none bg-brand-darker/95 backdrop-blur-xl z-20 pb-4 border-b border-white/5 pt-[calc(var(--sat)+1rem)] px-4 shadow-lg">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </button>
          <div className="flex-1">
            <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{getRegionTitle()}</h3>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
              {processedSets.length} {searchQuery ? t('vault.setsFound') : t('vault.sets')}
            </p>
          </div>
        </div>

        {/* Search and Sort Controls */}
        <div className="space-y-3 mt-4">
          {/* Search Bar */}
          <div className="relative group">
            <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-cyan transition-colors z-10"></i>
            <input
              type="text"
              placeholder={t('vault.searchSets')}
              className="w-full h-11 pl-11 pr-4 bg-[#1e293b] border border-white/10 rounded-xl focus:border-brand-cyan outline-none text-sm font-medium text-white placeholder:text-slate-500 transition-all shadow-inner"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <i className="fa-solid fa-xmark text-slate-400 text-xs"></i>
              </button>
            )}
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">{t('vault.sortBy')}: {getSortLabel()}</span>
            <div className="relative" ref={sortMenuRef}>
              <button
                onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                className="h-9 px-3 bg-[#1e293b] border border-white/10 rounded-lg flex items-center gap-2 text-slate-300 hover:text-white hover:border-brand-cyan transition-all active:scale-95"
              >
                <i className="fa-solid fa-arrow-down-wide-short text-xs"></i>
                <span className="text-[10px] font-bold uppercase tracking-wider">{getSortLabel()}</span>
                <i className={`fa-solid fa-chevron-down text-[8px] transition-transform ${isSortMenuOpen ? 'rotate-180' : ''}`}></i>
              </button>

              {isSortMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fadeIn">
                  <div className="p-2 border-b border-white/5 bg-white/[0.02]">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 pl-2">{t('vault.sortOptions')}</span>
                  </div>
                  <div className="p-1">
                    {[
                      { id: 'newest', label: t('vault.newestFirst'), icon: 'fa-calendar-days' },
                      { id: 'oldest', label: t('vault.oldestFirst'), icon: 'fa-clock-rotate-left' },
                      { id: 'completion-desc', label: t('vault.mostComplete'), icon: 'fa-chart-line' },
                      { id: 'recent-update', label: t('vault.recentlyUpdated'), icon: 'fa-rotate' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => { setSortBy(opt.id as SortOption); setIsSortMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-wider mb-1 last:mb-0 transition-colors flex items-center gap-2 ${sortBy === opt.id
                          ? 'bg-brand-cyan/10 text-brand-cyan'
                          : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                      >
                        <i className={`fa-solid ${opt.icon} text-xs w-4`}></i>
                        <span>{opt.label}</span>
                        {sortBy === opt.id && <i className="fa-solid fa-check text-[8px] ml-auto"></i>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Body - Sets Grid */}
      <div className="flex-1 overflow-y-auto p-4 pt-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}>
        {processedSets.length === 0 && !loading ? (
          <div className="text-center py-32 glass rounded-[2.5rem] border-dashed border-white/5 mx-1">
            <i className="fa-solid fa-box-open text-4xl text-slate-800 mb-6"></i>
            <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em] px-12 leading-relaxed">
              {searchQuery ? `${t('vault.noSetsFoundMatching')} "${searchQuery}"` : t('vault.noSetsAvailable')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {processedSets.map((set, index) => {
              const isLastElement = index === processedSets.length - 1 && hasMore;
              const completion = getSetCompletion(set);

              return (
                <button
                  key={`${set.id}-${index}`}
                  ref={isLastElement ? lastSetElementRef : null}
                  onClick={() => onSelectSet(set, getLanguageFromRegion())}
                  className="group flex flex-col items-center gap-2 active:scale-95 transition-all w-full mb-4"
                >
                  <div className="w-full aspect-square glass rounded-3xl p-3 flex items-center justify-center border-white/5 group-hover:border-brand-cyan/30 group-hover:bg-white/[0.03] transition-all relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    {set.images.logo ? (
                      <div className="absolute inset-0 m-3 group-hover:scale-110 transition-transform duration-300">
                        <ImageFallback
                          src={set.images.logo}
                          alt={set.name}
                        />
                      </div>
                    ) : (
                      <span className="text-3xl font-black text-slate-500">{set.name.charAt(0)}</span>
                    )}

                    {/* Completion Badge (if > 0%) </ */}
                    {completion > 0 && (
                      <div className="absolute top-2 right-2 bg-brand-cyan/90 backdrop-blur-sm px-2 py-0.5 rounded-full border border-white/20">
                        <span className="text-[8px] font-black text-brand-darker">{completion}%</span>
                      </div>
                    )}

                    <div className="absolute bottom-1 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <i className="fa-solid fa-chevron-right text-brand-cyan text-xs"></i>
                    </div>
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 text-center leading-tight group-hover:text-white line-clamp-2 uppercase tracking-wide px-1 min-h-[2em] flex items-center justify-center">
                    {set.name.replace(/\(JP\)|\(TH\)/, '')}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-3 gap-3 mt-2">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="aspect-square rounded-2xl glass skeleton opacity-20"></div>
            ))}
          </div>
        )}

        {!hasMore && sets.length > 0 && (
          <div className="text-center py-8 opacity-40">
            <span className="text-[9px] uppercase tracking-widest font-black text-slate-500">{t('vault.endOfRegistry')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetBrowser;
