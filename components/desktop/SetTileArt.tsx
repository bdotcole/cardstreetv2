'use client'

import React, { useEffect, useRef, useState } from 'react';
import { seriesBadge, setCode } from '@/lib/setSeries';

interface SetTileArtProps {
    id: string;
    game: string;
    series?: string | null;
    /** Printed set code, when the catalog id is one. */
    code?: string | null;
    /** Pictures to try in order: logo, pack photo, symbol. */
    art: string[];
    /** A picker-row thumbnail rather than a tile: the fallback wordmark shrinks to fit. */
    compact?: boolean;
}

// Scryfall's set symbols are solid black glyphs drawn for a white page.
const isMonochromeGlyph = (url: string) => url.includes('svgs.scryfall.io');

/**
 * The picture on a desktop set tile or set-picker row. Fills its parent, which
 * needs `relative` and a size.
 *
 * Deliberately lighter than components/SetArtwork.tsx (the app's tile): no
 * next/image, no canvas measuring, no ResizeObserver. The browser can show 600
 * of these at once (English Yu-Gi-Oh) on a page crawlers fetch constantly, so
 * each one is a plain lazy <img> on the logo's own host, exactly what the old
 * tiles used. What it keeps from SetArtwork is the part that matters: a set
 * with no logo falls through to its pack photo, then its symbol, then a
 * wordmark with the set code, instead of an empty box.
 */
export default function SetTileArt({ id, game, series, code, art, compact }: SetTileArtProps) {
    const [failed, setFailed] = useState(0);
    const imgRef = useRef<HTMLImageElement>(null);
    const src = art[failed];

    // A picture above the fold can fail before React attaches onError (the
    // page is server-rendered), and that error event is never replayed. SVGs
    // are skipped: one with no intrinsic size reports naturalWidth 0 even
    // when it loaded.
    useEffect(() => {
        const el = imgRef.current;
        if (!el || !src || /\.svg(\?|$)/i.test(src)) return;
        if (el.complete && el.naturalWidth === 0) setFailed((n) => n + 1);
    }, [src]);

    if (!src) {
        const label = code || setCode(id);
        // The era wordmark only knows Pokemon's set codes.
        const badge = game === 'pokemon' ? seriesBadge({ id, series }) : null;
        const wordmark = badge?.short ?? label;
        const size = compact ? (wordmark.length > 5 ? 'text-[9px]' : 'text-xs') : wordmark.length > 5 ? 'text-sm' : 'text-xl';
        return (
            <span className={`absolute inset-0 flex flex-col items-center justify-center gap-1 text-center ${compact ? '' : 'px-2'}`}>
                <span
                    className={`bg-gradient-to-r ${badge?.gradient ?? 'from-cyan-300 via-sky-300 to-violet-400'} bg-clip-text text-transparent font-black italic leading-none ${size}`}
                >
                    {wordmark}
                </span>
                {/* The row beside a thumbnail already prints the code. */}
                {!compact && badge && badge.short !== label && (
                    <span className="text-[9px] font-black uppercase tracking-[0.18em] leading-none text-slate-500">{label}</span>
                )}
            </span>
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            ref={imgRef}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed((n) => n + 1)}
            className={`absolute inset-0 h-full w-full object-contain ${
                isMonochromeGlyph(src) ? 'p-1 opacity-80 [html:not(.theme-light)_&]:invert' : ''
            }`}
        />
    );
}
