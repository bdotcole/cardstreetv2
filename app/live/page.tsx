'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getGame, getGameLabel } from '@/lib/games';
import type { LiveStreamRow } from '@/components/live/shared';

/**
 * Live Breaks hub: a pure Whatnot-style joinable feed — live shows first,
 * then upcoming. Every tile opens the VIEWER page; hosting and scheduling
 * live in Profile > Live shows (components/live/MyLiveShows.tsx), not here.
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

function StreamTile({ stream }: { stream: LiveStreamRow }) {
    const { t, isThai } = useTranslation();
    const isLive = stream.status === 'live';
    // Cover fallback: the game's brand gradient + localized game name — every
    // tile reads as SOMETHING even before sellers upload cover art.
    const game = getGame(stream.game_id);
    return (
        <Link
            href={`/live/${stream.id}`}
            className="block glass rounded-2xl border-white/10 overflow-hidden active:scale-[0.98] transition-all"
        >
            <div className="relative aspect-[3/4] bg-slate-800">
                {stream.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={stream.cover_image_url}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div
                        className={`w-full h-full bg-gradient-to-br ${game.gradient} flex items-center justify-center px-3`}
                    >
                        <span className="text-white/90 text-sm font-black uppercase tracking-widest text-center leading-snug drop-shadow">
                            {stream.game_id
                                ? getGameLabel(stream.game_id, isThai ? 'th' : 'en')
                                : ''}
                        </span>
                        {!stream.game_id && (
                            <i className="fa-solid fa-tower-broadcast text-white/60 text-3xl"></i>
                        )}
                    </div>
                )}
                {isLive ? (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-brand-red text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                        {t('live.viewer.live') || 'LIVE'}
                        {stream.viewer_peak > 0 && (
                            <span>
                                <i className="fa-solid fa-eye mr-1 text-[8px]"></i>
                                {stream.viewer_peak}
                            </span>
                        )}
                    </span>
                ) : (
                    <>
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-slate-100 text-[10px] font-black uppercase tracking-widest">
                            {t('live.hub.soon') || 'Upcoming'}
                            {stream.scheduled_at &&
                                ` · ${new Date(stream.scheduled_at).toLocaleString(
                                    isThai ? 'th-TH' : undefined,
                                    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
                                )}`}
                        </span>
                        {stream.presale_open && (
                            <span className="absolute top-8 left-2 px-2 py-0.5 rounded-md bg-brand-cyan text-brand-darker text-[10px] font-black uppercase tracking-widest">
                                {t('live.hub.presaleOpen') || 'Presale open'}
                            </span>
                        )}
                    </>
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
                </div>
            </div>
        </Link>
    );
}

export default function LiveHubPage() {
    const { t } = useTranslation();
    const [feed, setFeed] = useState<FeedState>({ name: 'loading' });
    const [refreshing, setRefreshing] = useState(false);

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
    }, [load]);

    const refresh = useCallback(async () => {
        if (refreshing) return;
        setRefreshing(true);
        try {
            await load();
        } finally {
            setRefreshing(false);
        }
    }, [refreshing, load]);

    if (feed.name === 'denied') {
        return (
            <main className="min-h-screen bg-brand-darker text-white">
                <NotFoundBlock />
            </main>
        );
    }

    const streams = feed.name === 'ready' ? feed.streams : [];
    // The API already orders live-first; keep the two groups visually
    // distinct anyway (LIVE section, then Upcoming).
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
                    <button
                        onClick={() => void refresh()}
                        disabled={refreshing || feed.name === 'loading'}
                        aria-label={t('live.hub.refresh') || 'Refresh'}
                        className="ml-auto inline-flex w-10 h-10 rounded-xl glass border-white/10 items-center justify-center active:scale-90 transition-all disabled:opacity-50"
                    >
                        <i
                            className={`fa-solid fa-rotate-right text-slate-300 text-sm ${refreshing ? 'animate-spin' : ''}`}
                        ></i>
                    </button>
                </div>

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
                        {/* Empty LIVE slot doubles as breaker recruitment — an empty
                            feed is exactly when a would-be host is most persuadable. */}
                        {liveNow.length === 0 && (
                            <section className="mb-8">
                                <div className="glass rounded-2xl border-white/10 px-6 py-10 text-center">
                                    <i className="fa-solid fa-tower-broadcast text-slate-500 text-3xl mb-4"></i>
                                    <h2 className="text-lg font-black tracking-tight mb-2">
                                        {t('live.hub.noLiveTitle') || "No one's live right now"}
                                    </h2>
                                    <p className="text-sm text-slate-400 leading-relaxed max-w-sm mx-auto mb-6">
                                        {t('live.hub.noLiveDesc') ||
                                            'Want to be the show? Apply to become a CardStreet breaker.'}
                                    </p>
                                    <Link
                                        href="/become-a-breaker"
                                        className="inline-block px-5 py-2.5 rounded-xl bg-brand-cyan text-black text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                                    >
                                        {t('live.hub.becomeBreaker') || 'Become a breaker'}
                                    </Link>
                                </div>
                            </section>
                        )}

                        {liveNow.length > 0 && (
                            <section className="mb-8">
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-brand-red mb-3 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse"></span>
                                    {t('live.hub.liveNow') || 'Live now'}
                                </h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {liveNow.map((s) => (
                                        <StreamTile key={s.id} stream={s} />
                                    ))}
                                </div>
                            </section>
                        )}

                        {upcoming.length > 0 && (
                            <section>
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-3">
                                    {t('live.hub.upcoming') || 'Upcoming'}
                                </h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {upcoming.map((s) => (
                                        <StreamTile key={s.id} stream={s} />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Quiet recruitment path when shows are live; the empty-slot
                            CTA above covers the no-live case. */}
                        {liveNow.length > 0 && (
                            <div className="mt-10 text-center">
                                <Link
                                    href="/become-a-breaker"
                                    className="text-[11px] text-slate-500 hover:text-slate-300 underline underline-offset-4 transition-colors"
                                >
                                    {t('live.hub.becomeBreaker') || 'Become a breaker'}
                                </Link>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    );
}
