'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * Beta-only fork of the Shop tab: Live Breaks or the regular Marketplace.
 * Rendered by the shell ONLY when the 'live_streams' beta grant resolves true
 * (see components/MobileHome.tsx) — non-beta users never mount this, so it
 * carries the whole chooser UI to keep the shell's own diff minimal.
 */
export default function LiveShopChooser({ onMarketplace }: { onMarketplace: () => void }) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <div className="flex-1 flex flex-col justify-center pb-10">
            <h2 className="text-2xl font-black tracking-tight uppercase italic skew-x-[-10deg] mb-1">
                {t('live.chooser.title') || 'Shop'}
            </h2>
            <p className="text-xs text-slate-400 mb-6">{t('live.chooser.subtitle') || 'Where to today?'}</p>

            <button
                onClick={() => router.push('/live')}
                className="w-full glass rounded-[2rem] border-white/10 p-6 text-left active:scale-[0.98] transition-all mb-4"
            >
                <div className="w-12 h-12 rounded-2xl bg-brand-red/10 flex items-center justify-center mb-4">
                    <i className="fa-solid fa-tower-broadcast text-brand-red text-lg"></i>
                </div>
                <p className="text-lg font-black text-white uppercase tracking-wide flex items-center gap-2">
                    {t('live.chooser.liveBreaks') || 'Live Breaks'}
                    <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse"></span>
                </p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {t('live.chooser.liveBreaksDesc') || 'Watch live rip-and-ship shows and grab break spots'}
                </p>
            </button>

            <button
                onClick={onMarketplace}
                className="w-full glass rounded-[2rem] border-white/10 p-6 text-left active:scale-[0.98] transition-all"
            >
                <div className="w-12 h-12 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mb-4">
                    <i className="fa-solid fa-shop text-brand-cyan text-lg"></i>
                </div>
                <p className="text-lg font-black text-white uppercase tracking-wide">
                    {t('live.chooser.marketplace') || 'Marketplace'}
                </p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {t('live.chooser.marketplaceDesc') || 'Browse singles and sealed from verified sellers'}
                </p>
            </button>
        </div>
    );
}
