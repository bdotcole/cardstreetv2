'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useBetaFeatures } from '@/lib/hooks/useBetaFeatures';
import { createClient } from '@/lib/supabase/client';
import type { LiveStreamRow } from '@/components/live/shared';

/**
 * Live Breaks hub: live-now + upcoming grids from GET /api/live/streams.
 *
 * Access posture: the SERVER decides. A non-beta user's fetch 404s and this
 * page renders the same generic not-found block as app/not-found.tsx — no
 * "beta"/"coming soon" hints that would advertise the feature's existence.
 */

type FeedState =
    | { name: 'loading' }
    | { name: 'denied' }
    | { name: 'error' }
    | { name: 'ready'; streams: LiveStreamRow[] };

function NotFoundBlock() {
    const { t } = useTranslation();
    return (
        <div className="min-h-[70vh] flex items-center justify-center px-6 text-center">
            <div className="max-w-md">
                <p className="text-6xl font-black tracking-tight mb-3 opacity-90">404</p>
                <h1 className="text-xl font-bold mb-2">{t('live.notFound.title') || 'Page not found'}</h1>
                <p className="opacity-70 mb-6 text-sm leading-relaxed">
                    {t('live.notFound.desc') ||
                        "The page you're looking for may have moved or no longer exists."}
                </p>
                <a
                    href="/"
                    className="inline-block px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider bg-brand-cyan text-black hover:opacity-90 transition-opacity"
                >
                    {t('live.notFound.back') || 'Back home'}
                </a>
            </div>
        </div>
    );
}

function StreamCard({
    stream,
    isOwn,
}: {
    stream: LiveStreamRow;
    isOwn: boolean;
}) {
    const { t } = useTranslation();
    const href = isOwn ? `/live/broadcast/${stream.id}` : `/live/${stream.id}`;
    const isLive = stream.status === 'live';
    return (
        <Link
            href={href}
            className="block glass rounded-2xl border-white/10 overflow-hidden active:scale-[0.98] transition-all"
        >
            <div className="relative aspect-video bg-slate-800">
                {stream.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={stream.cover_image_url}
                        alt=""
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <i className="fa-solid fa-tower-broadcast text-slate-600 text-3xl"></i>
                    </div>
                )}
                {isLive ? (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-brand-red text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                        {t('live.viewer.live') || 'LIVE'}
                    </span>
                ) : (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-slate-200 text-[10px] font-black uppercase tracking-widest">
                        {t('live.viewer.scheduled') || 'Scheduled'}
                    </span>
                )}
                {isOwn && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-brand-cyan text-brand-darker text-[10px] font-black uppercase tracking-widest">
                        {t('live.hub.manage') || 'Console'}
                    </span>
                )}
            </div>
            <div className="p-3">
                <p className="text-sm font-bold text-white leading-snug line-clamp-2">{stream.title}</p>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                    {stream.seller?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={stream.seller.avatar_url}
                            alt=""
                            className="w-4 h-4 rounded-full object-cover"
                        />
                    ) : (
                        <i className="fa-solid fa-circle-user"></i>
                    )}
                    <span className="truncate">{stream.seller?.display_name || '—'}</span>
                    {!isLive && stream.scheduled_at && (
                        <span className="ml-auto shrink-0">
                            {new Date(stream.scheduled_at).toLocaleString(undefined, {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                            })}
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
}

export default function LiveHubPage() {
    const { t } = useTranslation();
    const router = useRouter();
    const { hasBeta } = useBetaFeatures();
    const [feed, setFeed] = useState<FeedState>({ name: 'loading' });
    const [myUserId, setMyUserId] = useState<string | null>(null);

    // Host-a-show mini form (broadcaster grant only).
    const [showHostForm, setShowHostForm] = useState(false);
    const [showTitle, setShowTitle] = useState('');
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/live/streams');
            if (!res.ok) {
                // 401/403/404/503 all render the generic not-found block — the
                // server's no-hint posture carried through to the client.
                setFeed(res.status >= 500 ? { name: 'error' } : { name: 'denied' });
                return;
            }
            const data = await res.json();
            setFeed({ name: 'ready', streams: Array.isArray(data.streams) ? data.streams : [] });
        } catch {
            setFeed({ name: 'error' });
        }
    }, []);

    useEffect(() => {
        void load();
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
    }, [load]);

    const createShow = useCallback(async () => {
        if (showTitle.trim().length < 3 || creating) return;
        setCreating(true);
        setCreateError(null);
        try {
            const res = await fetch('/api/live/streams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: showTitle.trim() }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setCreateError(data.error || t('live.hub.createError') || 'Could not create the show');
                return;
            }
            router.push(`/live/broadcast/${data.stream.id}`);
        } catch {
            setCreateError(t('live.hub.createError') || 'Could not create the show');
        } finally {
            setCreating(false);
        }
    }, [showTitle, creating, router, t]);

    if (feed.name === 'denied') {
        return (
            <main className="min-h-screen bg-brand-darker text-white">
                <NotFoundBlock />
            </main>
        );
    }

    const streams = feed.name === 'ready' ? feed.streams : [];
    const liveNow = streams.filter((s) => s.status === 'live');
    const upcoming = streams.filter((s) => s.status === 'scheduled');

    return (
        <main className="min-h-screen bg-brand-darker text-white px-5 pb-16 pt-[calc(var(--sat)+2.5rem)]">
            <div className="w-full max-w-[480px] lg:max-w-4xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                    <Link
                        href="/"
                        aria-label="Back"
                        className="inline-flex w-10 h-10 rounded-xl glass border-white/10 items-center justify-center active:scale-90 transition-all"
                    >
                        <i className="fa-solid fa-chevron-left text-slate-400 text-sm"></i>
                    </Link>
                    <h1 className="text-2xl font-black tracking-tight uppercase italic skew-x-[-10deg]">
                        {t('live.hub.title') || 'Live Breaks'}
                    </h1>
                    {hasBeta('live_broadcast') && (
                        <button
                            onClick={() => setShowHostForm((v) => !v)}
                            className="ml-auto px-4 h-10 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                        >
                            {t('live.hub.hostShow') || 'Host a show'}
                        </button>
                    )}
                </div>

                {showHostForm && (
                    <div className="glass rounded-2xl border-white/10 p-4 mb-6">
                        <label className="block text-[10px] text-slate-400 font-black uppercase tracking-widest mb-2">
                            {t('live.hub.showTitle') || 'Show title'}
                        </label>
                        <div className="flex gap-2">
                            <input
                                value={showTitle}
                                onChange={(e) => setShowTitle(e.target.value)}
                                maxLength={120}
                                className="flex-1 h-11 rounded-xl bg-black/30 border border-white/10 px-3 text-sm text-white outline-none focus:border-brand-cyan/50"
                            />
                            <button
                                onClick={createShow}
                                disabled={creating || showTitle.trim().length < 3}
                                className="px-4 h-11 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest disabled:opacity-40 active:scale-95 transition-all"
                            >
                                {creating
                                    ? t('live.hub.creating') || 'Scheduling...'
                                    : t('live.hub.create') || 'Schedule'}
                            </button>
                        </div>
                        {createError && <p className="text-xs text-brand-red mt-2">{createError}</p>}
                    </div>
                )}

                {feed.name === 'loading' && (
                    <div className="min-h-[40vh] flex items-center justify-center">
                        <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl"></i>
                    </div>
                )}

                {feed.name === 'error' && (
                    <div className="min-h-[40vh] flex flex-col items-center justify-center text-center">
                        <p className="text-sm text-slate-400">
                            {t('live.hub.loadError') || 'Could not load shows'}
                        </p>
                        <button
                            onClick={() => {
                                setFeed({ name: 'loading' });
                                void load();
                            }}
                            className="mt-4 px-5 h-10 rounded-xl bg-white/10 text-white text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                        >
                            {t('live.hub.retry') || 'Retry'}
                        </button>
                    </div>
                )}

                {feed.name === 'ready' && (
                    <>
                        {liveNow.length === 0 && upcoming.length === 0 && (
                            <div className="min-h-[40vh] flex flex-col items-center justify-center text-center">
                                <i className="fa-solid fa-tower-broadcast text-slate-600 text-3xl mb-4"></i>
                                <p className="text-sm text-slate-400">
                                    {t('live.hub.empty') || 'No shows right now — check back soon'}
                                </p>
                            </div>
                        )}

                        {liveNow.length > 0 && (
                            <section className="mb-8">
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-brand-red mb-3 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse"></span>
                                    {t('live.hub.liveNow') || 'Live now'}
                                </h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {liveNow.map((s) => (
                                        <StreamCard key={s.id} stream={s} isOwn={s.seller_id === myUserId} />
                                    ))}
                                </div>
                            </section>
                        )}

                        {upcoming.length > 0 && (
                            <section>
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                                    {t('live.hub.upcoming') || 'Upcoming'}
                                </h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {upcoming.map((s) => (
                                        <StreamCard key={s.id} stream={s} isOwn={s.seller_id === myUserId} />
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
