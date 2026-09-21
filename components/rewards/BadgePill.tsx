/**
 * Milestone and launch badge pill. Presentation-only like rankChip.tsx so the
 * server-rendered desktop seller page can use it. Each badge family carries
 * one icon and tint so a showcase row reads as a trophy case rather than a
 * list of grey tags. Labels come from the caller (t() on the client,
 * badgeLabel() on the server) so this file stays hook-free.
 */

import React from 'react';
import en from '@/lib/locales/en.json';
import th from '@/lib/locales/th.json';

interface BadgeVisual {
    /** Font Awesome 6 solid icon class (the sitewide icon set). */
    icon: string;
    className: string;
}

const FAMILIES: readonly [prefix: string, visual: BadgeVisual][] = [
    ['first_edition', { icon: 'fa-certificate', className: 'bg-amber-400/15 text-amber-200 border-amber-400/40' }],
    ['buyer_', { icon: 'fa-bag-shopping', className: 'bg-orange-400/15 text-orange-200 border-orange-400/30' }],
    ['seller_', { icon: 'fa-store', className: 'bg-cyan-400/15 text-cyan-200 border-cyan-400/30' }],
    ['reviews_', { icon: 'fa-star', className: 'bg-violet-400/15 text-violet-200 border-violet-400/30' }],
    ['vault_', { icon: 'fa-box-archive', className: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/30' }],
    ['chat_', { icon: 'fa-comments', className: 'bg-sky-400/15 text-sky-200 border-sky-400/30' }],
    ['streak_', { icon: 'fa-fire', className: 'bg-rose-400/15 text-rose-200 border-rose-400/30' }],
];

const DEFAULT_VISUAL: BadgeVisual = { icon: 'fa-medal', className: 'bg-white/5 text-slate-300 border-white/10' };

export function badgeVisual(badge: string): BadgeVisual {
    for (const [prefix, visual] of FAMILIES) {
        if (badge.startsWith(prefix)) return visual;
    }
    return DEFAULT_VISUAL;
}

/** Localized badge name for server components; falls back to the key. */
export function badgeLabel(badge: string, lang: 'EN' | 'TH'): string {
    const table = (lang === 'TH' ? th : en) as { rewards: { badge: Record<string, string> } };
    return table.rewards.badge[badge] ?? badge.replace(/_/g, ' ');
}

interface BadgePillProps {
    badge: string;
    label: string;
    /** 'sm' beside a rank chip; 'md' in the showcase picker. */
    size?: 'sm' | 'md';
    className?: string;
}

export default function BadgePill({ badge, label, size = 'sm', className = '' }: BadgePillProps) {
    const visual = badgeVisual(badge);
    const sizing = size === 'md'
        ? 'px-2.5 py-1 text-[10px] gap-1.5'
        : 'px-2 py-0.5 text-[9px] gap-1';
    return (
        <span
            className={`inline-flex items-center rounded-full border font-black uppercase tracking-wider whitespace-nowrap ${sizing} ${visual.className} ${className}`}
            title={label}
        >
            <i className={`fa-solid ${visual.icon} ${size === 'md' ? 'text-[10px]' : 'text-[8px]'}`} aria-hidden="true"></i>
            {label}
        </span>
    );
}
