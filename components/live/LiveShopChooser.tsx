'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/hooks/useTranslation';
import type { LiveStreamRow } from '@/components/live/shared';

/**
 * Beta-only fork of the Shop tab: Live Breaks or the regular Marketplace.
 * Rendered by the shell ONLY when the 'live_streams' beta grant resolves true
 * (see components/MobileHome.tsx) — non-beta users never mount this, so it
 * carries the whole chooser UI to keep the shell's own diff minimal.
 *
 * The Live Breaks card carries a PULSE read from the public feed: how many
 * shows are on right now, who is hosting them, and when the next one starts.
 * Real numbers only — an empty schedule falls back to the plain description
 * rather than inventing activity, and the fetch fails soft, so the card
 * always renders.
 *
 * Visual language is the brand's, not generic dark-app: a holo-foil sheen
 * sweeping each card (globals.css .holo-sheen — the rare-card shine),
 * broadcast rings radiating behind the Live Breaks card (pinging only while
 * something is genuinely live), and the logo's fanned-cards motif behind
 * Marketplace. All decor is aria-hidden + pointer-events-none and sits under
 * the relative content layer.
 */

interface Pulse {
    /** Shows broadcasting right now. */
    live: number;
    /** Up to three hosts of those live shows, for the avatar stack. */
    hosts: { name: string; avatar: string | null }[];
    /** Start time of the soonest upcoming show, when nothing is live. */
    nextAt: string | null;
}

export default function LiveShopChooser({ onMarketplace }: { onMarketplace: () => void }) {
    const { t, isThai } = useTranslation();
    const router = useRouter();
    const [pulse, setPulse] = useState<Pulse | null>(null);

    // The chooser only mounts behind the 'live_streams' grant, which is the
    // same gate this endpoint checks — so a non-2xx here is a real failure,
    // not an authorization miss, and the card simply stays static.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch('/api/live/streams');
                if (!res.ok) return;
                const data = await res.json();
                const streams: LiveStreamRow[] = Array.isArray(data.streams) ? data.streams : [];
                if (cancelled) return;
                const live = streams.filter((s) => s.status === 'live');
                const next = streams.find((s) => s.status === 'scheduled' && s.scheduled_at);
                setPulse({
                    live: live.length,
                    hosts: live.slice(0, 3).map((s) => ({
                        name: s.seller?.display_name || '',
                        avatar: s.seller?.avatar_url ?? null,
                    })),
                    nextAt: next?.scheduled_at ?? null,
                });
            } catch {
                // Offline or a server hiccup — the card renders without a pulse.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const liveNow = pulse?.live ?? 0;
    const nextLabel =
        liveNow === 0 && pulse?.nextAt
            ? new Date(pulse.nextAt).toLocaleString(isThai ? 'th-TH' : undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
              })
            : null;

    const cardCls =
        'group relative w-full overflow-hidden glass rounded-[2rem] border-white/10 p-6 text-left active:scale-[0.98] transition-all';
    const arrowCls =
        'w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0';

    return (
        <div className="relative flex-1 flex flex-col justify-center pb-10">
            {/* Ambient stage light behind everything — the tab body clips
                overflow, so the blobs cost no scroll. */}
            <span
                aria-hidden
                className="pointer-events-none absolute -top-24 -left-20 w-72 h-72 rounded-full bg-brand-red/10 blur-3xl"
            />
            <span
                aria-hidden
                className="pointer-events-none absolute -bottom-28 -right-20 w-72 h-72 rounded-full bg-brand-cyan/10 blur-3xl"
            />

            <h2 className="relative w-fit text-3xl font-black tracking-tight uppercase italic skew-x-[-10deg] bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent mb-2">
                {t('live.chooser.title') || 'Shop'}
            </h2>
            <span
                aria-hidden
                className="relative block w-14 h-1 rounded-full skew-x-[-10deg] bg-gradient-to-r from-brand-red via-brand-cyan to-brand-green mb-2"
            />
            <p className="relative text-xs text-slate-400 mb-6">
                {t('live.chooser.subtitle') || 'Where to today?'}
            </p>

            <button onClick={() => router.push('/live')} className={`${cardCls} mb-4`}>
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-red/25 via-transparent to-brand-cyan/10"
                />
                <span
                    aria-hidden
                    className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full bg-brand-red/25 blur-3xl"
                />
                {/* Broadcast rings off the top-right corner; the innermost one
                    pings only while a show is actually on air. */}
                <span aria-hidden className="pointer-events-none absolute -top-12 -right-12 w-44 h-44">
                    <span className="absolute inset-0 rounded-full border border-brand-red/15" />
                    <span className="absolute inset-6 rounded-full border border-brand-red/25" />
                    <span className="absolute inset-12 rounded-full border border-brand-red/35" />
                    {liveNow > 0 && (
                        <span className="absolute inset-12 rounded-full bg-brand-red/15 animate-ping motion-reduce:animate-none" />
                    )}
                </span>
                <span aria-hidden className="pointer-events-none absolute inset-0 holo-sheen" />
                <div className="relative">
                    <div className="flex items-start gap-3 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-red/25 to-brand-red/5 ring-1 ring-brand-red/30 flex items-center justify-center shrink-0">
                            <i className="fa-solid fa-tower-broadcast text-brand-red text-lg"></i>
                        </div>
                        {liveNow > 0 ? (
                            <span className="ml-auto mt-1 px-2.5 py-1 rounded-full bg-brand-red shadow-[0_0_14px_rgba(244,63,94,0.45)] flex items-center gap-1.5 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                <span className="text-[10px] font-black uppercase tracking-widest text-white">
                                    {`${liveNow} ${t('live.chooser.liveNow') || 'live now'}`}
                                </span>
                            </span>
                        ) : (
                            nextLabel && (
                                <span className="ml-auto mt-1 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-300 shrink-0">
                                    {`${t('live.chooser.next') || 'Next'} ${nextLabel}`}
                                </span>
                            )
                        )}
                    </div>
                    <p className="text-lg font-black text-white uppercase tracking-wide">
                        {t('live.chooser.liveBreaks') || 'Live Breaks'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        {t('live.chooser.liveBreaksDesc') ||
                            'Watch live rip-and-ship shows and grab break spots'}
                    </p>
                    <div className="mt-4 flex items-center gap-3">
                        {pulse && pulse.hosts.length > 0 && (
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="flex -space-x-2 shrink-0">
                                    {pulse.hosts.map((h, i) =>
                                        h.avatar ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                key={i}
                                                src={h.avatar}
                                                alt=""
                                                className="w-6 h-6 rounded-full object-cover ring-2 ring-brand-darker"
                                            />
                                        ) : (
                                            <span
                                                key={i}
                                                className="w-6 h-6 rounded-full bg-white/10 ring-2 ring-brand-darker flex items-center justify-center"
                                            >
                                                <i className="fa-solid fa-circle-user text-slate-500 text-xs"></i>
                                            </span>
                                        ),
                                    )}
                                </div>
                                {(pulse.hosts[0].name || liveNow > 1) && (
                                    <span className="text-[11px] text-slate-400 truncate">
                                        {[pulse.hosts[0].name, liveNow > 1 ? `+${liveNow - 1}` : '']
                                            .filter(Boolean)
                                            .join(' ')}
                                    </span>
                                )}
                            </div>
                        )}
                        <span className={`${arrowCls} ml-auto`}>
                            <i className="fa-solid fa-arrow-right text-brand-red text-xs"></i>
                        </span>
                    </div>
                </div>
            </button>

            <button onClick={onMarketplace} className={cardCls}>
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-cyan/20 via-transparent to-brand-green/10"
                />
                <span
                    aria-hidden
                    className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full bg-brand-cyan/20 blur-3xl"
                />
                {/* The logo's fanned-cards motif, ghosted behind the content. */}
                <span aria-hidden className="pointer-events-none absolute right-3 top-5 w-32 h-24">
                    <span className="absolute right-16 top-2 w-10 h-14 rounded-md border border-brand-green/40 bg-gradient-to-b from-brand-green/15 to-transparent -rotate-12" />
                    <span className="absolute right-8 top-0 w-10 h-14 rounded-md border border-brand-red/40 bg-gradient-to-b from-brand-red/15 to-transparent -rotate-2" />
                    <span className="absolute right-0 top-1 w-10 h-14 rounded-md border border-brand-cyan/40 bg-gradient-to-b from-brand-cyan/15 to-transparent rotate-6" />
                </span>
                <span aria-hidden className="pointer-events-none absolute inset-0 holo-sheen" />
                <div className="relative">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-cyan/25 to-brand-cyan/5 ring-1 ring-brand-cyan/30 flex items-center justify-center mb-4">
                        <i className="fa-solid fa-shop text-brand-cyan text-lg"></i>
                    </div>
                    <p className="text-lg font-black text-white uppercase tracking-wide">
                        {t('live.chooser.marketplace') || 'Marketplace'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        {t('live.chooser.marketplaceDesc') ||
                            'Browse singles and sealed from verified sellers'}
                    </p>
                    <div className="mt-4 flex items-center">
                        <span className={`${arrowCls} ml-auto`}>
                            <i className="fa-solid fa-arrow-right text-brand-cyan text-xs"></i>
                        </span>
                    </div>
                </div>
            </button>
        </div>
    );
}
