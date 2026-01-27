
import React, { useMemo, useEffect, useState } from 'react';
import { UserCollectionItem } from '../types';
import { MOCK_CARDS } from '../constants';
import { geminiService } from '../services/geminiService';

interface PortfolioProps {
  collection: UserCollectionItem[];
}

const Portfolio: React.FC<PortfolioProps> = ({ collection }) => {
  const [marketInsight, setMarketInsight] = useState<string | null>(null);
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);

  const totalValue = useMemo(() => {
    return collection.reduce((acc, item) => {
      const card = MOCK_CARDS.find(c => c.id === item.cardId);
      return acc + (card ? card.marketPrice * item.quantity : 0);
    }, 0);
  }, [collection]);

  const totalInvestment = useMemo(() => {
    return collection.reduce((acc, item) => acc + (item.purchasePrice * item.quantity), 0);
  }, [collection]);

  const profitLoss = totalValue - totalInvestment;
  const plPercentage = totalInvestment > 0 ? (profitLoss / totalInvestment) * 100 : 0;

  useEffect(() => {
    const fetchInsights = async () => {
      setIsLoadingInsight(true);
      const insight = await geminiService.getMarketInsights(MOCK_CARDS.map(c => ({ name: c.name, price: c.marketPrice })));
      setMarketInsight(insight);
      setIsLoadingInsight(false);
    };
    fetchInsights();
  }, []);

  return (
    <div className="space-y-8 animate-fadeIn pb-10">
      {/* Portfolio Stats Group */}
      <div className="space-y-4">
        <div className="glass rounded-[2rem] p-8 border border-white/10 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
             <i className="fa-solid fa-vault text-6xl text-amber-500"></i>
          </div>
          <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em] mb-2">Collection Valuation</p>
          <div className="flex items-baseline gap-2">
            <h2 className="text-4xl font-black text-white">฿{totalValue.toLocaleString()}</h2>
            <div className={`flex items-center gap-1 text-sm font-bold ${profitLoss >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
               <i className={`fa-solid ${profitLoss >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-xs`}></i>
               <span>{Math.abs(plPercentage).toFixed(1)}%</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="glass rounded-[2rem] p-6 border border-white/10">
            <p className="text-slate-500 text-[9px] font-bold uppercase tracking-[0.2em] mb-1">Unrealized P/L</p>
            <p className={`text-xl font-black ${profitLoss >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {profitLoss >= 0 ? '+' : ''}฿{profitLoss.toLocaleString()}
            </p>
          </div>
          <div className="glass rounded-[2rem] p-6 border border-white/10">
            <p className="text-slate-500 text-[9px] font-bold uppercase tracking-[0.2em] mb-1">Asset Count</p>
            <p className="text-xl font-black text-white">{collection.length}</p>
          </div>
        </div>
      </div>

      {/* AI Market Advisor (Sophisticated Look) */}
      <div className="bg-amber-500/10 rounded-[2rem] p-6 border border-amber-500/20 relative">
        <div className="flex items-center gap-3 mb-4">
           <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
              <i className="fa-solid fa-microchip text-[#121212] text-xs"></i>
           </div>
           <h3 className="font-bold text-xs uppercase tracking-widest text-amber-500">Market Intelligence Brief</h3>
        </div>
        {isLoadingInsight ? (
          <div className="space-y-2 py-2">
            <div className="h-3 w-full skeleton rounded opacity-20"></div>
            <div className="h-3 w-3/4 skeleton rounded opacity-20"></div>
          </div>
        ) : (
          <div className="text-xs text-slate-400 leading-relaxed font-medium italic">
            "{marketInsight?.split('\n')[0].replace(/[*#]/g, '') || "Reviewing market volatility patterns for Thai TCG assets..."}"
          </div>
        )}
      </div>

      {/* Asset List */}
      <div className="space-y-4">
        <h3 className="font-bold text-white text-[10px] px-2 uppercase tracking-[0.3em] opacity-40">Asset Registry</h3>
        <div className="space-y-3">
          {collection.map(item => {
            const card = MOCK_CARDS.find(c => c.id === item.cardId);
            if (!card) return null;
            const isProfit = card.marketPrice >= item.purchasePrice;
            return (
              <div key={item.id} className="glass p-4 rounded-3xl flex items-center gap-4 border border-white/5 active:bg-white/[0.06] transition-all">
                <div className="w-14 h-20 bg-slate-900 rounded-xl overflow-hidden flex-shrink-0 p-1">
                  <img src={card.imageUrl} className="w-full h-full object-contain filter drop-shadow-lg" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-slate-200 text-sm truncate tracking-tight">{card.name}</h4>
                  <div className="flex items-center gap-2 mt-1">
                     <span className="text-[9px] border border-white/10 text-slate-500 px-2 py-0.5 rounded-full font-bold uppercase">{item.condition}</span>
                     <span className="text-[9px] text-slate-600 font-medium">Qty: {item.quantity}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-white text-sm">฿{card.marketPrice.toLocaleString()}</p>
                  <p className={`text-[10px] font-bold ${isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
                     {isProfit ? '+' : ''}{((card.marketPrice - item.purchasePrice) / item.purchasePrice * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        
        {collection.length === 0 && (
          <div className="text-center py-20 opacity-20">
            <i className="fa-solid fa-box-archive text-4xl mb-4"></i>
            <p className="text-sm font-medium tracking-widest uppercase">Vault is currently empty</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Portfolio;
