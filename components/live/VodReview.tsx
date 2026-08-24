'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';

/**
 * Post-show VOD review + retro-clipping, on the broadcast console.
 *
 * This is the recording's only in-app surface: until it existed, vod_url was
 * served to the seller and rendered nowhere. The breaker scrubs the VOD,
 * optionally marks in/out points, and mints share-page clips
 * (/clip/[id]) after the fact — the promo path for the next show.
 *
 * Clip windows are measured on the VOD playhead. Offsets in stream_clips are
 * relative to streams.started_at, and recording starts in the same request
 * that sets started_at, so playhead seconds ≈ stream offset within a beat or
 * two — the same tolerance live clips already accept.
 */

const MAX_CLIP_MS = 120_000;
const AUTO_PRE_S = 25;
const AUTO_POST_S = 5;

interface ClipRow {
    id: string;
    title: string | null;
    start_ms: number;
    end_ms: number;
    created_at: string;
}

const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

export default function VodReview({ streamId, vodUrl }: { streamId: string; vodUrl: string }) {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const [clips, setClips] = useState<ClipRow[]>([]);
    const [title, setTitle] = useState('');
    const [markIn, setMarkIn] = useState<number | null>(null);
    const [markOut, setMarkOut] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    const loadClips = useCallback(async () => {
        try {
            const res = await fetch(`/api/live/streams/${streamId}/clip`);
            if (!res.ok) return;
            const data = await res.json().catch(() => null);
            if (Array.isArray(data?.clips)) setClips(data.clips);
        } catch {
            // List is decoration; minting still works.
        }
    }, [streamId]);

    useEffect(() => {
        void loadClips();
    }, [loadClips]);

    const createClip = useCallback(async () => {
        const video = videoRef.current;
        if (!video || saving) return;
        // Explicit marks win; otherwise auto-window around the playhead —
        // the same shape the live Clip button captures.
        const at = video.currentTime;
        const startS = markIn ?? Math.max(0, at - AUTO_PRE_S);
        let endS = markOut ?? Math.min(at + AUTO_POST_S, startS + MAX_CLIP_MS / 1000);
        if (endS <= startS) {
            showToast(t('live.console.clipBadWindow') || 'End must come after start', 'error');
            return;
        }
        if ((endS - startS) * 1000 > MAX_CLIP_MS) {
            endS = startS + MAX_CLIP_MS / 1000;
        }
        setSaving(true);
        try {
            const res = await fetch(`/api/live/streams/${streamId}/clip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim() || undefined,
                    startMs: Math.floor(startS * 1000),
                    endMs: Math.floor(endS * 1000),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(data.error || t('live.console.clipError') || 'Could not save the clip', 'error');
                return;
            }
            setTitle('');
            setMarkIn(null);
            setMarkOut(null);
            showToast(t('live.console.clipMinted') || 'Clip created', 'success');
            void loadClips();
        } catch {
            showToast(t('live.console.clipError') || 'Could not save the clip', 'error');
        } finally {
            setSaving(false);
        }
    }, [saving, markIn, markOut, title, streamId, showToast, t, loadClips]);

    const copyLink = useCallback(
        async (id: string) => {
            const url = `https://cardstreet.app/clip/${id}`;
            try {
                await navigator.clipboard.writeText(url);
                showToast(t('live.console.linkCopied') || 'Link copied', 'success');
            } catch {
                showToast(url, 'info');
            }
        },
        [showToast, t],
    );

    const markBtn =
        'px-3 h-9 rounded-lg bg-white/10 border border-white/15 text-white text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all';

    return (
        <div className="mb-4 rounded-2xl bg-white/5 border border-white/10 p-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-300 mb-2">
                <i className="fa-solid fa-film mr-2 text-brand-cyan"></i>
                {t('live.console.vodReview') || 'Show recording'}
            </p>
            <video
                ref={videoRef}
                src={vodUrl}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[50vh] bg-black rounded-xl"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                    onClick={() => setMarkIn(videoRef.current?.currentTime ?? 0)}
                    className={markBtn}
                >
                    {t('live.console.markIn') || 'Mark start'}
                    {markIn !== null && <span className="ml-1.5 text-brand-cyan">{fmt(markIn)}</span>}
                </button>
                <button
                    onClick={() => setMarkOut(videoRef.current?.currentTime ?? 0)}
                    className={markBtn}
                >
                    {t('live.console.markOut') || 'Mark end'}
                    {markOut !== null && <span className="ml-1.5 text-brand-cyan">{fmt(markOut)}</span>}
                </button>
                {(markIn !== null || markOut !== null) && (
                    <button onClick={() => { setMarkIn(null); setMarkOut(null); }} className={markBtn}>
                        {t('live.console.markClear') || 'Clear'}
                    </button>
                )}
            </div>

            <div className="mt-2 flex gap-2">
                <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    placeholder={t('live.console.clipTitlePlaceholder') || 'Clip title (optional)...'}
                    className="flex-1 h-10 px-3 rounded-xl bg-slate-900/80 border border-white/10 text-sm text-white placeholder:text-slate-500"
                />
                <button
                    onClick={() => void createClip()}
                    disabled={saving}
                    className="px-4 h-10 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
                >
                    <i className="fa-solid fa-scissors mr-2"></i>
                    {t('live.console.clipHere') || 'Clip this moment'}
                </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
                {t('live.console.clipHint') ||
                    'No marks = the 30 seconds around the playhead. Clips are capped at 2 minutes.'}
            </p>

            {clips.length > 0 && (
                <div className="mt-3 space-y-1.5">
                    {clips.map((c) => (
                        <div
                            key={c.id}
                            className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-2"
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-bold text-white truncate">
                                    {c.title || (t('live.console.clipUntitled') || 'Highlight')}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                    {fmt(c.start_ms / 1000)} → {fmt(c.end_ms / 1000)} ·{' '}
                                    {Math.round((c.end_ms - c.start_ms) / 1000)}s
                                </p>
                            </div>
                            <a
                                href={`/clip/${c.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-black uppercase tracking-widest text-brand-cyan"
                            >
                                {t('live.console.clipOpen') || 'Open'}
                            </a>
                            <button onClick={() => void copyLink(c.id)} className={markBtn}>
                                <i className="fa-solid fa-link"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
