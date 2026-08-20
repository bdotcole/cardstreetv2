'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Plays one window of a stream VOD.
 *
 * A clip is stored as {start_ms, end_ms} into the full recording (see
 * 20260820_stream_clips.sql), so playback is: seek to start, stop at end. The
 * media fragment hash (#t=s,e) alone is not enough — browsers honour the start
 * inconsistently and Safari ignores the end entirely — so the stop is enforced
 * in a timeupdate handler and the seek is re-applied on loadedmetadata.
 */
export default function ClipPlayer({
    src,
    startMs,
    endMs,
    poster,
}: {
    src: string;
    startMs: number;
    endMs: number;
    poster?: string | null;
}) {
    const ref = useRef<HTMLVideoElement>(null);
    const [ended, setEnded] = useState(false);
    const startS = startMs / 1000;
    const endS = endMs / 1000;

    useEffect(() => {
        const video = ref.current;
        if (!video) return;

        const seekToStart = () => {
            // currentTime before metadata is a no-op, so this must run on
            // loadedmetadata rather than on mount.
            try {
                video.currentTime = startS;
            } catch {
                // Range not seekable yet — timeupdate below corrects it.
            }
        };
        const onTime = () => {
            if (video.currentTime >= endS) {
                video.pause();
                setEnded(true);
            } else if (video.currentTime < startS - 1) {
                // A stray seek behind the window (scrub, or a browser resuming
                // at 0) snaps back rather than playing unrelated footage.
                video.currentTime = startS;
            }
        };

        video.addEventListener('loadedmetadata', seekToStart);
        video.addEventListener('timeupdate', onTime);
        return () => {
            video.removeEventListener('loadedmetadata', seekToStart);
            video.removeEventListener('timeupdate', onTime);
        };
    }, [startS, endS]);

    const replay = () => {
        const video = ref.current;
        if (!video) return;
        video.currentTime = startS;
        setEnded(false);
        void video.play();
    };

    return (
        <div className="relative w-full bg-black rounded-2xl overflow-hidden">
            <video
                ref={ref}
                // The media fragment still helps: it lets the CDN start the
                // byte range near the clip instead of at file byte 0.
                src={`${src}#t=${startS.toFixed(2)},${endS.toFixed(2)}`}
                poster={poster || undefined}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[70vh] bg-black"
            />
            {ended && (
                <button
                    onClick={replay}
                    className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white"
                >
                    <i className="fa-solid fa-rotate-right text-3xl mb-3"></i>
                    <span className="text-xs font-black uppercase tracking-widest">Replay</span>
                </button>
            )}
        </div>
    );
}
