'use client';

import React from 'react';
import type { LocalVideoTrack, RemoteTrack } from 'livekit-client';
import { TrackVideo } from '@/components/live/TrackVideo';
import { clampCrop, resolveFit, type FeedCrop } from '@/components/live/shared';

/**
 * A TrackVideo inside an overflow-hidden window with the broadcaster's
 * presentation-layer crop applied as pure CSS: scaling by `zoom` around a
 * transform-origin of (x, y) keeps that fractional point fixed, so the
 * visible window's left edge lands at x*(1-1/zoom) — x sweeps the 1/zoom
 * window from the feed's left edge (0) to its right edge (1), matching the
 * {zoom, x, y} contract in streams.layout exactly.
 *
 * `slot` resolves the feed's fit (crop.fit, else the slot default): 'cover'
 * center-crops to fill the window; 'contain' letterboxes the FULL frame —
 * built for the portrait table cam, whose cover-crop into the wide lower
 * slot read as a massive accidental zoom. Contain renders a second, blurred
 * cover copy of the SAME track behind the letterboxed one so the bars look
 * intentional (two <video> elements on one track share the decoder output —
 * near-zero extra cost). Zoom/pan apply on top of either fit, so punch-in
 * still works in contain mode.
 *
 * The SAME component renders the console's layout panel and the viewer page,
 * so what the seller frames and what viewers receive cannot drift. A
 * null/invalid crop (or zoom 1) is the un-zoomed fill/fit the slot defaults
 * to.
 */
export function CroppedTrackVideo({
    track,
    crop,
    slot = 'main',
    className,
    muted = true,
    onClick,
}: {
    track: RemoteTrack | LocalVideoTrack | null;
    crop?: FeedCrop | null;
    /** Which layout slot this window renders — picks the default fit. */
    slot?: 'main' | 'table';
    /** Positions the window (e.g. 'absolute inset-0'); overflow-hidden is added here. */
    className?: string;
    muted?: boolean;
    onClick?: () => void;
}) {
    const c = clampCrop(crop);
    const fit = resolveFit(slot, c);
    const zoomStyle =
        c && c.zoom > 1
            ? {
                  transform: `scale(${c.zoom})`,
                  transformOrigin: `${c.x * 100}% ${c.y * 100}%`,
              }
            : undefined;
    return (
        <div className={`overflow-hidden ${className ?? ''}`} onClick={onClick}>
            {fit === 'contain' && (
                /* Decorative fill behind the letterbox — blurred, dimmed,
                   over-scaled so the blur never shows a hard edge. No zoom
                   transform: the backdrop is ambience, not content. */
                <TrackVideo
                    track={track}
                    muted
                    className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl brightness-[0.4]"
                />
            )}
            <TrackVideo
                track={track}
                muted={muted}
                className={`absolute inset-0 w-full h-full ${
                    fit === 'contain' ? 'object-contain' : 'object-cover'
                }`}
                style={zoomStyle}
            />
        </div>
    );
}
