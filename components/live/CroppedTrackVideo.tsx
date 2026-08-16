'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalVideoTrack, RemoteTrack } from 'livekit-client';
import { TrackVideo } from '@/components/live/TrackVideo';
import { clampCrop, resolveFit, type FeedCrop, type FeedFit } from '@/components/live/shared';

/** Backdrop snapshot cadence — ambience only, so seconds-stale is fine. */
const BACKDROP_REFRESH_MS = 2000;
/** Snapshot buffer width in px. Tiny on purpose: it's blurred to a wash, and a
 *  small drawImage keeps the 2s tick effectively free. */
const BACKDROP_W = 64;

/**
 * A TrackVideo inside an overflow-hidden window with the broadcaster's
 * presentation-layer crop applied as pure CSS: scaling by `zoom` around a
 * transform-origin of (x, y) keeps that fractional point fixed, so the
 * visible window's left edge lands at x*(1-1/zoom) — x sweeps the 1/zoom
 * window from the feed's left edge (0) to its right edge (1), matching the
 * {zoom, x, y} contract in streams.layout exactly.
 *
 * `slot` resolves the feed's fit (crop.fit, else the slot default): 'cover'
 * center-crops to fill the window; 'contain' shows the FULL frame — built for
 * the portrait table cam, whose cover-crop into the wide lower slot read as a
 * massive accidental zoom. Contain mode hugs the video: the feed renders in a
 * centered box at the video's measured aspect (full slot height, width =
 * height*aspect, capped at the slot width), so a portrait feed in a wide slot
 * is a tight column instead of a sliver between giant pillarbox bars. The
 * aspect comes from the attached element (loadedmetadata + 'resize'), so a
 * publisher rotating mid-stream re-hugs automatically. Never a crop and never
 * an upscale — the box exactly contains the frame. Zoom/pan apply on top,
 * clipped to the hugged box, so punch-in still works in contain mode.
 *
 * Residual bars are dressed by a backdrop that costs no second decode: a
 * ~2s canvas snapshot of the SAME video element, blurred/dimmed by CSS.
 * (The previous backdrop was a second live <video> on the track — two
 * decode+render pipelines per feed, the prime lag suspect on low-end phones.
 * Exactly ONE live video element per feed is the invariant now.) Until the
 * first frame lands the canvas is transparent and the slot's black shows —
 * the intended plain-dark fallback.
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
    defaultFit,
    className,
    muted = true,
    onClick,
}: {
    track: RemoteTrack | LocalVideoTrack | null;
    crop?: FeedCrop | null;
    /** Which layout slot this window renders — picks the default fit. */
    slot?: 'main' | 'table';
    /** Replaces the SLOT default when the stored crop carries no explicit
     *  fit — the mobile viewer's solo feed goes full-bleed ('cover',
     *  Whatnot-style) without overriding a broadcaster who chose 'Fit'. */
    defaultFit?: FeedFit;
    /** Positions the window (e.g. 'absolute inset-0'); overflow-hidden is added here. */
    className?: string;
    muted?: boolean;
    onClick?: () => void;
}) {
    const c = clampCrop(crop);
    const fit: FeedFit =
        c?.fit === 'cover' || c?.fit === 'contain' ? c.fit : defaultFit ?? resolveFit(slot, c);

    // The attached video's intrinsic aspect (w/h). Null until measured — the
    // hug box falls back to the plain full-slot contain until then.
    const [aspect, setAspect] = useState<number | null>(null);
    const onAspect = useCallback((next: number) => {
        setAspect((prev) => (prev === next ? prev : next));
    }, []);
    // A swapped track's dimensions are unknown until its metadata loads — a
    // stale hug box from the previous feed would mis-frame the new one.
    useEffect(() => {
        setAspect(null);
    }, [track]);

    const videoElRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        if (fit !== 'contain' || !track) return;
        const draw = () => {
            const video = videoElRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return;
            const h = Math.max(1, Math.round((BACKDROP_W * video.videoHeight) / video.videoWidth));
            if (canvas.width !== BACKDROP_W || canvas.height !== h) {
                canvas.width = BACKDROP_W;
                canvas.height = h;
            }
            try {
                canvas.getContext('2d')?.drawImage(video, 0, 0, BACKDROP_W, h);
            } catch {
                // Frame not decodable yet — the next tick catches up.
            }
        };
        draw();
        const timer = setInterval(draw, BACKDROP_REFRESH_MS);
        return () => clearInterval(timer);
    }, [fit, track]);

    const zoomStyle =
        c && c.zoom > 1
            ? {
                  transform: `scale(${c.zoom})`,
                  transformOrigin: `${c.x * 100}% ${c.y * 100}%`,
              }
            : undefined;

    const video = (
        <TrackVideo
            track={track}
            muted={muted}
            onAspect={onAspect}
            elementRef={videoElRef}
            className={`absolute inset-0 w-full h-full ${
                fit === 'contain' ? 'object-contain' : 'object-cover'
            }`}
            style={zoomStyle}
        />
    );

    return (
        <div className={`overflow-hidden ${className ?? ''}`} onClick={onClick}>
            {fit === 'contain' && (
                <canvas
                    ref={canvasRef}
                    aria-hidden
                    className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl brightness-[0.4]"
                />
            )}
            {fit === 'contain' && aspect !== null ? (
                /* The hug box: full slot height at the video's aspect, centered,
                   width capped at the slot (a wider-than-slot feed degrades to
                   the plain letterbox — object-contain inside keeps the frame
                   whole either way). overflow-hidden clips the zoom punch-in to
                   the hugged window. */
                <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-full max-w-full overflow-hidden"
                    style={{ aspectRatio: String(aspect) }}
                >
                    {video}
                </div>
            ) : (
                video
            )}
        </div>
    );
}
