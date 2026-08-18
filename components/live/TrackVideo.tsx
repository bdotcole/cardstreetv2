'use client';

import React, { useEffect, useRef } from 'react';
import type { LocalVideoTrack, RemoteTrack } from 'livekit-client';

/**
 * Attach/detach a LiveKit track to a media element. Kept dumb on purpose —
 * layout, tap-to-swap and overlays belong to the pages; this only guarantees
 * the attach is cleaned up when the track or element changes (a leaked attach
 * keeps the MediaStream alive and the camera LED on).
 */

type AnyVideoTrack = RemoteTrack | LocalVideoTrack;

export function TrackVideo({
    track,
    className,
    style,
    muted = true,
    mirror = false,
    onClick,
    onAspect,
    elementRef,
}: {
    track: AnyVideoTrack | null;
    className?: string;
    /** Inline styles (CroppedTrackVideo's crop transform). A style.transform
     *  overrides the mirror class's transform — don't combine the two. */
    style?: React.CSSProperties;
    /** Video elements stay muted — audio rides separate TrackAudio elements. */
    muted?: boolean;
    /** Front cameras preview mirrored, matching what users expect of a selfie view. */
    mirror?: boolean;
    onClick?: () => void;
    /**
     * Reports videoWidth/videoHeight on loadedmetadata AND on the media
     * 'resize' event — the latter fires when the intrinsic size changes
     * mid-stream (a phone publisher rotating), which is how the aspect-hugging
     * contain slots follow an orientation flip without a republish. Must be a
     * stable callback: it's a dependency of the attach effect, and a re-attach
     * flickers the feed.
     */
    onAspect?: (aspect: number) => void;
    /** Escape hatch to the underlying <video> — CroppedTrackVideo's backdrop
     *  snapshots frames from it instead of decoding the track a second time. */
    elementRef?: React.MutableRefObject<HTMLVideoElement | null>;
}) {
    const ref = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || !track) return;
        track.attach(el);
        const report = () => {
            if (onAspect && el.videoWidth > 0 && el.videoHeight > 0) {
                onAspect(el.videoWidth / el.videoHeight);
            }
        };
        report(); // metadata may already be loaded when the effect re-runs
        el.addEventListener('loadedmetadata', report);
        el.addEventListener('resize', report);
        return () => {
            el.removeEventListener('loadedmetadata', report);
            el.removeEventListener('resize', report);
            track.detach(el);
        };
    }, [track, onAspect]);

    return (
        <video
            ref={(el) => {
                ref.current = el;
                if (elementRef) elementRef.current = el;
            }}
            autoPlay
            playsInline
            muted={muted}
            onClick={onClick}
            style={style}
            className={`${className ?? ''} ${mirror ? 'scale-x-[-1]' : ''}`}
        />
    );
}

export function TrackAudio({ track, muted }: { track: RemoteTrack; muted: boolean }) {
    const ref = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || !track) return;
        track.attach(el);
        return () => {
            track.detach(el);
        };
    }, [track]);

    // Unmuting can leave the element paused on some mobile browsers. The flip
    // only ever happens inside a user gesture (a tap on the video), so play()
    // is permitted here — without it a viewer could tap for sound and get
    // silence anyway.
    useEffect(() => {
        const el = ref.current;
        if (!el || muted) return;
        void el.play().catch(() => {
            // Blocked despite the gesture — nothing more to try.
        });
    }, [muted]);

    // Muted by default: mobile browsers block unmuted autoplay, so the viewer
    // page flips this on the first tap anywhere on the video.
    return <audio ref={ref} autoPlay muted={muted} />;
}
