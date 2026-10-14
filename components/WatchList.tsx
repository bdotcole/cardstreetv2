'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { fetchWatchList, type WatchedListing } from '@/lib/listingWatches';
import { useListingWatch } from '@/lib/contexts/ListingWatchContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { formatTHB } from '@/lib/currency';
import type { Card } from '@/types';

interface WatchListProps {
    /** Full-screen Profile panel ('panel', with a Back header) or inside a desktop tab ('embedded'). */
    variant?: 'panel' | 'embedded';
    onBack?: () => void;
    /** A live listing opens its sheet / page. */
    onOpenListing?: (listing: WatchedListing) => void;
    /** A sold or withdrawn listing opens the card instead, where other copies are. */
    onOpenCard?: (card: Card) => void;
}

/**
 * The signed-in user's watched listings, newest first. Each row shows the
 * current price next to what it was when the watch began, so a drop reads at
 * a glance, and a sold copy stays on the list marked sold rather than
 * vanishing. Stop watching keeps the row (now with Watch) so a mis-tap can be
 * undone in place, like the Following list.
 */
export default function WatchList({ variant = 'panel', onBack, onOpenListing, onOpenCard }: WatchListProps) {
    const { t, isThai } = useTranslation();
    const { watchers, toggle } = useListingWatch();
    const [items, setItems] = useState<WatchedListing[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    // Rows unwatched from this list, kept on screen so they can be re-watched.
    const [removed, setRemoved] = useState<Set<string>>(new Set());
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        void fetchWatchList(controller.signal).then((res) => {
            if (controller.signal.aborted) return;
            if (!res) setFailed(true);
            else if (!res.available) setUnavailable(true);
            setItems(res?.items ?? []);
        });
        return () => controller.abort();
    }, []);

    const flip = async (listing: WatchedListing) => {
        if (busyId) return;
        const watchAgain = removed.has(listing.id);
        setBusyId(listing.id);
        // The direction is explicit: this list is its own source of truth for
        // what is watched, independent of when the shared state finished loading.
        const result = await toggle(listing, watchAgain);
        setBusyId(null);
        if (result !== 'ok') return;
        setRemoved((prev) => {
            const next = new Set(prev);
            if (watchAgain) next.delete(listing.id);
            else next.add(listing.id);
            return next;
        });
    };

    const open = (listing: WatchedListing) => {
        if (listing.status === 'active') onOpenListing?.(listing);
        else onOpenCard?.(listing.card_data);
    };

    const embedded = variant === 'embedded';
    const emptyText = failed ? t('watch.loadFailed') : unavailable ? t('watch.unavailable') : t('watch.listEmpty');

    return (
        <div
            className={embedded ? '' : 'p-4 pt-16 space-y-6'}
            style={embedded ? undefined : { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}
        >
            {!embedded && (
                <div className="flex items-center gap-4 mb-6">
                    <button onClick={onBack} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors" aria-label="Back">
                        <ChevronLeft className="w-5 h-5 text-slate-400" />
                    </button>
                    <h2 className={`text-lg font-black text-white uppercase ${isThai ? 'tracking-normal' : 'tracking-wide'}`}>{t('watch.listTitle')}</h2>
                </div>
            )}

            {items === null ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
                </div>
            ) : items.length === 0 ? (
                <div className="glass p-6 rounded-2xl border border-white/5 text-center text-sm text-slate-400 leading-relaxed">
                    {emptyText}
                </div>
            ) : (
                <div className="glass rounded-[2rem] border-white/5 overflow-hidden">
                    {items.map((listing, idx) => {
                        const card = listing.card_data;
                        const live = listing.status === 'active';
                        const isRemoved = removed.has(listing.id);
                        const price = Number(listing.price);
                        const was = listing.price_at_watch;
                        const dropped = was !== null && was > price;
                        const rose = was !== null && was < price;
                        const count = watchers(listing);
                        const thumb = getThumbnailUrl(card.images?.small || card.imageUrl);
                        const border = idx !== items.length - 1 ? 'border-b border-white/[0.04]' : '';
                        return (
                            <div key={listing.id} className={`flex items-center gap-3 px-4 py-3 ${border} ${isRemoved ? 'opacity-60' : ''}`}>
                                <button onClick={() => open(listing)} className="flex-1 min-w-0 flex items-center gap-3 text-left group">
                                    <span className={`relative w-12 h-16 rounded-md overflow-hidden bg-brand-darker shrink-0 border border-white/10 ${live ? '' : 'grayscale'}`}>
                                        {thumb && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={thumb} alt="" loading="lazy" className={`w-full h-full ${card.isSealed ? 'object-contain p-0.5' : 'object-cover'}`} />
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span className="text-sm font-semibold text-white truncate">{card.name}</span>
                                            {!live && (
                                                <span className="shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                                                    {t(listing.status === 'sold' ? 'watch.soldBadge' : 'watch.goneBadge')}
                                                </span>
                                            )}
                                            {live && dropped && (
                                                <span className="shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand-green/15 text-brand-green">
                                                    {t('watch.dropBadge')}
                                                </span>
                                            )}
                                        </span>
                                        <span className="block text-[11px] text-slate-500 truncate">
                                            {card.set}{listing.seller?.display_name ? ` · ${listing.seller.display_name}` : ''}
                                        </span>
                                        <span className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                                            <span className={`text-sm font-black ${live ? 'text-brand-cyan' : 'text-slate-500 line-through'}`}>{formatTHB(price)}</span>
                                            {live && (dropped || rose) && was !== null && (
                                                <span className={`text-[10px] font-bold truncate ${dropped ? 'text-brand-green' : 'text-slate-500'}`}>
                                                    {t('watch.wasPrice').replace('{price}', formatTHB(was))}
                                                </span>
                                            )}
                                            {count > 0 && (
                                                <span className="ml-auto text-[10px] text-slate-500 font-bold whitespace-nowrap shrink-0">
                                                    <i className="fa-regular fa-eye mr-1"></i>
                                                    {count}
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                    <ChevronRight className="w-4 h-4 text-slate-700 group-hover:translate-x-1 transition-transform shrink-0" />
                                </button>
                                <button
                                    onClick={() => { void flip(listing); }}
                                    disabled={busyId === listing.id}
                                    className={`shrink-0 h-8 px-3 rounded-lg text-[11px] font-bold border transition-all active:scale-95 disabled:opacity-60 ${isRemoved
                                        ? 'bg-white text-brand-darker border-white'
                                        : 'border-white/15 text-slate-300 hover:border-brand-red/50 hover:text-brand-red'}`}
                                >
                                    {t(isRemoved ? 'watch.cta' : 'watch.stop')}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
