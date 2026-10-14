'use client';

import React from 'react';
import { useListingWatch, type WatchableListing } from '@/lib/contexts/ListingWatchContext';
import { useTranslation } from '@/lib/hooks/useTranslation';

// The watcher counter on a listing tile, in the top-right corner where the
// condition badge used to sit. It is also the Watch toggle: a tap watches
// the listing (the eye fills, the count goes up), a second tap stops. The
// count is the point: "3 watching" on a card tells a buyer on the fence
// that someone else may take it first.
//
// On the seller's own listing it is a read-only count (they cannot watch
// their own card, but seeing the interest is useful), and it hides at zero
// so an unwatched card of theirs does not carry an empty eye.

interface Props {
    listing: WatchableListing;
    /** Opens the sign-in wall for a signed-out tap. */
    onRequireAuth?: () => void;
    size?: 'sm' | 'md';
    /** Positioning only; the badge brings its own colours. */
    className?: string;
}

const ListingWatchBadge: React.FC<Props> = ({ listing, onRequireAuth, size = 'sm', className = '' }) => {
    const { viewerId, isWatching, watchers, toggle } = useListingWatch();
    const { t } = useTranslation();
    const watching = isWatching(listing);
    const count = watchers(listing);
    const own = !!viewerId && viewerId === listing.seller_id;

    const sizing = size === 'md'
        ? 'h-6 px-2 text-[10px] gap-1.5'
        : 'h-5 px-1.5 text-[9px] gap-1';
    const tone = watching
        ? 'bg-brand-cyan text-brand-darker border-brand-cyan shadow-lg shadow-brand-cyan/30'
        : 'bg-black/55 text-white border-white/15 hover:bg-black/75';
    const countLabel = t('watch.watchers').replace('{n}', String(count));

    if (own) {
        if (count === 0) return null;
        return (
            <span
                title={countLabel}
                className={`inline-flex items-center rounded-md border backdrop-blur-sm font-black whitespace-nowrap ${sizing} bg-black/55 text-white border-white/15 ${className}`}
            >
                <i className="fa-regular fa-eye"></i>
                {count}
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
            className={`inline-flex items-center rounded-md border backdrop-blur-sm font-black whitespace-nowrap transition-all active:scale-90 ${sizing} ${tone} ${className}`}
        >
            <i className={`${watching ? 'fa-solid' : 'fa-regular'} fa-eye`}></i>
            {count > 0 && <span>{count}</span>}
        </button>
    );
};

/**
 * The labelled form for a listing's own page: "Watch" / "Watching" with the
 * count spelled out ("3 watching"). Same state as the tile badge, so a tap
 * here moves the tile behind the sheet too.
 */
export const ListingWatchButton: React.FC<Omit<Props, 'size'>> = ({ listing, onRequireAuth, className = '' }) => {
    const { viewerId, isWatching, watchers, toggle } = useListingWatch();
    const { t } = useTranslation();
    const watching = isWatching(listing);
    const count = watchers(listing);
    const own = !!viewerId && viewerId === listing.seller_id;
    const countLabel = t('watch.watchers').replace('{n}', String(count));

    if (own) {
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
            className={`inline-flex items-center gap-2 h-9 pl-3 pr-3.5 rounded-xl border text-[11px] font-black uppercase tracking-wider transition-all active:scale-95 ${watching
                ? 'bg-brand-cyan text-brand-darker border-brand-cyan shadow-lg shadow-brand-cyan/20'
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            } ${className}`}
        >
            <i className={`${watching ? 'fa-solid' : 'fa-regular'} fa-eye`}></i>
            {watching ? t('watch.watching') : t('watch.cta')}
            <span className={`text-[10px] font-bold normal-case tracking-normal ${watching ? 'text-brand-darker/70' : 'text-slate-400'}`}>
                · {countLabel}
            </span>
        </button>
    );
};

export default ListingWatchBadge;
