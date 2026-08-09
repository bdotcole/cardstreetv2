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
}) {
    const ref = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || !track) return;
        track.attach(el);
        return () => {
            track.detach(el);
        };
    }, [track]);

    return (
        <video
            ref={ref}
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

    // Muted by default: mobile browsers block unmuted autoplay, so the viewer
    // page flips this via an explicit "tap for sound" interaction.
    return <audio ref={ref} autoPlay muted={muted} />;
}
