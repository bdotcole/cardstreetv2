'use client';

/**
 * The room's big moments, said with pixels: a SOLD hammer, a spot purchase,
 * a "now opening" call-out. One splash at a time, springs in over the video,
 * auto-dismisses. Both the viewer and the console mount it — the field test
 * showed a chat line alone is invisible while everyone watches the cards.
 *
 * Pure presentation: pages own the state via useEventSplash and feed it from
 * stream events; this renders whatever is current. Inline SVG icons via the
 * sticker set (no emoji, repo convention).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { StickerIcon } from '@/components/live/stickers';

const SPLASH_MS = 4000;

export type SplashKind = 'auction_sold' | 'spot_sold' | 'now_opening';

export interface SplashState {
    key: number;
    kind: SplashKind;
    title: string;
    subtitle?: string;
}

const SPLASH_STYLE: Record<
    SplashKind,
    { sticker: 'trophy' | 'moneybag' | 'fire'; ring: string; text: string }
> = {
    auction_sold: {
        sticker: 'trophy',
        ring: 'border-amber-400/60 bg-amber-500/15',
        text: 'text-amber-300',
    },
    spot_sold: {
        sticker: 'moneybag',
        ring: 'border-emerald-400/60 bg-emerald-500/15',
        text: 'text-emerald-300',
    },
    now_opening: {
        sticker: 'fire',
        ring: 'border-brand-cyan/60 bg-brand-cyan/15',
        text: 'text-brand-cyan',
    },
};

export function useEventSplash(): {
    splash: SplashState | null;
    showSplash: (kind: SplashKind, title: string, subtitle?: string) => void;
} {
    const [splash, setSplash] = useState<SplashState | null>(null);

    const showSplash = useCallback((kind: SplashKind, title: string, subtitle?: string) => {
        setSplash({ key: Date.now(), kind, title, subtitle });
    }, []);

    useEffect(() => {
        if (!splash) return;
        const timer = setTimeout(() => {
            setSplash((prev) => (prev?.key === splash.key ? null : prev));
        }, SPLASH_MS);
        return () => clearTimeout(timer);
    }, [splash]);

    return { splash, showSplash };
}

/** Absolutely centered over its (position:relative) parent; pointer-through. */
export function EventSplashLayer({ splash }: { splash: SplashState | null }) {
    return (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center px-6">
            <AnimatePresence>
                {splash && (
                    <motion.div
                        key={splash.key}
                        initial={{ opacity: 0, scale: 0.6, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -16 }}
                        transition={{ type: 'spring', damping: 18, stiffness: 320 }}
                        className={`max-w-full rounded-3xl border-2 backdrop-blur-md px-6 py-4 text-center shadow-[0_8px_40px_rgba(0,0,0,0.55)] bg-black/70 ${SPLASH_STYLE[splash.kind].ring}`}
                    >
                        <motion.div
                            initial={{ rotate: -12, scale: 0.6 }}
                            animate={{ rotate: 0, scale: [0.6, 1.25, 1] }}
                            transition={{ duration: 0.5 }}
                            className="mx-auto w-12 h-12"
                        >
                            <StickerIcon
                                sticker={SPLASH_STYLE[splash.kind].sticker}
                                className="w-full h-full drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
                            />
                        </motion.div>
                        <p
                            className={`mt-1.5 text-xl font-black uppercase tracking-wide leading-tight break-words ${SPLASH_STYLE[splash.kind].text}`}
                        >
                            {splash.title}
                        </p>
                        {splash.subtitle && (
                            <p className="mt-0.5 text-sm font-bold text-white break-words">
                                {splash.subtitle}
                            </p>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
