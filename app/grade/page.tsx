'use client';

import React from 'react';
import { usePremium } from '@/lib/hooks/usePremium';
import { useTranslation } from '@/lib/hooks/useTranslation';
import AiCardGrader from '@/components/AiCardGrader';

// Standalone page for the AI Card Grader so the premium feature ships without
// surgery on the ~1k-line app shell. The client gate below is UX only; the
// /api/grade route holds the authoritative premium lock.
export default function GradePage() {
  const { loading, hasFeature } = usePremium();
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-brand-darker text-white px-5 py-10 flex flex-col items-center justify-center">
      {loading ? (
        <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl"></i>
      ) : hasFeature('ai_grader') ? (
        <AiCardGrader />
      ) : (
        <div className="w-full max-w-[400px] glass rounded-[2rem] border-white/10 p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-5">
            <i className="fa-solid fa-wand-magic-sparkles text-brand-cyan text-xl"></i>
          </div>
          <h1 className="text-2xl font-black tracking-tight uppercase italic skew-x-[-10deg]">{t('pro.graderTitle')}</h1>
          <p className="text-sm text-slate-400 mt-3 leading-relaxed">{t('pro.graderDesc')}</p>
          <a href="/premium" className="mt-6 block rounded-2xl bg-brand-cyan/10 border border-brand-cyan/20 p-4 active:scale-95 transition-all">
            <p className="text-[11px] text-brand-cyan font-black uppercase tracking-widest">{t('pro.title')}</p>
            <p className="text-xs text-slate-300 mt-2 leading-snug">{t('pro.partOfPro')}</p>
          </a>
          <p className="text-[10px] text-slate-600 mt-5 leading-snug">{t('pro.grader.disclaimerShort')}</p>
        </div>
      )}
    </main>
  );
}
