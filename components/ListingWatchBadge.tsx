'use client';

import React from 'react';
import { useListingWatch, type WatchableListing } from '@/lib/contexts/ListingWatchContext';
import { useTranslation } from '@/lib/hooks/useTranslation';

// The watcher counter on a listing tile, in the top-right corner where the
// condition badge used to sit: a bare eye glyph with the count beside it, no
// box. It is also the Watch toggle: a tap watches the listing (the eye fills
// cyan, the count goes up), a second tap stops. The count is the point:
// "3 watching" on a card tells a buyer on the fence that someone else may
// take it first.
//
// Nothing renders while nobody is watching (founder call, 2026-10-14): a
// tile with no interest stays clean, and the listing sheet's Watch button
// is the way to be the first. On the seller's own listing it is a read-only
// count (they cannot watch their own card, but seeing the interest is useful).
//
// Why no visible box: globals.css gives every button a 44x44 minimum on
// touch devices (pointer: coarse), so a small bordered pill inflated into a
// dark square over the art. The glyph is small and the tap area is the
// transparent 44px box around it, anchored to the corner.

interface Props {
    listing: WatchableListing;
    /** Opens the sign-in wall for a signed-out tap. */
    onRequireAuth?: () => void;
    size?: 'sm' | 'md';
    /** Positioning only: the corner anchor of the tap area, e.g. "absolute top-0 right-0 z-10". */
    className?: string;
}

const ListingWatchBadge: React.FC<Props> = ({ listing, onRequireAuth, size = 'sm', className = '' }) => {
    const { viewerId, isWatching, watchers, toggle } = useListingWatch();
    const { t } = useTranslation();
    const watching = isWatching(listing);
    const count = watchers(listing);
    const own = !!viewerId && viewerId === listing.seller_id;

    // Blank until someone watches. The viewer's own watch counts, so a card
    // they just watched from the sheet shows the eye on the tile too.
    if (count === 0 && !watching) return null;

    const glyph = size === 'md' ? 'text-[13px]' : 'text-[11px]';
    const number = size === 'md' ? 'text-[11px]' : 'text-[10px]';
    const countLabel = t('watch.watchers').replace('{n}', String(count));
    // Legible on any art without a box: a tight dark drop shadow.
    const face = (
        <span
            className={`inline-flex items-center gap-1 leading-none font-black ${watching ? 'text-brand-cyan' : 'text-white'} [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.9))_drop-shadow(0_0_3px_rgba(0,0,0,0.6))]`}
        >
            <i className={`${watching ? 'fa-solid' : 'fa-regular'} fa-eye ${glyph}`}></i>
            {count > 0 && <span className={number}>{count}</span>}
        </span>
    );

    if (own) {
        return (
            <span title={countLabel} className={`inline-flex items-start justify-end p-1.5 ${className}`}>
                {face}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={(e) => {
                // Tiles are links / tap targets of their own.
                e.preventDefault();
                e.stopPropagation();
                if (!viewerId) {
                    onRequireAuth?.();
                    return;
                }
                void toggle(listing).then((result) => {
                    if (result === 'unauthorized') onRequireAuth?.();
                });
            }}
            aria-pressed={watching}
            aria-label={`${watching ? t('watch.stop') : t('watch.cta')} · ${countLabel}`}
            title={watching ? t('watch.stop') : t('watch.cta')}
            // Transparent tap area; the glyph sits in its top-right corner so
            // the 44px touch minimum grows the box down and left, over the art.
            className={`inline-flex items-start justify-end p-1.5 bg-transparent border-0 transition-transform active:scale-90 ${className}`}
        >
            {face}
        </button>
    );
};

export default ListingWatchBadge;

/**
 * The labelled form for a listing's own page: "Watch" / "Watching" with the
 * count spelled out ("3 watching"). Same state as the tile badge, so a tap
 * here moves the tile behind the sheet too.
 */
export const ListingWatchButton: React.FC<Omit<Props, 'size'> & {
    /** 'wide' fills its row: the action on the left, the count on the right. */
    layout?: 'inline' | 'wide';
}> = ({ listing, onRequireAuth, className = '', layout = 'inline' }) => {
    const { viewerId, isWatching, watchers, toggle } = useListingWatch();
    const { t } = useTranslation();
    const watching = isWatching(listing);
    const count = watchers(listing);
    const own = !!viewerId && viewerId === listing.seller_id;
    const countLabel = t('watch.watchers').replace('{n}', String(count));
    const wide = layout === 'wide';

    if (own) {
        if (count === 0) return null;
        return (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 ${className}`}>
                <i className="fa-regular fa-eye"></i>
                {countLabel}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!viewerId) {
                    onRequireAuth?.();
                    return;
                }
                void toggle(listing).then((result) => {
                    if (result === 'unauthorized') onRequireAuth?.();
                });
            }}
            aria-pressed={watching}
            className={`inline-flex items-center rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all active:scale-[0.98] ${wide ? 'w-full h-11 px-4 justify-between gap-3' : 'h-9 pl-3 pr-3.5 gap-2'} ${watching
                ? 'bg-brand-cyan text-brand-darker border-brand-cyan shadow-lg shadow-brand-cyan/20'
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            } ${className}`}
        >
            <span className="inline-flex items-center gap-2">
                <i className={`${watching ? 'fa-solid' : 'fa-regular'} fa-eye`}></i>
                {watching ? t('watch.watching') : t('watch.cta')}
            </span>
            {/* The count only once there is one: "0 watching" is noise. */}
            {count > 0 && (
                <span className={`text-[10px] font-bold normal-case tracking-normal ${watching ? 'text-brand-darker/70' : 'text-slate-400'}`}>
                    {countLabel}
                </span>
            )}
        </button>
    );
};
