/**
 * Collector Pass rank chip — the rarity-band marker shown beside usernames in
 * live chat, on seller pages, and on the profile header. Deliberately
 * presentation-only (no hooks, no 'use client') so server components
 * (app/desktop/seller) can render it and routes could import the constants,
 * mirroring components/live/stickers.tsx. Inline two-tone SVGs, no emoji.
 *
 * Bands come from lib/rewardTiers.ts. The chip only appears from Uncommon
 * (level 4) up — Common stays blank on purpose: the empty slot is the
 * aspiration, and chat stays uncluttered for brand-new accounts.
 */

import React from 'react';
import { bandForLevel } from '@/lib/rewardTiers';

/** Ranks below this render no chip anywhere. */
export const MIN_CHIP_LEVEL = 4;

interface IconProps {
    className?: string;
}

/* One mark per rarity band, 24x24, saturated body + light accent. */

function UncommonIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#34d399" d="M12 2 22 12 12 22 2 12z" />
            <path fill="#d1fae5" d="M12 6.5 17.5 12 12 17.5 6.5 12z" />
        </svg>
    );
}

function RareIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#60a5fa" d="m12 2 2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.5 5.8 21l1.6-6.9L2 9.3l7.1-.7z" />
            <path fill="#dbeafe" d="m12 6.8 1.5 3.4 3.7.4-2.8 2.5.8 3.6L12 14.9l-3.2 1.8.8-3.6-2.8-2.5 3.7-.4z" />
        </svg>
    );
}

function DoubleRareIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#7c5cd6" d="m8.5 4 1.9 4.3 4.6.5-3.5 3.1 1 4.5-4-2.3-4 2.3 1-4.5L2 8.8l4.6-.5z" />
            <path fill="#c4b5fd" d="m16.5 9 1.6 3.6 3.9.4-2.9 2.6.8 3.8-3.4-1.9-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z" />
        </svg>
    );
}

function UltraRareIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#fb7185"
                d="M12 1.5 14 6l4.5-2-2 4.5 4.5 2-4.5 2 2 4.5-4.5-2-2 4.5-2-4.5-4.5 2 2-4.5-4.5-2 4.5-2-2-4.5 4.5 2z"
            />
            <circle cx="12" cy="10.5" r="3.4" fill="#ffe4e6" />
        </svg>
    );
}

function IllustrationRareIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2.5" fill="#f0b429" />
            <path fill="#fef3c7" d="M5.5 16.5 10 10l3 4 2-2.5 3.5 5z" />
            <circle cx="9" cy="8.5" r="1.6" fill="#fef3c7" />
        </svg>
    );
}

function SpecialIllustrationRareIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <rect x="2.5" y="5.5" width="16" height="14" rx="2.5" fill="#8b5cf6" />
            <rect x="5.5" y="3" width="16" height="14" rx="2.5" fill="#d946a8" />
            <path fill="#fce7f3" d="M8 13.5 12 8l3 3.8 1.8-2.2 3.2 4.4z" />
        </svg>
    );
}

function CrownRareIcon({ className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#eab308" d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 19H5z" />
            <path fill="#fef9c3" d="M12 9.4 9.6 13h4.8z" />
            <rect x="5" y="19" width="14" height="2.2" rx="1" fill="#eab308" />
        </svg>
    );
}

const BAND_ICONS: Record<string, React.ComponentType<IconProps>> = {
    u: UncommonIcon,
    r: RareIcon,
    rr: DoubleRareIcon,
    ur: UltraRareIcon,
    ir: IllustrationRareIcon,
    sar: SpecialIllustrationRareIcon,
    cr: CrownRareIcon,
};

interface RankChipProps {
    level: number;
    /** 'chat' = tiny inline chip beside a username; 'page' = larger pill with the band name. */
    variant?: 'chat' | 'page';
    /** Band name text for the page variant (caller passes the localized name). */
    label?: string;
    className?: string;
}

/**
 * Renders nothing below MIN_CHIP_LEVEL, so call sites can stay unconditional.
 */
export default function RankChip({ level, variant = 'chat', label, className = '' }: RankChipProps) {
    if (!Number.isFinite(level) || level < MIN_CHIP_LEVEL) return null;
    const band = bandForLevel(level);
    const Icon = BAND_ICONS[band.key];
    if (!Icon) return null;

    if (variant === 'page') {
        return (
            <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${band.chipClass} ${className}`}
                title={label || band.name}
            >
                <Icon className="w-3 h-3" />
                {label || band.name}
                <span className="opacity-70">Lv {level}</span>
            </span>
        );
    }

    return (
        <span
            className={`inline-flex items-center gap-0.5 rounded px-1 py-px align-middle text-[9px] font-black ${band.chipClass} ${className}`}
            title={`${band.name} · Lv ${level}`}
        >
            <Icon className="w-2.5 h-2.5" />
            {level}
        </span>
    );
}
