'use client';

import React from 'react';
import { usePremium } from '@/lib/hooks/usePremium';
import ProInsights from '@/components/ProInsights';

// Standalone route for Pro Insights (the advanced_market premium feature).
// Client gate is UX only; /api/insights holds the authoritative premium lock.
export default function InsightsPage() {
  const { loading, hasFeature } = usePremium();

  return (
    <main className="min-h-screen bg-brand-darker text-white px-5 py-10">
      {loading ? (
        <div className="min-h-[60vh] flex items-center justify-center">
          <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl"></i>
        </div>
      ) : hasFeature('advanced_market') ? (
        <ProInsights />
      ) : (
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-full max-w-[400px] glass rounded-[2rem] border-white/10 p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-5">
              <i className="fa-solid fa-chart-line text-brand-cyan text-xl"></i>
            </div>
            <h1 className="text-2xl font-black tracking-tight uppercase italic skew-x-[-10deg]">Pro Insights</h1>
            <p className="text-sm text-slate-400 mt-3 leading-relaxed">
              Portfolio value history, cost basis and unrealized P/L, top holdings, allocation, and weekly movers — your collection as a portfolio.
            </p>
            <a href="/premium" className="mt-6 block rounded-2xl bg-brand-cyan/10 border border-brand-cyan/20 p-4 active:scale-95 transition-all">
              <p className="text-[11px] text-brand-cyan font-black uppercase tracking-widest">CardStreet Pro</p>
              <p className="text-xs text-slate-300 mt-2 leading-snug">Pro Insights is part of CardStreet Pro. Tap to learn more.</p>
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
