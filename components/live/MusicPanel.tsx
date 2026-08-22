'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * Background music for the broadcast console.
 *
 * Tracks come from the public `live-music` bucket (see /api/live/music — the
 * founder curates them, nothing is bundled). Playback runs through a WebAudio
 * graph: element -> source -> gain -> {speakers, MediaStreamDestination}. The
 * destination's track is what gets published to the room, so the volume
 * slider drives ONE gain node and local monitoring always matches what
 * viewers hear — element.volume/captureStream level behavior differs by
 * browser, which is exactly the ambiguity the graph removes.
 *
 * The element loops its track; Next advances manually. On a room reconnect
 * the console re-publishes via the `connected` effect, so music survives the
 * same reconnects the cameras do.
 */

interface MusicTrack {
    name: string;
    url: string;
}

export default function MusicPanel({
    connected,
    publishExtraAudio,
    unpublishExtraAudio,
}: {
    connected: boolean;
    publishExtraAudio: (track: MediaStreamTrack) => Promise<void>;
    unpublishExtraAudio: () => void;
}) {
    const { t } = useTranslation();
    const [tracks, setTracks] = useState<MusicTrack[]>([]);
    const [current, setCurrent] = useState<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const [volume, setVolume] = useState(0.35);
    const [open, setOpen] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const gainRef = useRef<GainNode | null>(null);
    const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const publishedRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        void fetch('/api/live/music')
            .then((r) => r.json())
            .then((d) => {
                if (!cancelled && Array.isArray(d?.tracks)) setTracks(d.tracks);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    // Build the audio graph once, on first play (an AudioContext needs a user
    // gesture to start anyway, and play is always a tap).
    const ensureGraph = useCallback(() => {
        if (ctxRef.current) return;
        const el = new Audio();
        el.crossOrigin = 'anonymous';
        el.loop = true;
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        const dest = ctx.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(ctx.destination); // local monitor
        gain.connect(dest); // what viewers hear
        gain.gain.value = 0.35;
        audioRef.current = el;
        ctxRef.current = ctx;
        gainRef.current = gain;
        destRef.current = dest;
    }, []);

    useEffect(() => {
        if (gainRef.current) gainRef.current.gain.value = volume;
    }, [volume]);

    const ensurePublished = useCallback(async () => {
        const dest = destRef.current;
        if (!dest || publishedRef.current || !connected) return;
        try {
            await publishExtraAudio(dest.stream.getAudioTracks()[0]);
            publishedRef.current = true;
        } catch {
            // Not connected yet — the connected effect retries.
        }
    }, [connected, publishExtraAudio]);

    // A reconnect builds a fresh Room: re-publish the same destination track.
    useEffect(() => {
        if (connected && playing) {
            publishedRef.current = false;
            void ensurePublished();
        }
        if (!connected) publishedRef.current = false;
    }, [connected, playing, ensurePublished]);

    const play = useCallback(
        async (idx: number) => {
            ensureGraph();
            const el = audioRef.current;
            if (!el || !tracks[idx]) return;
            el.src = tracks[idx].url;
            try {
                await ctxRef.current?.resume();
                await el.play();
                setCurrent(idx);
                setPlaying(true);
                void ensurePublished();
            } catch {
                setPlaying(false);
            }
        },
        [tracks, ensureGraph, ensurePublished],
    );

    const toggle = useCallback(async () => {
        const el = audioRef.current;
        if (!el || current === null) {
            if (tracks.length) void play(0);
            return;
        }
        if (playing) {
            el.pause();
            setPlaying(false);
        } else {
            await ctxRef.current?.resume();
            void el.play();
            setPlaying(true);
            void ensurePublished();
        }
    }, [current, playing, tracks.length, play, ensurePublished]);

    const next = useCallback(() => {
        if (!tracks.length) return;
        void play(current === null ? 0 : (current + 1) % tracks.length);
    }, [tracks.length, current, play]);

    // Page teardown: stop sound and drop the publication.
    useEffect(() => {
        return () => {
            audioRef.current?.pause();
            unpublishExtraAudio();
            void ctxRef.current?.close().catch(() => {});
        };
    }, [unpublishExtraAudio]);

    return (
        <div className="rounded-xl bg-white/5 border border-white/10">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 h-10 text-left"
            >
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-300">
                    <i className="fa-solid fa-music mr-2 text-brand-cyan"></i>
                    {t('live.console.music') || 'Music'}
                    {playing && current !== null && (
                        <span className="ml-2 normal-case tracking-normal font-bold text-brand-cyan">
                            {tracks[current]?.name}
                        </span>
                    )}
                </span>
                <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-slate-500 text-xs`}></i>
            </button>
            {open && (
                <div className="px-3 pb-3">
                    {tracks.length === 0 ? (
                        <p className="text-[11px] text-slate-500">
                            {t('live.console.musicEmpty') ||
                                'No tracks yet — add audio files to the live-music bucket.'}
                        </p>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 mb-2">
                                <button
                                    onClick={() => void toggle()}
                                    className="w-9 h-9 rounded-lg bg-brand-cyan text-brand-darker flex items-center justify-center active:scale-95 transition-all"
                                >
                                    <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-sm`}></i>
                                </button>
                                <button
                                    onClick={next}
                                    className="w-9 h-9 rounded-lg bg-white/10 border border-white/15 text-white flex items-center justify-center active:scale-95 transition-all"
                                >
                                    <i className="fa-solid fa-forward-step text-sm"></i>
                                </button>
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={volume}
                                    onChange={(e) => setVolume(Number(e.target.value))}
                                    className="flex-1 accent-cyan-400"
                                    aria-label={t('live.console.musicVolume') || 'Music volume'}
                                />
                            </div>
                            <div className="max-h-36 overflow-y-auto space-y-1">
                                {tracks.map((tr, i) => (
                                    <button
                                        key={tr.url}
                                        onClick={() => void play(i)}
                                        className={`w-full text-left px-2 py-1.5 rounded-lg text-[12px] font-bold truncate ${
                                            i === current
                                                ? 'bg-brand-cyan/20 text-brand-cyan'
                                                : 'text-slate-300 hover:bg-white/5'
                                        }`}
                                    >
                                        {tr.name}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
