'use client';

import React, { useEffect, useState } from 'react';
import { Track, type RemoteTrack, type RemoteVideoTrack } from 'livekit-client';

/**
 * Diagnostic overlay for one RECEIVED video feed: decoded WxH, incoming kbps
 * and the LiveKit stream state, polled every ~2s. Rendered only for the
 * broadcaster (console monitor tile) and admins (viewer page) — it exists so
 * a field test can name the hop that degrades quality: the publisher's
 * console.info at publish time says what left the device; this says what the
 * receiving end actually gets.
 */

const POLL_MS = 2000;

export function TrackStatsBadge({
    track,
    className,
}: {
    track: RemoteTrack | null;
    /** Positions the badge inside a relative parent (e.g. 'absolute bottom-1.5 left-1.5'). */
    className?: string;
}) {
    const [text, setText] = useState<string | null>(null);

    useEffect(() => {
        setText(null);
        if (!track || track.kind !== Track.Kind.Video) return;
        const videoTrack = track as RemoteVideoTrack;
        let cancelled = false;
        let prev: { bytes: number; ts: number } | null = null;

        const poll = async () => {
            try {
                const stats = await videoTrack.getReceiverStats();
                if (cancelled || !stats) return;
                const parts: string[] = [];
                if (stats.frameWidth && stats.frameHeight) {
                    parts.push(`${stats.frameWidth}x${stats.frameHeight}`);
                }
                // RTCStats timestamps are in ms, so Δbytes*8/Δms is kbps.
                const bytes = stats.bytesReceived ?? 0;
                if (prev && stats.timestamp > prev.ts) {
                    const kbps = Math.max(
                        0,
                        Math.round(((bytes - prev.bytes) * 8) / (stats.timestamp - prev.ts)),
                    );
                    parts.push(`${kbps} kbps`);
                }
                prev = { bytes, ts: stats.timestamp };
                // 'paused' = the server stopped this layer (dynacast /
                // congestion) — the smoking gun for a frozen-but-connected feed.
                if (videoTrack.streamState === Track.StreamState.Paused) parts.push('paused');
                if (parts.length > 0) setText(parts.join(' · '));
            } catch {
                // Stats are best-effort; try again next tick.
            }
        };

        void poll();
        const timer = setInterval(() => void poll(), POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [track]);

    if (!text) return null;
    return (
        <span
            className={`z-10 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono text-emerald-300 pointer-events-none ${className ?? ''}`}
        >
            {text}
        </span>
    );
}
