'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePremium } from '@/lib/hooks/usePremium';
import { useTranslation } from '@/lib/hooks/useTranslation';
import TradeFinder from '@/components/TradeFinder';

// Standalone route for the Trade Finder. /trade?code=TR-XXXXXX is the deep
// link a trade QR encodes — the matcher runs immediately on arrival. Client
// gate is UX only; every /api/trade/* route holds the authoritative premium lock.

function TradePageInner() {
  const { loading, hasFeature } = usePremium();
  const { t } = useTranslation();
  const code = useSearchParams()?.get('code') ?? undefined;

  return (
    <main className="min-h-screen bg-brand-darker text-white px-5 py-10">
      <div className="w-full max-w-[480px] mx-auto mb-4">
        <Link
          href="/premium"
          aria-label="Back"
          className="inline-flex w-10 h-10 rounded-xl glass border-white/10 items-center justify-center active:scale-90 transition-all"
        >
          <i className="fa-solid fa-chevron-left text-slate-400 text-sm"></i>
        </Link>
      </div>
      {loading ? (
        <div className="min-h-[60vh] flex items-center justify-center">
          <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl"></i>
        </div>
      ) : hasFeature('trade_finder') ? (
        <TradeFinder initialCode={code} />
      ) : (
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-full max-w-[400px] glass rounded-[2rem] border-white/10 p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-5">
              <i className="fa-solid fa-right-left text-brand-cyan text-xl"></i>
            </div>
            <h1 className="text-2xl font-black tracking-tight uppercase italic skew-x-[-10deg]">{t('pro.tradeTitle')}</h1>
            <p className="text-sm text-slate-400 mt-3 leading-relaxed">{t('pro.trade.upsellDesc')}</p>
            <a href="/premium" className="mt-6 block rounded-2xl bg-brand-cyan/10 border border-brand-cyan/20 p-4 active:scale-95 transition-all">
              <p className="text-[11px] text-brand-cyan font-black uppercase tracking-widest">{t('pro.title')}</p>
              <p className="text-xs text-slate-300 mt-2 leading-snug">{t('pro.partOfPro')}</p>
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={null}>
      <TradePageInner />
    </Suspense>
  );
}
