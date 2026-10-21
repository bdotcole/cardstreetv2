'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import type { LiveStreamRow } from '@/components/live/shared';
import { computeServerOffset, formatTimeLeft } from '@/components/auctions/auctionShared';

/**
 * The Shop section switch (November layout): Marketplace, Auction House,
 * Live Breaks, Digital Packs. Rendered by the shell ONLY while the GRANT_ONLY
 * 'shop_hub' flag resolves true (see components/MobileHome.tsx) — nobody else
 * mounts this, so it carries the whole hub UI to keep the shell's diff small.
 *
 * Succeeds the two-way Live-vs-Marketplace chooser and keeps its visual
 * language — the brand's, not generic dark-app: a holo-foil sheen sweeping
 * each tile (globals.css .holo-sheen), broadcast rings behind Live Breaks
 * (pinging only while a show is genuinely on air), the logo's fanned-cards
 * motif behind Marketplace. All decor is aria-hidden + pointer-events-none
 * under the relative content layer.
 *
 * Each tile carries a PULSE read from its own public feed — shows on air,
 * auctions running and the soonest hammer. Real numbers only: an empty
 * schedule falls back to the plain description rather than inventing
 * activity, and every fetch fails soft, so the tiles always render. Two
 * columns on purpose: the tab body clips overflow, and four full-height
 * cards would not fit a small phone.
 */

interface LivePulse {
    live: number;
    nextAt: string | null;
}

interface AuctionPulse {
    live: number;
    /** ms until the soonest hammer, server-anchored. */
    soonestMs: number | null;
}

interface ShopHubProps {
    onMarketplace: () => void;
    onAuctions: () => void;
    onLive: () => void;
    onPacks: () => void;
}

type Accent = 'cyan' | 'amber' | 'red' | 'purple';

// Explicit per-accent classes (Tailwind only keeps class names it can see).
const ACCENT = {
    cyan: {
        wash: 'from-brand-cyan/20 via-transparent to-brand-green/10',
        glow: 'bg-brand-cyan/20',
        badge: 'from-brand-cyan/25 to-brand-cyan/5 ring-brand-cyan/30',
        icon: 'text-brand-cyan',
    },
    amber: {
        wash: 'from-amber-400/20 via-transparent to-orange-500/10',
        glow: 'bg-amber-400/20',
        badge: 'from-amber-400/25 to-amber-400/5 ring-amber-400/30',
        icon: 'text-amber-400',
    },
    red: {
        wash: 'from-brand-red/25 via-transparent to-brand-cyan/10',
        glow: 'bg-brand-red/25',
        badge: 'from-brand-red/25 to-brand-red/5 ring-brand-red/30',
        icon: 'text-brand-red',
    },
    purple: {
        wash: 'from-brand-purple/25 via-transparent to-fuchsia-500/10',
        glow: 'bg-brand-purple/25',
        badge: 'from-brand-purple/25 to-brand-purple/5 ring-brand-purple/30',
        icon: 'text-brand-purple',
    },
} as const satisfies Record<Accent, Record<string, string>>;

function Tile({
    accent,
    icon,
    title,
    desc,
    chip,
    chipLive = false,
    decor,
    onClick,
}: {
    accent: Accent;
    icon: string;
    title: string;
    desc: string;
    chip?: string | null;
    /** Render the chip as the solid "on air" pill instead of the quiet one. */
    chipLive?: boolean;
    decor?: React.ReactNode;
    onClick: () => void;
}) {
    const a = ACCENT[accent];
    return (
        <button
            onClick={onClick}
            className="group relative overflow-hidden glass rounded-[1.75rem] border-white/10 px-4 py-5 text-left min-h-[12rem] flex flex-col active:scale-[0.97] transition-all"
        >
            <span aria-hidden className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${a.wash}`} />
            <span aria-hidden className={`pointer-events-none absolute -top-14 -right-10 w-40 h-40 rounded-full blur-3xl ${a.glow}`} />
            {decor}
            <span aria-hidden className="pointer-events-none absolute inset-0 holo-sheen" />
            <div className="relative flex flex-col flex-1">
                <div className="flex items-start justify-between gap-2">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ring-1 ${a.badge} flex items-center justify-center shrink-0`}>
                        <i className={`fa-solid ${icon} ${a.icon} text-xl`}></i>
                    </div>
                    {chip && (
                        chipLive ? (
                            <span className="mt-0.5 px-2 py-1 rounded-full bg-brand-red shadow-[0_0_14px_rgba(244,63,94,0.45)] flex items-center gap-1.5 shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                <span className="text-[10px] font-black uppercase tracking-widest text-white">{chip}</span>
                            </span>
                        ) : (
                            <span className="mt-0.5 px-2 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-300 shrink-0 max-w-[7.5rem] truncate">
                                {chip}
                            </span>
                        )
                    )}
                </div>
                {/* Scaled to the tile, not fixed: two columns leave ~120px of
                    text width on a 360-375px phone, where a 20px MARKETPLACE
                    (one unbreakable word) clips. 4.35vw keeps that word on one
                    line down to 360px and reaches the full 20px by ~460px. */}
                <p className="mt-auto pt-5 text-[clamp(15px,4.35vw,20px)] leading-tight font-black text-white uppercase">{title}</p>
                <p className="text-[13px] text-slate-400 mt-1.5 leading-snug line-clamp-3">{desc}</p>
                <div className="mt-4 flex items-center">
                    <span className="ml-auto w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        <i className={`fa-solid fa-arrow-right ${a.icon} text-xs`}></i>
                    </span>
                </div>
            </div>
        </button>
    );
}

export default function ShopHub({ onMarketplace, onAuctions, onLive, onPacks }: ShopHubProps) {
    const { t, isThai } = useTranslation();
    const [livePulse, setLivePulse] = useState<LivePulse | null>(null);
    const [auctionPulse, setAuctionPulse] = useState<AuctionPulse | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await fetch('/api/live/streams');
                if (!res.ok) return;
                const data = await res.json();
                const streams: LiveStreamRow[] = Array.isArray(data.streams) ? data.streams : [];
                if (cancelled) return;
                const next = streams.find((s) => s.status === 'scheduled' && s.scheduled_at);
                setLivePulse({
                    live: streams.filter((s) => s.status === 'live').length,
                    nextAt: next?.scheduled_at ?? null,
                });
            } catch {
                // Offline or a server hiccup — the tile renders without a pulse.
            }
        })();
        void (async () => {
            try {
                const res = await fetch('/api/auctions?scope=live&limit=50');
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled) return;
                const rows: { ends_at: string }[] = Array.isArray(data.auctions) ? data.auctions : [];
                const offset = computeServerOffset(data.serverNow);
                const now = Date.now() + offset;
                const soonest = rows
                    .map((r) => Date.parse(r.ends_at) - now)
                    .filter((ms) => Number.isFinite(ms) && ms > 0)
                    .sort((x, y) => x - y)[0];
                setAuctionPulse({ live: rows.length, soonestMs: soonest ?? null });
            } catch {
                // Same: static tile.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const liveNow = livePulse?.live ?? 0;
    const nextLabel =
        liveNow === 0 && livePulse?.nextAt
            ? new Date(livePulse.nextAt).toLocaleString(isThai ? 'th-TH' : undefined, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
              })
            : null;
    const liveChip = liveNow > 0
        ? `${liveNow} ${t('shopHub.liveNow') || 'live now'}`
        : nextLabel
            ? `${t('shopHub.next') || 'Next'} ${nextLabel}`
            : null;

    const auctionChip = auctionPulse && auctionPulse.live > 0
        ? auctionPulse.soonestMs != null
            ? (t('shopHub.endsIn') || 'Ends {t}').replace('{t}', formatTimeLeft(auctionPulse.soonestMs, isThai))
            : (t('shopHub.auctionsLive') || '{n} live').replace('{n}', String(auctionPulse.live))
        : null;

    return (
        // Top-aligned with the tile grid stretching to the tab bar: the hub
        // is the Shop tab's front door, so it fills the screen instead of
        // floating as a small centred block with dead space above it. The
        // bottom padding clears the absolutely positioned nav.
        <div className="relative flex-1 flex flex-col min-h-0 pt-2 pb-28">
            {/* Ambient stage light behind everything — the tab body clips
                overflow, so the blobs cost no scroll. */}
            <span aria-hidden className="pointer-events-none absolute -top-24 -left-20 w-72 h-72 rounded-full bg-brand-red/10 blur-3xl" />
            <span aria-hidden className="pointer-events-none absolute -bottom-28 -right-20 w-72 h-72 rounded-full bg-brand-cyan/10 blur-3xl" />

            {/* The brand wordmark, not a section label: the Marketplace lost
                its "Cardstreet's Market" title in favour of a back button, so
                this is where the name lives now. */}
            <h2 className="relative w-fit text-4xl font-black tracking-tighter italic skew-x-[-10deg] bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent mb-2 pr-2">
                {t('shopHub.title') || 'Cardstreet'}
            </h2>
            <span
                aria-hidden
                className="relative block w-14 h-1 rounded-full skew-x-[-10deg] bg-gradient-to-r from-brand-red via-brand-cyan to-brand-green mb-2"
            />
            <p className="relative text-sm text-slate-400 mb-5">{t('shopHub.subtitle') || 'Where to today?'}</p>

            <div className="relative flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3">
                <Tile
                    accent="cyan"
                    icon="fa-shop"
                    title={t('shopHub.marketplace') || 'Marketplace'}
                    desc={t('shopHub.marketplaceDesc') || 'Singles and sealed from verified sellers'}
                    onClick={onMarketplace}
                    decor={
                        // The logo's fanned-cards motif, ghosted behind the content.
                        <span aria-hidden className="pointer-events-none absolute right-2 top-3 w-24 h-20">
                            <span className="absolute right-12 top-2 w-8 h-11 rounded-md border border-brand-green/40 bg-gradient-to-b from-brand-green/15 to-transparent -rotate-12" />
                            <span className="absolute right-6 top-0 w-8 h-11 rounded-md border border-brand-red/40 bg-gradient-to-b from-brand-red/15 to-transparent -rotate-2" />
                            <span className="absolute right-0 top-1 w-8 h-11 rounded-md border border-brand-cyan/40 bg-gradient-to-b from-brand-cyan/15 to-transparent rotate-6" />
                        </span>
                    }
                />
                <Tile
                    accent="amber"
                    icon="fa-gavel"
                    title={t('shopHub.auctions') || 'Auction House'}
                    desc={t('shopHub.auctionsDesc') || 'Timed auctions. Set a max, we bid for you'}
                    chip={auctionChip}
                    onClick={onAuctions}
                    decor={
                        // Concentric "hammer" rings off the corner.
                        <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 w-36 h-36">
                            <span className="absolute inset-0 rounded-full border border-amber-400/15" />
                            <span className="absolute inset-5 rounded-full border border-amber-400/25" />
                            <span className="absolute inset-10 rounded-full border border-amber-400/35" />
                        </span>
                    }
                />
                <Tile
                    accent="red"
                    icon="fa-tower-broadcast"
                    title={t('shopHub.live') || 'Live Breaks'}
                    desc={t('shopHub.liveDesc') || 'Watch rip-and-ship shows live and grab spots'}
                    chip={liveChip}
                    chipLive={liveNow > 0}
                    onClick={onLive}
                    decor={
                        // Broadcast rings; the innermost pings only while on air.
                        <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 w-36 h-36">
                            <span className="absolute inset-0 rounded-full border border-brand-red/15" />
                            <span className="absolute inset-5 rounded-full border border-brand-red/25" />
                            <span className="absolute inset-10 rounded-full border border-brand-red/35" />
                            {liveNow > 0 && (
                                <span className="absolute inset-10 rounded-full bg-brand-red/15 animate-ping motion-reduce:animate-none" />
                            )}
                        </span>
                    }
                />
                <Tile
                    accent="purple"
                    icon="fa-box-open"
                    title={t('shopHub.packs') || 'Digital Packs'}
                    desc={t('shopHub.packsDesc') || 'Open mystery packs with real cards inside'}
                    chip={t('shopHub.preview') || 'Preview'}
                    onClick={onPacks}
                    decor={
                        // A pack silhouette, foil edge catching the light.
                        <span aria-hidden className="pointer-events-none absolute right-3 top-3 w-12 h-16 rounded-lg border border-brand-purple/40 bg-gradient-to-b from-brand-purple/20 via-fuchsia-500/10 to-transparent rotate-6">
                            <span className="absolute inset-x-1 top-2 h-px bg-white/30" />
                        </span>
                    }
                />
            </div>
        </div>
    );
}
