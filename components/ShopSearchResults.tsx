'use client';

import React from 'react';
import type { ShopSearchResult } from '@/lib/shopSearch';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * Shops matching a search, as one swipeable row above the card results
 * (mobile Explore and Marketplace). A row rather than list items so a name
 * that also matches cards ("Pikachu Shop") costs the card list one line.
 */
export default function ShopSearchResults({
    shops,
    onSelect,
    className = '',
}: {
    shops: ShopSearchResult[];
    onSelect: (shop: ShopSearchResult) => void;
    className?: string;
}) {
    const { t, isThai } = useTranslation();
    if (shops.length === 0) return null;

    return (
        <div className={className}>
            <p className={`px-1 mb-2 flex items-center gap-1.5 text-[9px] font-black text-slate-500 uppercase ${isThai ? 'tracking-normal' : 'tracking-widest'}`}>
                <i className="fa-solid fa-store text-[9px]"></i>
                {t('shopSearch.title')}
            </p>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
                {shops.map((shop) => {
                    const name = shop.display_name || shop.username || 'Seller';
                    return (
                        <button
                            key={shop.id}
                            onClick={() => onSelect(shop)}
                            className="shrink-0 max-w-[220px] flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 hover:border-brand-cyan/40 active:scale-[0.98] transition-all text-left"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={shop.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${shop.id}`}
                                alt=""
                                className="w-9 h-9 rounded-full object-cover bg-slate-900 shrink-0"
                            />
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-white truncate flex items-center gap-1">
                                    <span className="truncate">{name}</span>
                                    {shop.is_verified_shop && <i className="fa-solid fa-circle-check text-brand-cyan text-[10px] shrink-0"></i>}
                                </p>
                                <p className={`text-[10px] truncate ${shop.paused ? 'text-amber-300/80' : 'text-slate-500'}`}>
                                    {shop.paused ? t('shopSearch.paused') : t('shopSearch.listings').replace('{n}', shop.listing_count.toLocaleString())}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
