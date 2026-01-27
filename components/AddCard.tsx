
import React, { useState, useEffect, useRef } from 'react';
import { pokemonService } from '../services/pokemonService';
import { Card } from '../types';

interface AddCardProps {
  onScanClick: () => void;
  onSelectCard: (card: Card) => void;
}

type AddView = 'options' | 'manual';

const AddCard: React.FC<AddCardProps> = ({ onScanClick, onSelectCard }) => {
  const [view, setView] = useState<AddView>('options');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAiResolving, setIsAiResolving] = useState(false);
  const searchTimeout = useRef<number | null>(null);

  const performSearch = async (val: string) => {
    if (val.length > 2) {
      setIsSearching(true);
      const needsAi = /[\u0E00-\u0E7F]/.test(val) || val.split(' ').length > 1;
      if (needsAi) setIsAiResolving(true);
      
      const data = await pokemonService.searchCards(val);
      
      setResults(data);
      setIsSearching(false);
      setIsAiResolving(false);
    } else {
      setResults([]);
    }
  };

  const handleManualSearchChange = (val: string) => {
    setSearchQuery(val);
    
    if (searchTimeout.current) {
      window.clearTimeout(searchTimeout.current);
    }

    if (val.length > 2) {
      searchTimeout.current = window.setTimeout(() => {
        performSearch(val);
      }, 350);
    } else {
      setResults([]);
    }
  };

  const renderManualView = () => (
    <div className="space-y-6 animate-fadeIn pb-20">
      <div className="flex items-center gap-4 pt-2">
        <button 
          onClick={() => setView('options')}
          className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all"
        >
          <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
        </button>
        <div>
          <h3 className="text-white text-lg font-black tracking-tight uppercase">Registry Search</h3>
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative group">
          <i className="fa-solid fa-magnifying-glass absolute left-5 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-brand-cyan transition-colors"></i>
          <input 
            type="text" 
            autoFocus
            placeholder="Search name, set, number..."
            className="w-full h-14 pl-14 pr-4 bg-white/5 border border-white/10 rounded-2xl focus:border-brand-cyan/50 outline-none text-sm font-medium text-white placeholder:text-slate-600 transition-all"
            value={searchQuery}
            onChange={(e) => handleManualSearchChange(e.target.value)}
          />
        </div>
        
        {isAiResolving && (
          <div className="flex items-center gap-2 px-4 animate-pulse">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-cyan"></div>
            <span className="text-[8px] text-brand-cyan/80 font-black uppercase tracking-[0.2em]">Syncing Multilingual Database...</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {isSearching ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 glass rounded-[2rem] skeleton opacity-10"></div>
            ))}
          </div>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {results.map((card) => (
              <button
                key={card.id}
                onClick={() => onSelectCard(card)}
                className="glass p-5 rounded-[2.2rem] border-white/5 active:scale-[0.97] transition-all group flex items-center gap-5 text-left relative overflow-hidden"
              >
                <div className="w-14 h-20 rounded-xl bg-slate-900 flex items-center justify-center p-1.5 flex-shrink-0 shadow-lg group-hover:scale-105 transition-transform duration-300">
                  <img 
                    src={card.imageUrl} 
                    alt={card.name} 
                    className="w-full h-full object-contain filter drop-shadow-md" 
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-white text-base font-black tracking-tight truncate mb-1 group-hover:text-brand-cyan transition-colors">{card.name}</h4>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{card.set}</span>
                    <span className="text-[9px] text-slate-600 font-black">#{card.number}</span>
                    <span className="px-2 py-0.5 rounded-full bg-white/5 text-[8px] text-brand-cyan/80 font-black uppercase border border-white/5">{card.rarity}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white text-sm font-black">฿{card.marketPrice.toLocaleString()}</p>
                  <p className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">Market</p>
                </div>
              </button>
            ))}
          </div>
        ) : searchQuery.length > 2 ? (
          <div className="text-center py-24 glass rounded-[3rem] border-dashed border-white/10 opacity-30">
            <i className="fa-solid fa-ghost text-4xl mb-4 text-slate-800"></i>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest px-10">No matches in the registry for "{searchQuery}"</p>
          </div>
        ) : (
          <div className="text-center py-20 opacity-10">
            <i className="fa-solid fa-keyboard text-5xl mb-6"></i>
            <p className="text-[10px] font-black uppercase tracking-[0.4em]">Search Live Archives</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderOptions = () => (
    <div className="space-y-8 animate-fadeIn pt-4 pb-12">
      <div className="text-center space-y-3 mb-12 px-4">
        <h2 className="text-3xl font-black text-white tracking-tight uppercase italic skew-x-[-10deg]">Registry Entry</h2>
        <p className="text-[10px] text-slate-600 font-black tracking-[0.3em] uppercase">Digitize your physical collection</p>
      </div>

      <div className="grid grid-cols-1 gap-5">
        <button 
          onClick={onScanClick}
          className="glass min-h-[180px] rounded-[2.5rem] border-white/10 flex flex-col items-center justify-center gap-5 active:scale-95 transition-all group relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-brand-cyan/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="w-20 h-20 rounded-3xl bg-brand-cyan flex items-center justify-center shadow-2xl shadow-brand-cyan/20 transform group-hover:scale-110 group-hover:-rotate-3 transition-transform duration-500 z-10">
            <i className="fa-solid fa-expand text-brand-darker text-3xl"></i>
          </div>
          <div className="text-center z-10">
            <span className="text-xl font-black text-white uppercase tracking-[0.2em] block">Scan Card</span>
            <span className="text-[9px] text-brand-cyan/60 font-black uppercase tracking-[0.4em] mt-1">Real-time Vision AI</span>
          </div>
        </button>

        <button 
          onClick={() => setView('manual')}
          className="glass min-h-[180px] rounded-[2.5rem] border-white/10 flex flex-col items-center justify-center gap-5 active:scale-95 transition-all group relative"
        >
          <div className="w-20 h-20 rounded-3xl glass border-white/10 flex items-center justify-center transform group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500 z-10">
            <i className="fa-solid fa-keyboard text-slate-400 text-2xl"></i>
          </div>
          <div className="text-center z-10">
            <span className="text-xl font-black text-white uppercase tracking-[0.2em] block">Search Registry</span>
            <span className="text-[9px] text-slate-600 font-black uppercase tracking-[0.4em] mt-1">Global Product Archives</span>
          </div>
        </button>
      </div>
    </div>
  );

  return view === 'options' ? renderOptions() : renderManualView();
};

export default AddCard;
