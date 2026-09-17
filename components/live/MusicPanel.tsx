'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { isNativeShell, isPhoneLikeDevice } from '@/components/live/shared';

/**
 * Broadcast audio beyond the mic: background music from the `live-music`
 * bucket, and/or the desktop's own sound captured from a browser tab or the
 * whole screen.
 *
 * ONE WebAudio graph, ONE published track. The room allows a single extra
 * audio publication (useLiveKitRoom's publishExtraAudio stops any previous
 * one), so both sources are mixed here instead of competing:
 *
 *     <audio> ──► musicGain ──┬─► ctx.destination   (local monitor)
 *                             └─► dest ──► published track
 *     display  ──► captureGain ──► dest
 *
 * The capture branch is deliberately NOT wired to ctx.destination. Its audio
 * is already coming out of the machine's speakers — that IS what was
 * captured — so monitoring it would double it locally, and with "share system
 * audio" it would feed straight back into the next capture buffer as a
 * howling loop. Viewers hear it; the operator hears the original.
 *
 * Volume sliders drive the gain nodes rather than element.volume or track
 * constraints, so what the operator hears and what viewers receive cannot
 * drift apart.
 *
 * DESKTOP CHROME/EDGE ONLY for the capture half: getDisplayMedia with audio
 * is unimplemented in the Capacitor WebView and on mobile browsers, and
 * Safari exposes the API but never returns an audio track. The button hides
 * itself (canCaptureDisplayAudio) rather than failing at the tap, because a
 * broadcaster finding out mid-show is worse than not seeing the option.
 *
 * LICENSING IS THE OPERATOR'S CALL. Anything captured here is re-broadcast to
 * Facebook / TikTok / YouTube, which fingerprint live audio: commercial music
 * can get a stream muted mid-show or cost the account its LIVE access. The
 * panel says so once, at the point of use.
 */

interface MusicTrack {
    name: string;
    url: string;
}

/** Chrome accepts `systemAudio`; it is not in the standard DOM lib types. */
type DisplayMediaOptions = DisplayMediaStreamOptions & { systemAudio?: 'include' | 'exclude' };

type CaptureError = 'denied' | 'no_audio' | 'failed';

/**
 * Desktop browsers only, and deliberately stricter than "does the API exist".
 * Safari on macOS DOES expose getDisplayMedia but never hands back an audio
 * track, and a WebView or a phone that happens to expose the symbol would
 * strand the operator on a picker that cannot deliver sound. A broadcaster
 * discovering any of that mid-show is worse than never seeing the button, so
 * the three cheap negatives are checked up front.
 */
function canCaptureDisplayAudio(): boolean {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false;
    if (isNativeShell() || isPhoneLikeDevice()) return false;
    // Safari's implementation is video-only; its audio box does not exist.
    const ua = navigator.userAgent;
    const isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
    return !isSafari;
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
    const { t, isThai } = useTranslation();
    const [tracks, setTracks] = useState<MusicTrack[]>([]);
    const [current, setCurrent] = useState<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const [volume, setVolume] = useState(0.35);
    const [open, setOpen] = useState(false);

    // ─── Desktop audio capture ───
    const [captureSupported, setCaptureSupported] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [captureStarting, setCaptureStarting] = useState(false);
    const [captureVolume, setCaptureVolume] = useState(0.8);
    const [captureError, setCaptureError] = useState<CaptureError | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const gainRef = useRef<GainNode | null>(null);
    const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const publishedRef = useRef(false);

    const captureStreamRef = useRef<MediaStream | null>(null);
    const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const captureGainRef = useRef<GainNode | null>(null);

    // Feature detection runs on the client only — the button must never be
    // server-rendered into a device that cannot honour it.
    useEffect(() => {
        setCaptureSupported(canCaptureDisplayAudio());
    }, []);

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

    /**
     * Build the shared graph once. Called by whichever source starts first —
     * an AudioContext needs a user gesture to start, and both entry points
     * (play, share) are taps.
     */
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

    useEffect(() => {
        if (captureGainRef.current) captureGainRef.current.gain.value = captureVolume;
    }, [captureVolume]);

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
    // Either source being live is reason enough to re-publish.
    useEffect(() => {
        if (connected && (playing || capturing)) {
            publishedRef.current = false;
            void ensurePublished();
        }
        if (!connected) publishedRef.current = false;
    }, [connected, playing, capturing, ensurePublished]);

    // ─── Desktop audio capture ───

    /** Tear down the capture branch. Safe to call when nothing is captured. */
    const stopCapture = useCallback(() => {
        captureSourceRef.current?.disconnect();
        captureSourceRef.current = null;
        captureGainRef.current?.disconnect();
        captureGainRef.current = null;
        for (const track of captureStreamRef.current?.getTracks() ?? []) {
            try {
                track.stop();
            } catch {
                // Already ended.
            }
        }
        captureStreamRef.current = null;
        setCapturing(false);
    }, []);

    const startCapture = useCallback(async () => {
        if (captureStarting || capturing) return;
        setCaptureStarting(true);
        setCaptureError(null);
        let stream: MediaStream | null = null;
        try {
            // Video is requested even though it is discarded immediately:
            // Chrome only offers the "share tab audio" / "share system audio"
            // checkbox on a picker that includes video, and audio-only
            // getDisplayMedia is not portable. systemAudio:'include' nudges
            // Chrome to offer whole-machine sound on the screen tab.
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
                systemAudio: 'include',
            } as DisplayMediaOptions);

            // The picker is a video picker; we only ever wanted the sound.
            for (const videoTrack of stream.getVideoTracks()) {
                videoTrack.stop();
                stream.removeTrack(videoTrack);
            }

            const audioTrack = stream.getAudioTracks()[0];
            if (!audioTrack) {
                // The operator shared a source but left the audio box
                // unticked — the single most common way this fails, and
                // silent unless it is called out.
                stream.getTracks().forEach((track) => track.stop());
                stream = null;
                setCaptureError('no_audio');
                return;
            }

            ensureGraph();
            const ctx = ctxRef.current;
            const dest = destRef.current;
            if (!ctx || !dest) {
                stream.getTracks().forEach((track) => track.stop());
                stream = null;
                setCaptureError('failed');
                return;
            }
            await ctx.resume();

            const source = ctx.createMediaStreamSource(stream);
            const gain = ctx.createGain();
            gain.gain.value = captureVolume;
            source.connect(gain);
            // To the broadcast ONLY — never ctx.destination. See the file
            // header: the operator already hears this sound, and monitoring
            // system audio would feed the capture back into itself.
            gain.connect(dest);

            captureStreamRef.current = stream;
            captureSourceRef.current = source;
            captureGainRef.current = gain;
            setCapturing(true);

            // Chrome's own "Stop sharing" bar ends the track behind our back.
            audioTrack.addEventListener('ended', () => stopCapture(), { once: true });

            void ensurePublished();
        } catch (err) {
            stream?.getTracks().forEach((track) => track.stop());
            const name = err instanceof Error ? err.name : '';
            // Dismissing the picker is a choice, not a fault — say nothing
            // louder than "cancelled".
            setCaptureError(name === 'NotAllowedError' || name === 'AbortError' ? 'denied' : 'failed');
        } finally {
            setCaptureStarting(false);
        }
    }, [captureStarting, capturing, captureVolume, ensureGraph, ensurePublished, stopCapture]);

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

    // Page teardown: stop every sound source and drop the publication.
    useEffect(() => {
        return () => {
            audioRef.current?.pause();
            stopCapture();
            unpublishExtraAudio();
            void ctxRef.current?.close().catch(() => {});
        };
    }, [unpublishExtraAudio, stopCapture]);

    const captureErrorText = (code: CaptureError): string => {
        if (code === 'no_audio') {
            return (
                t('live.console.desktopAudioNoTrack') ||
                'That source was shared without sound — pick it again and tick "Share tab audio" (or "Share system audio").'
            );
        }
        if (code === 'denied') {
            return t('live.console.desktopAudioDenied') || 'Sharing cancelled';
        }
        return t('live.console.desktopAudioFailed') || 'Could not capture desktop audio';
    };

    const sliderCls = 'flex-1 accent-cyan-400';

    return (
        <div className="rounded-xl bg-white/5 border border-white/10">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 h-10 text-left"
            >
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-300 flex items-center gap-2 min-w-0">
                    <i className="fa-solid fa-music text-brand-cyan"></i>
                    <span className="truncate">{t('live.console.music') || 'Music'}</span>
                    {playing && current !== null && (
                        <span className="normal-case tracking-normal font-bold text-brand-cyan truncate">
                            {tracks[current]?.name}
                        </span>
                    )}
                    {capturing && (
                        <span className="normal-case tracking-normal font-bold text-brand-green truncate">
                            <i className="fa-solid fa-desktop mr-1"></i>
                            {t('live.console.desktopAudioLive') || 'Desktop audio on'}
                        </span>
                    )}
                </span>
                <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-slate-500 text-xs`}></i>
            </button>
            {open && (
                <div className="px-3 pb-3 space-y-3">
                    {/* ─── Bucket library ─── */}
                    {tracks.length === 0 ? (
                        <p className="text-[11px] text-slate-500">
                            {t('live.console.musicEmpty') ||
                                'No tracks yet — add audio files to the live-music bucket.'}
                        </p>
                    ) : (
                        <div>
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
                                    className={sliderCls}
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
                        </div>
                    )}

                    {/* ─── Desktop audio ───
                        Hidden entirely where getDisplayMedia is unimplemented
                        (the app WebView, phones, Safari) rather than offered
                        and then failing at the tap. */}
                    <div className="pt-2 border-t border-white/10">
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5 tracking-widest">
                            {t('live.console.desktopAudio') || 'Desktop audio'}
                        </p>
                        {!captureSupported ? (
                            <p className="text-[11px] text-slate-500 leading-snug">
                                {t('live.console.desktopAudioUnsupported') ||
                                    'Only available in a desktop browser — phones and the app cannot share desktop sound.'}
                            </p>
                        ) : (
                            <>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => (capturing ? stopCapture() : void startCapture())}
                                        disabled={captureStarting}
                                        className={`px-3 h-9 rounded-lg text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40 ${
                                            capturing
                                                ? 'bg-white/10 border border-white/15 text-slate-200'
                                                : 'bg-brand-cyan text-brand-darker'
                                        }`}
                                    >
                                        {captureStarting ? (
                                            <i className="fa-solid fa-circle-notch animate-spin"></i>
                                        ) : capturing ? (
                                            t('live.console.desktopAudioStop') || 'Stop sharing'
                                        ) : (
                                            <>
                                                <i className="fa-solid fa-desktop mr-1.5"></i>
                                                {t('live.console.desktopAudioStart') || 'Share desktop audio'}
                                            </>
                                        )}
                                    </button>
                                    {capturing && (
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={captureVolume}
                                            onChange={(e) => setCaptureVolume(Number(e.target.value))}
                                            className={sliderCls}
                                            aria-label={
                                                t('live.console.desktopAudioVolume') || 'Desktop audio volume'
                                            }
                                        />
                                    )}
                                </div>
                                {captureError && (
                                    <p className="mt-1.5 text-[11px] text-amber-300 leading-snug">
                                        {captureErrorText(captureError)}
                                    </p>
                                )}
                                <p
                                    className={`mt-1.5 text-[10px] text-slate-500 leading-snug ${
                                        isThai ? 'tracking-normal' : ''
                                    }`}
                                >
                                    {t('live.console.desktopAudioHint') ||
                                        'Pick a tab or your whole screen and tick the audio box. Viewers hear it; you keep hearing the original, so there is no echo.'}
                                </p>
                                <p className="mt-1 text-[10px] text-amber-400/80 leading-snug">
                                    <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                                    {t('live.console.desktopAudioCopyright') ||
                                        'Commercial music can get the stream muted or the account restricted on Facebook and TikTok.'}
                                </p>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
