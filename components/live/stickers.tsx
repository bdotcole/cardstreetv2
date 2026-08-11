/**
 * The fixed sticker-reaction set for live shows: 6 inline two-tone SVGs
 * tuned for the dark live UI. No emoji characters anywhere — reactions render
 * identically on every platform and stay on-brand.
 *
 * This module is deliberately presentation-only (no hooks, no 'use client')
 * so the /api/live/streams/[id]/react route can import STICKER_KEYS for
 * validation without dragging client-side code into the server bundle. The
 * float layer + tray live in components/live/StickerReactions.tsx.
 */

import React from 'react';

export const STICKER_KEYS = [
    'fire',
    'heart',
    'lightning',
    'star',
    'moneybag',
    'trophy',
] as const;

export type StickerKey = (typeof STICKER_KEYS)[number];

export function isStickerKey(value: unknown): value is StickerKey {
    return typeof value === 'string' && (STICKER_KEYS as readonly string[]).includes(value);
}

interface SvgProps {
    className?: string;
}

/* Each sticker is a 24x24 two-tone mark: a saturated body + a lighter inner
   accent, both explicit hexes (they float over video, where theme variables
   would be invisible noise anyway). */

function FireSticker({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#f97316"
                d="M12 2c.5 3.2-.8 4.9-2.4 6.5C7.9 10.2 6 12 6 15a6 6 0 0 0 12 0c0-2.3-1-4.1-2.2-5.8C14.4 7.2 13 5.2 12 2z"
            />
            <path
                fill="#fde68a"
                d="M12 10.5c.3 1.6-.4 2.5-1.2 3.4-.7.8-1.5 1.6-1.5 3a2.7 2.7 0 1 0 5.4 0c0-1.1-.5-2-1.1-2.9-.6-1-1.3-2-1.6-3.5z"
            />
        </svg>
    );
}

function HeartSticker({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#f43f5e"
                d="M12 21s-7.5-4.6-9.7-9A5.6 5.6 0 0 1 12 6.2 5.6 5.6 0 0 1 21.7 12c-2.2 4.4-9.7 9-9.7 9z"
            />
            <path
                fill="#fecdd3"
                d="M8.4 7.4c-1.3.3-2.3 1.4-2.5 2.7-.1.5.3.9.8.8.4-.1.6-.5.7-.9.2-.7.7-1.3 1.4-1.6.4-.2.6-.6.4-1-.2-.3-.5-.4-.8-.3z"
            />
        </svg>
    );
}

function LightningSticker({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#facc15" d="M13.5 2 5 13.5h5L10.5 22 19 10.5h-5L13.5 2z" />
            <path fill="#fef9c3" d="M12.6 5.4 8.3 11.2h3.1l-.4 4.2 4.3-5.9h-3.1l.4-4.1z" />
        </svg>
    );
}

function StarSticker({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#06b6d4"
                d="M12 2.5 14.9 8.6l6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8L12 2.5z"
            />
            <path
                fill="#cffafe"
                d="M12 6.8l1.6 3.4 3.6.4-2.7 2.5.7 3.6L12 15l-3.2 1.7.7-3.6-2.7-2.5 3.6-.4L12 6.8z"
            />
        </svg>
    );
}

function MoneybagSticker({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#84cc16"
                d="M9 3h6l-1.6 3.2c3.9 1.3 6.6 4.8 6.6 8.8 0 3.9-3.6 6.5-8 6.5s-8-2.6-8-6.5c0-4 2.7-7.5 6.6-8.8L9 3z"
            />
            <path
                fill="#ecfccb"
                d="M12.9 9.5h-2.1a2.2 2.2 0 0 0 0 4.4h2.4a.9.9 0 0 1 0 1.8h-3.9v1.8h1.8V19h1.8v-1.5h.3a2.7 2.7 0 0 0 0-5.4h-2.4a.4.4 0 0 1 0-.8h3.9V9.5h-1.8z"
            />
        </svg>
    );
}

function TrophySticker({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#f59e0b"
                d="M7 3h10v2h4v2.5A4.5 4.5 0 0 1 16.7 12 5.5 5.5 0 0 1 13 14.9V17h3v2.5l1 2.5H7l1-2.5V17h3v-2.1A5.5 5.5 0 0 1 7.3 12 4.5 4.5 0 0 1 3 7.5V5h4V3zm-2 4v.5A2.5 2.5 0 0 0 7 9.9V7H5zm14 0h-2v2.9a2.5 2.5 0 0 0 2-2.4V7z"
            />
            <path fill="#fef3c7" d="m12 5.5 1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3L8.7 7.9l2.3-.3 1-2.1z" />
        </svg>
    );
}

const STICKER_SVGS: Record<StickerKey, React.FC<SvgProps>> = {
    fire: FireSticker,
    heart: HeartSticker,
    lightning: LightningSticker,
    star: StarSticker,
    moneybag: MoneybagSticker,
    trophy: TrophySticker,
};

export function StickerIcon({ sticker, className }: { sticker: StickerKey; className?: string }) {
    const Svg = STICKER_SVGS[sticker];
    return <Svg className={className} />;
}
