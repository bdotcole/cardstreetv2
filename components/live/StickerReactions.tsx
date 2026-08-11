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
import { createClient } from '@/lib/supabase/client';
import { STICKER_KEYS, StickerIcon, isStickerKey, type StickerKey } from '@/components/live/stickers';

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

/**
 * Subscribe to the stream's broadcast channel and float incoming stickers.
 * Server-relayed only: local sends float optimistically at the call site, and
 * the REST broadcast never echoes to its sender anyway.
 */
export function useStickerBroadcast(
    streamId: string,
    active: boolean,
    onSticker: (sticker: StickerKey) => void,
): void {
    const onStickerRef = useRef(onSticker);
    onStickerRef.current = onSticker;

    useEffect(() => {
        if (!active || !streamId) return;
        const supabase = createClient();
        const channel = supabase
            .channel(`stream-react:${streamId}`)
            .on('broadcast', { event: 'sticker' }, ({ payload }) => {
                const sticker = (payload as { sticker?: unknown } | null)?.sticker;
                if (isStickerKey(sticker)) onStickerRef.current(sticker);
            })
            .subscribe();
        return () => {
            void supabase.removeChannel(channel);
        };
    }, [streamId, active]);
}
