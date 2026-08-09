'use client';

import React from 'react';
import type { LocalVideoTrack, RemoteTrack } from 'livekit-client';
import { TrackVideo } from '@/components/live/TrackVideo';
import { clampCrop, type FeedCrop } from '@/components/live/shared';

/**
 * A TrackVideo inside an overflow-hidden window with the broadcaster's
 * presentation-layer crop applied as pure CSS: scaling by `zoom` around a
 * transform-origin of (x, y) keeps that fractional point fixed, so the
 * visible window's left edge lands at x*(1-1/zoom) — x sweeps the 1/zoom
 * window from the feed's left edge (0) to its right edge (1), matching the
 * {zoom, x, y} contract in streams.layout exactly.
 *
 * The SAME component renders the console's layout panel and the viewer page,
 * so what the seller frames and what viewers receive cannot drift. A
 * null/invalid crop (or zoom 1) is the uncropped object-cover fill the pages
 * always had.
 */
export function CroppedTrackVideo({
    track,
    crop,
    className,
    muted = true,
    onClick,
}: {
    track: RemoteTrack | LocalVideoTrack | null;
    crop?: FeedCrop | null;
    /** Positions the window (e.g. 'absolute inset-0'); overflow-hidden is added here. */
    className?: string;
    muted?: boolean;
    onClick?: () => void;
}) {
    const c = clampCrop(crop);
    return (
        <div className={`overflow-hidden ${className ?? ''}`} onClick={onClick}>
            <TrackVideo
                track={track}
                muted={muted}
                className="absolute inset-0 w-full h-full object-cover"
                style={
                    c && c.zoom > 1
                        ? {
                              transform: `scale(${c.zoom})`,
                              transformOrigin: `${c.x * 100}% ${c.y * 100}%`,
                          }
                        : undefined
                }
            />
        </div>
    );
}
