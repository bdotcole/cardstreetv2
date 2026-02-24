
import React, { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { ApiSet, pokemonService } from '../services/pokemonService';
import { Card } from '../types';

interface MasterSetDetailProps {
  set: ApiSet;
  ownedCardIds: Set<string>;
  wishlistCardIds: Set<string>;
  onBack: () => void;
  onCardClick?: (card: Card) => void;
  onToggleWishlist?: (card: Card) => void;
  language?: 'en' | 'jp' | 'th';
}

const MasterSetDetail: React.FC<MasterSetDetailProps> = ({ set, ownedCardIds, wishlistCardIds, onBack, onCardClick, onToggleWishlist, language }) => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Scroll to top when changing sets
    const main = document.querySelector('main');
    if (main) main.scrollTo({ top: 0, behavior: 'instant' });

    const loadCards = async () => {
      setLoading(true);
      const data = await pokemonService.fetchCardsBySet(set.id, language);

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
    <div className="fixed inset-0 z-50 bg-brand-darker flex flex-col">
      {/* Fixed Header */}
      <div className="flex-none bg-brand-darker/95 backdrop-blur-xl z-20 pb-4 border-b border-white/5 pt-[calc(var(--sat)+1rem)] px-4 shadow-2xl">
        <div className="flex items-center gap-4 mb-4 mt-4">
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
            <div className="relative h-8 w-24">
              <Image
                src={set.images.logo}
                alt="logo"
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100px, 100px"
              />
            </div>
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

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => (
              <div key={i} className="aspect-[3/4] rounded-2xl glass skeleton opacity-20"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 pb-24">
            {cards.map((card) => {
              const isOwned = ownedCardIds.has(card.id);
              return (
                <div
                  key={card.id}
                  onClick={() => isOwned && onCardClick?.(card)}
                  className={`relative aspect-[3/4] rounded-xl overflow-hidden transition-all duration-500 group ${isOwned ? 'glass border-brand-cyan/30 shadow-lg shadow-brand-cyan/10 cursor-pointer' : 'bg-white/[0.02] border border-white/5 cursor-default'}`}
                >
                  {/* Background Image (Ghost if unowned) */}
                  <div className={`absolute inset-0 transition-opacity duration-500 ${isOwned ? 'opacity-100' : 'opacity-20 grayscale blur-[1px]'}`}>
                    <Image
                      src={card.images?.small || card.imageUrl}
                      alt={card.name}
                      fill
                      sizes="(max-width: 768px) 33vw, 20vw"
                      className="object-cover"
                      loading="lazy"
                    />
                  </div>

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

                  {/* Wishlist Heart (for unowned cards) */}
                  {!isOwned && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWishlist?.(card);
                      }}
                      className="absolute bottom-2 left-2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-brand-red/20 active:scale-90 transition-all group/wishlist"
                    >
                      <i className={`fa-${wishlistCardIds.has(card.id) ? 'solid' : 'regular'} fa-heart text-xs ${wishlistCardIds.has(card.id) ? 'text-brand-red' : 'text-white/60'} group-hover/wishlist:text-brand-red transition-colors`}></i>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MasterSetDetail;
