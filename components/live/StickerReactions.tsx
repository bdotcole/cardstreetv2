'use client';

/**
 * Ephemeral sticker reactions — the client half. No persistence anywhere:
 * the /react route relays a tap to Supabase Realtime's broadcast REST
 * endpoint on channel `stream-react:{streamId}`, subscribers float the
 * sticker over the video, and that's the entire lifecycle.
 *
 * State lives in useFloatingStickers so a page can render the SAME float list
 * into two layers (the viewer mounts both a mobile and a desktop video tree;
 * only the visible one animates and reaps). Concurrency is capped — a spike
 * drops the excess instead of melting the compositor.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { STICKER_KEYS, StickerIcon, type StickerKey } from '@/components/live/stickers';

const MAX_CONCURRENT_FLOATS = 20;
const FLOAT_DURATION_MS = 2600;

export interface StickerFloat {
    id: number;
    sticker: StickerKey;
    /** Horizontal spawn position, % of the layer width. */
    left: number;
    /** Horizontal drift over the float, px. */
    driftPx: number;
    scale: number;
}

export interface FloatingStickers {
    floats: StickerFloat[];
    spawn: (sticker: StickerKey) => void;
    remove: (id: number) => void;
}

export function useFloatingStickers(): FloatingStickers {
    const [floats, setFloats] = useState<StickerFloat[]>([]);
    const nextIdRef = useRef(0);

    const spawn = useCallback((sticker: StickerKey) => {
        setFloats((prev) => {
            if (prev.length >= MAX_CONCURRENT_FLOATS) return prev; // drop excess
            const id = nextIdRef.current++;
            return [
                ...prev,
                {
                    id,
                    sticker,
                    left: 8 + Math.random() * 72,
                    driftPx: (Math.random() - 0.5) * 70,
                    scale: 0.85 + Math.random() * 0.5,
                },
            ];
        });
    }, []);

    const remove = useCallback((id: number) => {
        setFloats((prev) => (prev.some((f) => f.id === id) ? prev.filter((f) => f.id !== id) : prev));
    }, []);

    // Safety sweep: animationend never fires inside a display:none subtree
    // (the hidden twin layer) or a backgrounded WebView — without this, a
    // burst while hidden would pin the list at the cap forever.
    useEffect(() => {
        if (floats.length === 0) return;
        const timer = setTimeout(() => {
            const cutoff = nextIdRef.current;
            setFloats((prev) => prev.filter((f) => f.id >= cutoff));
        }, FLOAT_DURATION_MS + 500);
        return () => clearTimeout(timer);
    }, [floats]);

    return { floats, spawn, remove };
}

/**
 * The overlay itself: absolutely fills its (position:relative) parent,
 * pointer-transparent, pure-CSS float animation.
 */
export function FloatingStickerLayer({ floats, onDone }: { floats: StickerFloat[]; onDone: (id: number) => void }) {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-20">
            <style>{`
                @keyframes cs-sticker-float {
                    0% { transform: translateY(0) translateX(0) scale(var(--cs-scale)); opacity: 0; }
                    12% { opacity: 1; }
                    80% { opacity: 0.9; }
                    100% { transform: translateY(-14rem) translateX(var(--cs-drift)) scale(var(--cs-scale)); opacity: 0; }
                }
            `}</style>
            {floats.map((f) => (
                <div
                    key={f.id}
                    onAnimationEnd={() => onDone(f.id)}
                    className="absolute bottom-[12%] w-9 h-9 will-change-transform"
                    style={
                        {
                            left: `${f.left}%`,
                            animation: `cs-sticker-float ${FLOAT_DURATION_MS}ms ease-out forwards`,
                            '--cs-drift': `${f.driftPx}px`,
                            '--cs-scale': `${f.scale}`,
                        } as React.CSSProperties
                    }
                >
                    <StickerIcon sticker={f.sticker} className="w-full h-full drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]" />
                </div>
            ))}
        </div>
    );
}

/** The viewer's tap-to-send row — one button per sticker. */
export function StickerTray({
    onSend,
    className = '',
}: {
    onSend: (sticker: StickerKey) => void;
    className?: string;
}) {
    const { t } = useTranslation();
    return (
        <div className={`flex items-center gap-1.5 ${className}`}>
            {STICKER_KEYS.map((key) => (
                <button
                    key={key}
                    onClick={() => onSend(key)}
                    aria-label={t(`live.stickers.${key}`)}
                    className="w-9 h-9 rounded-full bg-black/50 border border-white/15 flex items-center justify-center backdrop-blur-sm active:scale-90 transition-all"
                >
                    <StickerIcon sticker={key} className="w-5 h-5" />
                </button>
            ))}
        </div>
    );
}

// ─── Reaction feed: reactions surfaced IN CHAT, not only as floats ───
// The field test showed floats alone under-deliver: the console renders them
// over a (often collapsed) monitor thumbnail, and a float over busy video is
// easy to miss entirely. These lines make every reaction legible where people
// are already looking — the chat — with sender attribution (the broadcast
// payload has carried `from` since day one; this is its first reader).

const REACTION_LINE_TTL_MS = 8000;
/** Same sender + same sticker inside this window merge into one "xN" line. */
const REACTION_COALESCE_MS = 6000;
const REACTION_LINES_MAX = 4;

export interface ReactionLine {
    id: number;
    name: string | null;
    sticker: StickerKey;
    count: number;
    at: number;
}

export interface ReactionFeed {
    lines: ReactionLine[];
    push: (sticker: StickerKey, name: string | null) => void;
}

export function useReactionFeed(): ReactionFeed {
    const [lines, setLines] = useState<ReactionLine[]>([]);
    const nextIdRef = useRef(0);

    const push = useCallback((sticker: StickerKey, name: string | null) => {
        const now = Date.now();
        setLines((prev) => {
            const last = prev[prev.length - 1];
            if (
                last &&
                last.sticker === sticker &&
                last.name === name &&
                now - last.at < REACTION_COALESCE_MS
            ) {
                return [...prev.slice(0, -1), { ...last, count: last.count + 1, at: now }];
            }
            const next = [...prev, { id: nextIdRef.current++, name, sticker, count: 1, at: now }];
            return next.slice(-REACTION_LINES_MAX);
        });
    }, []);

    // Reap expired lines while any exist (1s granularity is plenty).
    useEffect(() => {
        if (lines.length === 0) return;
        const timer = setInterval(() => {
            const cutoff = Date.now() - REACTION_LINE_TTL_MS;
            setLines((prev) => {
                const kept = prev.filter((l) => l.at > cutoff);
                return kept.length === prev.length ? prev : kept;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [lines.length]);

    return { lines, push };
}

/** The chat-flow rendering of the reaction feed — sits under the newest
 *  messages, above the input, in both the viewer and the console. */
export function ReactionFeedLines({ lines, anonymousLabel }: { lines: ReactionLine[]; anonymousLabel: string }) {
    if (lines.length === 0) return null;
    return (
        <>
            {lines.map((l) => (
                <p
                    key={l.id}
                    className="flex items-center gap-1.5 py-0.5 px-2 text-[13px] leading-snug"
                >
                    <span className="font-black text-brand-cyan">{l.name || anonymousLabel}</span>
                    <StickerIcon sticker={l.sticker} className="w-4 h-4 shrink-0" />
                    {l.count > 1 && (
                        <span className="text-[11px] font-black text-white/70 tabular-nums">
                            x{l.count}
                        </span>
                    )}
                </p>
            ))}
        </>
    );
}
