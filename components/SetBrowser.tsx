
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ApiSet, pokemonService } from '../services/pokemonService';

interface SetBrowserProps {
  region: string;
  onBack: () => void;
  onSelectSet: (set: ApiSet) => void;
}

const SetBrowser: React.FC<SetBrowserProps> = ({ region, onBack, onSelectSet }) => {
  const [sets, setSets] = useState<ApiSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalSets, setTotalSets] = useState(0);
  const observer = useRef<IntersectionObserver | null>(null);

  const fetchSetPage = async (pageNum: number) => {
    setLoading(true);
    const result = await pokemonService.fetchSets(
      region as 'en' | 'jp' | 'th',
      pageNum,
      9 // Load 9 sets at a time (3 rows)
    );

    // Always update total sets count from API to ensure we have the latest
    if (result.totalCount > 0) {
      setTotalSets(result.totalCount);
    }

    if (pageNum === 1) {
      setSets(result.data);
    } else {
      setSets(prev => [...prev, ...result.data]);
    }

    // Improved hasMore logic: Check if total loaded items is less than total available
    // Note: React state update is async, so we calculate total manually
    const currentTotal = pageNum === 1 ? result.data.length : sets.length + result.data.length;
    setHasMore(currentTotal < result.totalCount);

    setLoading(false);
  };

  useEffect(() => {
    setSets([]);
    setPage(1);
    setHasMore(true);
    fetchSetPage(1);
  }, [region]);

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
      case 'pokemon-jp': return 'Japanese Sets';
      case 'pokemon-th': return 'Thai Sets';
      default: return 'English Sets';
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-24">
      {/* Header */}
      <div className="flex items-center gap-4 pt-4 sticky top-0 bg-brand-darker/95 backdrop-blur-xl z-20 py-4 border-b border-white/5 shadow-lg">
        <button onClick={onBack} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
          <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
        </button>
        <div className="flex-1">
          <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{getRegionTitle()}</h3>
          <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{sets.length} Loaded</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 px-1">
        {sets.map((set, index) => {
          const isLastElement = index === sets.length - 1;
          return (
            <button
              key={`${set.id}-${index}`}
              ref={isLastElement ? lastSetElementRef : null}
              onClick={() => onSelectSet(set)}
              className="group flex flex-col items-center gap-2 active:scale-95 transition-all w-full mb-4"
            >
              <div className="w-full aspect-square glass rounded-3xl p-3 flex items-center justify-center border-white/5 group-hover:border-brand-cyan/30 group-hover:bg-white/[0.03] transition-all relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <img
                  src={set.images.logo}
                  alt={set.name}
                  className="w-full h-full object-contain filter drop-shadow-lg group-hover:scale-110 transition-transform duration-300"
                  loading="lazy"
                />
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

      {loading && (
        <div className="grid grid-cols-3 gap-3 px-1 mt-2">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="aspect-square rounded-2xl glass skeleton opacity-20"></div>
          ))}
        </div>
      )}

      {!hasMore && sets.length > 0 && (
        <div className="text-center py-8 opacity-40">
          <span className="text-[9px] uppercase tracking-widest font-black text-slate-500">End of Registry</span>
        </div>
      )}
    </div>
  );
};

export default SetBrowser;
