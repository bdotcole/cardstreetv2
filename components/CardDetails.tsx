import React, { useState } from 'react';
import { Card } from '../types';
import PriceChart from './PriceChart';
import { THAI_SETS, CURRENCY_SYMBOLS } from '@/constants';

interface CardDetailsProps {
  card: Card;
  isWishlisted: boolean;
  onClose: () => void;
  onAddToCollection: (card: Card) => void;
  onToggleWishlist: (card: Card) => void;
  onShopNow?: () => void;
  listings?: any[];
  actionButtons?: React.ReactNode;
  onAddToCart?: (item: any) => void;
  currency?: string;
  exchangeRate?: number;
}

const CardDetails: React.FC<CardDetailsProps> = ({
  card,
  isWishlisted,
  onClose,
  onAddToCollection,
  onToggleWishlist,
  onShopNow,
  listings = [],
  actionButtons,
  onAddToCart,
  currency = 'THB',
  exchangeRate = 1
}) => {

  const [imageLoaded, setImageLoaded] = useState(false);

  const getGradedValue = (basePrice: number, multiplier: number) => {
    return Math.round(basePrice * multiplier * displayExchangeRate);
  };

  // Thai Price Adjustment Logic
  // If the card is from a Thai set, we assume the market data (mocked) is based on JP values or needs this adjustment per user request.
  // "Update the Thai market price to 55% of the Japanese counterpart market value"
  const isThaiSet = THAI_SETS.some(s => card.set.includes(s) || s.includes(card.set));
  const priceAdjustment = isThaiSet ? 0.55 : 1.0;

  const displayExchangeRate = exchangeRate * priceAdjustment;

  // Format helper
  const formatPrice = (price: number) => {
    if (!price) return '---';
    return Math.round(price * displayExchangeRate).toLocaleString();
  };

  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

  // Prioritize hires images if available
  const displayImageUrl = card.imageUrl;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-brand-darker animate-slideUp">
      {/* Header with Wishlist Toggle */}
      <div className="px-6 py-6 flex justify-between items-center sticky top-0 z-10 bg-brand-darker/80 backdrop-blur-lg border-b border-white/5">
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 active:bg-brand-cyan active:text-brand-darker transition-all border border-white/5"
        >
          <i className="fa-solid fa-chevron-left text-sm"></i>
        </button>
        <div className="text-center">
          <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-cyan block">Asset Details</span>
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{card.number}</span>
        </div>
        <button
          onClick={() => onToggleWishlist(card)}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/5 active:scale-90 transition-all group"
        >
          <i className={`fa-solid fa-heart transition-colors ${isWishlisted ? 'text-brand-red' : 'text-slate-500 group-hover:text-brand-red'}`}></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-40 scrollbar-hide bg-dots">
        {/* Card Image Showcase with Lazy Loading & High-Res Priority */}
        <div className="p-8 flex justify-center relative min-h-[380px]">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-cyan/5 to-transparent pointer-events-none"></div>

          {/* Skeleton Loader - Matches Card Aspect Ratio */}
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center z-0">
              <div className="w-[280px] aspect-[3/4] glass rounded-xl animate-pulse flex items-center justify-center border border-white/10 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-white/5 via-white/10 to-transparent"></div>
                <i className="fa-solid fa-image text-white/10 text-4xl"></i>
              </div>
            </div>
          )}

          {/* Main Image with Lazy Loading */}
          <img
            src={displayImageUrl}
            alt={card.name}
            loading="lazy"
            decoding="async"
            onLoad={() => setImageLoaded(true)}
            className={`w-full max-w-[280px] drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] transition-all duration-700 ease-out z-10 ${imageLoaded ? 'opacity-100 scale-100 blur-0' : 'opacity-0 scale-95 blur-sm'}`}
          />
        </div>

        <div className="px-6 space-y-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-brand-cyan text-brand-darker px-2 py-0.5 rounded text-[9px] font-black uppercase italic skew-x-[-10deg] shadow-lg shadow-brand-cyan/20">{card.rarity}</span>
              <span className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">{card.set}</span>
            </div>
            <h1 className="text-3xl font-black text-white leading-none tracking-tight">{card.name}</h1>
            <h2 className="text-lg font-bold text-slate-500 tracking-wide">{card.thaiName}</h2>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#1e293b]/50 backdrop-blur-sm p-4 rounded-2xl border border-white/5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-12 h-12 bg-brand-cyan/10 rounded-bl-3xl"></div>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">Spot Price</p>
              <p className="text-2xl font-black text-white">
                {currencySymbol} {formatPrice(card.prices?.market || card.marketPrice)}
              </p>
              <div className="mt-2 text-[8px] text-brand-green font-bold uppercase tracking-widest flex items-center gap-1">
                <i className="fa-solid fa-arrow-trend-up"></i> +3.2%
              </div>
            </div>
            <div className="bg-[#1e293b]/50 backdrop-blur-sm p-4 rounded-2xl border border-white/5">
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">Market High</p>
              <p className="text-2xl font-black text-brand-red">
                {currencySymbol} {formatPrice(card.prices?.high || 45000)}
              </p>
              <div className="mt-2 text-[8px] text-slate-500 font-bold uppercase tracking-widest">Peak</div>
            </div>
          </div>

          <div className="bg-[#1e293b]/50 rounded-2xl border border-white/5 p-4">
            <PriceChart data={card.priceHistory} />
          </div>

          {/* Marketplace Listings (Individual Sellers) */}
          <div className="space-y-4">
            <h3 className="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider px-1 border-l-4 border-brand-green pl-3">Marketplace Availability</h3>
            <div className="space-y-2">
              {listings.filter(l => l.card_data.id === card.id || (l.card_data.name === card.name && l.card_data.set === card.set)).length > 0 ? (
                listings
                  .filter(l => l.card_data.id === card.id || (l.card_data.name === card.name && l.card_data.set === card.set))
                  .map((listing, idx) => (
                    <div key={idx} className="bg-white/[0.03] p-4 rounded-xl border border-white/5 flex justify-between items-center group hover:border-brand-green/30 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-800 overflow-hidden border border-white/10 flex-shrink-0">
                          {listing.seller.avatar_url ? (
                            <img src={listing.seller.avatar_url} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-slate-500">?</div>
                          )}
                        </div>
                        <div>
                          <p className="text-white text-xs font-bold">{listing.seller.display_name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-brand-green font-black uppercase tracking-widest">{listing.condition}</span>
                            <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                            <span className="text-[8px] text-slate-500 font-bold uppercase">{listing.seller.rating || 5.0} ★</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex items-center gap-4">
                        <div>
                          <p className="text-white text-base font-black italic">
                            {currencySymbol} {Math.round(listing.price * exchangeRate).toLocaleString()}
                          </p>
                          <p className="text-[8px] text-slate-600 font-bold uppercase tracking-widest">+ Free Ship</p>
                        </div>
                        <button
                          onClick={() => onAddToCart && onAddToCart({
                            id: listing.id || Math.random().toString(),
                            card: listing.card_data,
                            price: listing.price,
                            sellerName: listing.seller.display_name,
                            condition: listing.condition
                          })}
                          className="bg-brand-green text-brand-darker text-[9px] font-black px-4 py-2 rounded-lg hover:bg-white transition-colors active:scale-95 shadow-lg shadow-brand-green/10"
                        >
                          BUY
                        </button>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="py-8 border border-dashed border-white/5 rounded-xl text-center">
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">No listings available for this item</p>
                  <button className="mt-2 text-[9px] text-brand-cyan font-black uppercase tracking-widest hover:text-white transition-colors">Notify me on drop</button>
                </div>
              )}
            </div>
          </div>

          {/* Graded Section */}
          <div className="space-y-4">
            <h3 className="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider px-1 border-l-4 border-brand-cyan pl-3">Graded Dashboard</h3>
            <div className="space-y-2">
              {[
                { label: "PSA 10", grade: "Gem Mint", multiplier: 3.5, color: "text-brand-cyan" },
                { label: "BGS 9.5", grade: "Gem Mint", multiplier: 3.2, color: "text-brand-green" },
                { label: "CGC 10", grade: "Pristine", multiplier: 3.4, color: "text-brand-red" }
              ].map((graded, idx) => (
                <div key={idx} className="flex justify-between items-center bg-white/[0.03] p-4 rounded-xl border border-white/5 hover:border-brand-cyan/30 transition-all cursor-default">
                  <div>
                    <p className="font-black text-white text-sm tracking-tight">{graded.label}</p>
                    <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">{graded.grade}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-black text-base ${graded.color}`}>
                      {currencySymbol} {getGradedValue(card.prices?.market || card.marketPrice, graded.multiplier).toLocaleString()}
                    </p>
                    <p className="text-[8px] text-slate-600 font-bold tracking-widest">{graded.multiplier}x Prem.</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      {actionButtons ? actionButtons : (
        <div className="fixed bottom-0 left-0 w-full p-6 bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 flex gap-3 z-20">
          <button
            onClick={() => onAddToCollection(card)}
            className="flex-1 h-14 bg-white/5 border border-white/10 text-white hover:bg-white/10 font-black text-[10px] tracking-[0.2em] rounded-xl active:scale-95 transition-all uppercase flex items-center justify-center gap-2 group"
          >
            <i className="fa-solid fa-vault text-brand-cyan group-hover:scale-110 transition-transform"></i>
            ADD TO VAULT
          </button>
          <button
            onClick={onShopNow}
            className="flex-1 h-14 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black text-[10px] tracking-[0.2em] rounded-xl shadow-lg shadow-brand-cyan/20 active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-store"></i>
            SHOP NOW
          </button>
        </div>
      )}
    </div>
  );
};

export default CardDetails;