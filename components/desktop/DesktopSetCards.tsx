'use client'

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { getThumbnailUrl, shouldSkipNextOptimization, CARD_BLUR_DATA_URL } from '@/lib/imageUtils';
import { useTranslation } from '@/lib/hooks/useTranslation';
import type { Card } from '@/types';

type SortKey = 'number' | 'price_desc' | 'price_asc';

function fmtTHB(n: number): string {
    return `฿${n < 1 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
}

function cardNumber(c: Card): number {
    return parseInt(c.number.split('/')[0].replace(/[^0-9]/g, ''), 10) || 999999;
}

export default function DesktopSetCards({ cards }: { cards: Card[] }) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortKey>('number');

    const processed = useMemo(() => {
        const q = search.trim().toLowerCase();
        const filtered = q
            ? cards.filter(
                  (c) =>
                      c.name.toLowerCase().includes(q) ||
                      c.number.toLowerCase().includes(q) ||
                      (c.rarity || '').toLowerCase().includes(q),
              )
            : cards;
        const sorted = [...filtered];
        switch (sort) {
            case 'price_desc':
                sorted.sort((a, b) => (b.marketPrice || 0) - (a.marketPrice || 0));
                break;
            case 'price_asc':
                sorted.sort((a, b) => {
                    const pa = a.marketPrice || Infinity;
                    const pb = b.marketPrice || Infinity;
                    return pa - pb;
                });
                break;
            default:
                sorted.sort((a, b) => cardNumber(a) - cardNumber(b));
        }
        return sorted;
    }, [cards, search, sort]);

    return (
        <div className="mt-8">
            <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                    <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('desktop.browse.searchInSet')}
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                    />
                </div>
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-brand-cyan/50 [&>option]:bg-brand-dark"
                >
                    <option value="number">{t('desktop.browse.sortNumber')}</option>
                    <option value="price_desc">{t('desktop.sortPriceDesc')}</option>
                    <option value="price_asc">{t('desktop.sortPriceAsc')}</option>
                </select>
                <span className="text-xs text-slate-500 font-bold ml-auto">
                    {processed.length} {t('desktop.browse.cards')}
                </span>
            </div>

            {processed.length === 0 ? (
                <p className="text-slate-500 text-sm mt-10">{t('desktop.browse.noCardsMatch')}</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-6">
                    {processed.map((card) => {
                        const thumb = getThumbnailUrl(card.images?.small || card.imageUrl);
                        return (
                            <Link
                                key={card.id}
                                href={`/card/${card.id}`}
                                className="group bg-[#1e293b]/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 transition-all"
                            >
                                <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                                    <Image
                                        src={thumb}
                                        alt={card.name}
                                        fill
                                        sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                                        loading="lazy"
                                        placeholder="blur"
                                        blurDataURL={CARD_BLUR_DATA_URL}
                                        unoptimized={shouldSkipNextOptimization(thumb)}
                                        className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
                                    />
                                </div>
                                <div className="p-3">
                                    <h2 className="text-sm font-bold text-white truncate">{card.name}</h2>
                                    <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                                        {card.number ? `#${card.number}` : ''}{card.rarity ? ` · ${card.rarity}` : ''}
                                    </p>
                                    {card.marketPrice > 0 && (
                                        <p className="text-sm font-black text-brand-cyan mt-1.5">{fmtTHB(card.marketPrice)}</p>
                                    )}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
