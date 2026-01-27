
import React, { useEffect, useState, useMemo } from 'react';
import { ApiSet, pokemonService } from '../services/pokemonService';
import { Card } from '../types';

interface MasterSetDetailProps {
  set: ApiSet;
  ownedCardIds: Set<string>;
  onBack: () => void;
  onCardClick?: (card: Card) => void;
}

const MasterSetDetail: React.FC<MasterSetDetailProps> = ({ set, ownedCardIds, onBack, onCardClick }) => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCards = async () => {
      setLoading(true);
      const data = await pokemonService.fetchCardsBySet(set.id);

      // Sort: First by number (attempting numeric sort), then fallback string
      const sortedData = data.sort((a: any, b: any) => {
        const numA = parseInt(a.number.split('/')[0]);
        const numB = parseInt(b.number.split('/')[0]);
        return (!isNaN(numA) && !isNaN(numB)) ? numA - numB : a.number.localeCompare(b.number);
      });

      setCards(sortedData);
      setLoading(false);
    };
    loadCards();
  }, [set.id]);

  const progress = useMemo(() => {
    if (cards.length === 0) return 0;
    const ownedCount = cards.filter(c => ownedCardIds.has(c.id)).length;
    return Math.round((ownedCount / cards.length) * 100);
  }, [cards, ownedCardIds]);

  const ownedCount = useMemo(() => {
    return cards.filter(c => ownedCardIds.has(c.id)).length;
  }, [cards, ownedCardIds]);

  return (
    <div className="space-y-6 animate-fadeIn pb-24 h-full flex flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 bg-brand-darker/95 backdrop-blur-xl z-20 pb-4 border-b border-white/5 pt-4 -mx-6 px-6 shadow-2xl">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={onBack} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
            <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-white text-lg font-black uppercase tracking-tight italic skew-x-[-10deg] truncate">{set.name}</h3>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-brand-cyan font-black uppercase tracking-widest">{ownedCount}/{cards.length} Collected</span>
              <span className="text-[9px] text-slate-600 font-bold">•</span>
              <span className="text-[9px] text-slate-500 font-bold uppercase">{set.series}</span>
            </div>
          </div>
          {set.images?.logo && (
            <img src={set.images.logo} className="h-8 object-contain" alt="logo" />
          )}
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand-cyan to-brand-green transition-all duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3 px-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => (
            <div key={i} className="aspect-[3/4] rounded-2xl glass skeleton opacity-20"></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 px-1">
          {cards.map((card) => {
            const isOwned = ownedCardIds.has(card.id);
            return (
              <div
                key={card.id}
                onClick={() => onCardClick?.(card)}
                className={`relative aspect-[3/4] rounded-xl overflow-hidden transition-all duration-500 group ${isOwned ? 'glass border-brand-cyan/30 shadow-lg shadow-brand-cyan/10' : 'bg-white/[0.02] border border-white/5'}`}
              >
                {/* Background Image (Ghost if unowned) */}
                <img
                  src={card.imageUrl}
                  alt={card.name}
                  loading="lazy"
                  className={`w-full h-full object-cover transition-all duration-500 ${isOwned ? 'opacity-100' : 'opacity-20 grayscale blur-[1px]'}`}
                />

                {/* Unowned Overlay */}
                {!isOwned && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-2">
                    <span className="text-xl font-black text-white/40 drop-shadow-md">{card.number.split('/')[0]}</span>
                    <span className="text-[8px] text-slate-600 font-bold uppercase tracking-widest text-center leading-tight mt-1 line-clamp-2">{card.name}</span>
                  </div>
                )}

                {/* Owned Indicator */}
                {isOwned && (
                  <div className="absolute top-1 right-1 z-10">
                    <div className="w-5 h-5 rounded-full bg-brand-green flex items-center justify-center shadow-md">
                      <i className="fa-solid fa-check text-[10px] text-brand-darker font-bold"></i>
                    </div>
                  </div>
                )}

                {/* Number Badge (Always visible small at bottom if owned) */}
                {isOwned && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm p-1 text-center">
                    <span className="text-[8px] text-white font-bold tracking-wider">{card.number}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MasterSetDetail;
