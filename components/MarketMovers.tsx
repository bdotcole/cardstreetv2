'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Card } from '@/types';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { formatTHB } from '@/lib/currency';

/**
 * "Market movers": the cards whose market price rose or fell most this week,
 * from /api/market/movers (rebuilt daily from price_snapshots). Shared by the
 * desktop marketplace (links to /card/[id]) and the mobile marketplace (opens the
 * card through onSelectCard). Renders nothing until there is something to show,
 * including before the movers migration runs.
 */

/**
 * Switched off 2026-10-09 (founder call): the rail fills the top of the
 * marketplace with catalog cards that are not for sale, which reads as dead
 * space above the listings. Both marketplaces gate their mount on this flag,
 * so nothing renders and nothing is fetched while it is false. The daily cron
 * and /api/market/movers keep running so the data is ready the moment a
 * better UI lands; flip this to bring the rail back on mobile and desktop.
 */
export const MARKET_MOVERS_ENABLED = false;

interface MoverItem {
    card: Card;
    oldThb: number;
    newThb: number;
    changePct: number;
}

interface MarketMoversProps {
    /** Game filter; 'all' for every game. */
    game?: string;
    /** Mobile: open the card in the SPA. When omitted, tiles link to /card/[id]. */
    onSelectCard?: (card: Card) => void;
    /** Desktop locale prefix for links ('' or '/en'). */
    pathPrefix?: string;
    /** Price formatter (mobile passes the viewer's currency); THB by default. */
    formatPrice?: (thb: number) => string;
    className?: string;
}

export default function MarketMovers({ game = 'all', onSelectCard, pathPrefix = '', formatPrice = formatTHB, className = '' }: MarketMoversProps) {
    const { t } = useTranslation();
    const [dir, setDir] = useState<'up' | 'down'>('up');
    const [items, setItems] = useState<{ up: MoverItem[]; down: MoverItem[] }>({ up: [], down: [] });

    useEffect(() => {
        let cancelled = false;
        const load = (d: 'up' | 'down') =>
            fetch(`/api/market/movers?game=${encodeURIComponent(game)}&window=7&dir=${d}&limit=12`)
                .then((r) => (r.ok ? r.json() : { items: [] }))
                .then((j) => (Array.isArray(j.items) ? (j.items as MoverItem[]) : []))
                .catch(() => [] as MoverItem[]);
        Promise.all([load('up'), load('down')]).then(([up, down]) => {
            if (cancelled) return;
            setItems({ up, down });
            if (up.length === 0 && down.length > 0) setDir('down');
        });
        return () => { cancelled = true; };
    }, [game]);

    const shown = items[dir];
    if (items.up.length === 0 && items.down.length === 0) return null;

    return (
        <section className={className}>
            <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-white font-black uppercase tracking-widest text-xs sm:text-sm">
                    {t('movers.title')}
                </h2>
                <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5 flex-shrink-0">
                    {(['up', 'down'] as const).map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setDir(d)}
                            disabled={items[d].length === 0}
                            className={`px-3 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-40 ${
                                dir === d ? 'bg-brand-cyan text-brand-darker' : 'text-slate-300 hover:text-white'
                            }`}
                        >
                            {t(d === 'up' ? 'movers.rising' : 'movers.falling')}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
                {shown.map(({ card, newThb, changePct }) => {
                    const price = card.marketPrice > 0 ? card.marketPrice : newThb;
                    const up = changePct > 0;
                    const body = (
                        <>
                            <span className="block relative aspect-[63/88] rounded-lg overflow-hidden bg-brand-darker">
                                {card.images?.small && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={getThumbnailUrl(card.images.small)} alt="" loading="lazy" className="w-full h-full object-cover" />
                                )}
                                <span className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                                    up ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                                }`}>
                                    {up ? '+' : ''}{changePct.toFixed(changePct >= 100 || changePct <= -100 ? 0 : 1)}%
                                </span>
                            </span>
                            <span className="block mt-1.5 text-white text-xs font-bold truncate">{card.name}</span>
                            <span className="block text-slate-500 text-[10px] truncate">{card.set}</span>
                            <span className="block text-brand-cyan text-xs font-black">{formatPrice(price)}</span>
                        </>
                    );
                    const tileClass = 'w-28 sm:w-32 flex-shrink-0 text-left p-2 rounded-xl bg-white/5 border border-white/10 hover:border-brand-cyan/40 transition-colors';
                    return onSelectCard ? (
                        <button key={card.id} type="button" onClick={() => onSelectCard(card)} className={tileClass}>
                            {body}
                        </button>
                    ) : (
                        <Link key={card.id} href={`${pathPrefix}/card/${card.id}`} className={tileClass}>
                            {body}
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
