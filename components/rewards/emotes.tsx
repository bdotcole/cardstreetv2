/**
 * Collector Pass chat emotes — level-gated packs of inline two-tone SVGs sent
 * as `:key:` tokens through the live-chat route and expanded to images in both
 * chat renderers.
 *
 * Presentation-only module (no hooks, no 'use client') so the chat route can
 * import the keys + level gates for server-side validation without dragging
 * client code into the bundle — the components/live/stickers.tsx precedent.
 * No emoji characters anywhere (repo convention); no third-party IP — all
 * marks are generic TCG-culture tropes.
 *
 * Pack min-levels mirror the band unlocks in lib/rewardTiers.ts. Tokens must
 * fit the stream_chat_messages.body 300-char DB CHECK — they ride inside the
 * body as plain text, so an old client that predates this module simply shows
 * `:gg:` as text and nothing breaks.
 */

import React from 'react';

export interface EmotePack {
    key: string;
    /** Collector level required to SEND this pack's emotes. */
    minLevel: number;
    emotes: readonly string[];
}

export const EMOTE_PACKS: readonly EmotePack[] = [
    { key: 'starter', minLevel: 2, emotes: ['gg', 'hype', 'whiff', 'gl'] },
    { key: 'trainer', minLevel: 4, emotes: ['energy', 'potion', 'coinflip', 'sleeve'] },
    { key: 'pullrites', minLevel: 7, emotes: ['holo', 'moneyrain', 'grail', 'mailday'] },
    { key: 'breaker', minLevel: 10, emotes: ['hammer', 'rip', 'toploader', 'mint10'] },
    { key: 'legend', minLevel: 13, emotes: ['crown', 'rainbow', 'peak', 'diamond'] },
];

const MIN_LEVEL_BY_KEY: Record<string, number> = {};
for (const pack of EMOTE_PACKS) for (const k of pack.emotes) MIN_LEVEL_BY_KEY[k] = pack.minLevel;

export function isEmoteKey(value: unknown): value is string {
    return typeof value === 'string' && value in MIN_LEVEL_BY_KEY;
}

/** Level required to send an emote key (Infinity for unknown keys). */
export function emoteMinLevel(key: string): number {
    return MIN_LEVEL_BY_KEY[key] ?? Infinity;
}

// Matches candidate tokens; only KNOWN keys are treated as emotes — anything
// else (`:)`, `:custom:`) stays plain text.
const TOKEN_RE = /:([a-z0-9_]{2,20}):/g;

/** Distinct known emote keys present in a chat body. */
export function extractEmoteKeys(body: string): string[] {
    const found = new Set<string>();
    for (const m of body.matchAll(TOKEN_RE)) {
        if (isEmoteKey(m[1])) found.add(m[1]);
    }
    return [...found];
}

export type ChatBodyPart = { type: 'text'; value: string } | { type: 'emote'; value: string };

/** Split a chat body into text runs and known emote tokens. */
export function splitChatBody(body: string): ChatBodyPart[] {
    const parts: ChatBodyPart[] = [];
    let last = 0;
    for (const m of body.matchAll(TOKEN_RE)) {
        if (!isEmoteKey(m[1])) continue;
        const idx = m.index ?? 0;
        if (idx > last) parts.push({ type: 'text', value: body.slice(last, idx) });
        parts.push({ type: 'emote', value: m[1] });
        last = idx + m[0].length;
    }
    if (last < body.length) parts.push({ type: 'text', value: body.slice(last) });
    return parts.length > 0 ? parts : [{ type: 'text', value: body }];
}

interface SvgProps {
    className?: string;
}

/* ── Starter (L2) ─────────────────────────────────────────────────────── */

function GgEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#38bdf8" d="M3 4h18v12H9l-4 4v-4H3z" />
            <text x="12" y="13.5" textAnchor="middle" fontSize="8" fontWeight="900" fill="#0b1220" fontFamily="Arial, sans-serif">GG</text>
        </svg>
    );
}

function HypeEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#f97316" d="m12 1 2.2 5.4L20 4l-2.6 5.2L23 12l-5.6 2.8L20 20l-5.8-2.4L12 23l-2.2-5.4L4 20l2.6-5.2L1 12l5.6-2.8L4 4l5.8 2.4z" />
            <circle cx="12" cy="12" r="3.6" fill="#ffedd5" />
        </svg>
    );
}

function WhiffEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#94a3b8" d="M7 5a5 5 0 0 1 9.6 1.4A4 4 0 0 1 17 14H6a4 4 0 0 1-.8-7.9A5 5 0 0 1 7 5z" />
            <path fill="none" d="M11 16.5 9 21m5-4.5L12.5 20m4-3.5L15.5 19" stroke="#cbd5e1" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

function GlEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#22c55e" d="M12 12c-1-3.4-3.7-5-6.5-4.4C5.2 10.9 7 13.4 10.4 13c-3 .8-4 3.3-3.2 6 2.9.3 4.8-1.7 4.8-4.6 0 2.9 1.9 4.9 4.8 4.6.8-2.7-.2-5.2-3.2-6 3.4.4 5.2-2.1 4.9-5.4C15.7 7 13 8.6 12 12z" />
            <circle cx="12" cy="12.6" r="1.8" fill="#bbf7d0" />
        </svg>
    );
}

/* ── Trainer (L4) ─────────────────────────────────────────────────────── */

function EnergyEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="#facc15" />
            <path fill="#713f12" d="M13.2 4.5 6.5 13.5h4.2l-.9 6 6.7-9h-4.2z" />
        </svg>
    );
}

function PotionEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#a78bfa" d="M9 2h6v3l-1 1v3.2c2.4 1.2 4 3.7 4 6.3a7 7 0 0 1-14 0c0-2.6 1.6-5.1 4-6.3V6L9 5z" />
            <path fill="#ede9fe" d="M8 14.5a4.5 4.5 0 0 0 8.6 1.8c-2.9 1.3-6-.3-8.6-1.8z" />
        </svg>
    );
}

function CoinflipEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <ellipse cx="12" cy="13" rx="9" ry="8" fill="#f59e0b" />
            <ellipse cx="12" cy="11.6" rx="9" ry="8" fill="#fbbf24" />
            <path fill="#fef3c7" d="m12 6.8 1.4 3 3.3.4-2.4 2.2.6 3.2-2.9-1.6-2.9 1.6.6-3.2-2.4-2.2 3.3-.4z" />
        </svg>
    );
}

function SleeveEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <rect x="4" y="2.5" width="16" height="19" rx="2" fill="#0ea5e9" />
            <rect x="6.5" y="5" width="11" height="14" rx="1.2" fill="#e0f2fe" />
            <path fill="#0ea5e9" d="M8 15.5 11 11l2 2.6 1.4-1.6 2.1 3.5z" />
        </svg>
    );
}

/* ── Pull Rites (L7) ──────────────────────────────────────────────────── */

function HoloEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#e879f9" d="M12 2c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z" />
            <path fill="#f0abfc" d="M18.5 14c.3 2.2 1.3 3.2 3.5 3.5-2.2.3-3.2 1.3-3.5 3.5-.3-2.2-1.3-3.2-3.5-3.5 2.2-.3 3.2-1.3 3.5-3.5zM5 15c.25 1.8 1.05 2.6 2.9 2.9-1.85.25-2.65 1.05-2.9 2.9-.25-1.85-1.05-2.65-2.9-2.9 1.85-.3 2.65-1.1 2.9-2.9z" />
        </svg>
    );
}

function MoneyrainEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <rect x="3" y="7" width="18" height="10" rx="1.6" fill="#4ade80" />
            <circle cx="12" cy="12" r="3" fill="#dcfce7" />
            <path stroke="#86efac" strokeWidth="1.6" strokeLinecap="round" d="M5 20.5h2m4 0h2m4 0h2" />
        </svg>
    );
}

function GrailEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#fbbf24" d="M5 3h14v3a7 7 0 0 1-5.3 6.8V17H17a1.5 1.5 0 0 1 0 3H7a1.5 1.5 0 0 1 0-3h3.3v-4.2A7 7 0 0 1 5 6z" />
            <path fill="#fef3c7" d="M8 5.5h3v2.8a3.5 3.5 0 0 1-3-3z" />
        </svg>
    );
}

function MaildayEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#d97706" d="M3 8.5 12 4l9 4.5V19H3z" />
            <path fill="#fbbf24" d="M3 8.5h18L12 13z" />
            <rect x="10.6" y="4.7" width="2.8" height="8" fill="#fef3c7" />
        </svg>
    );
}

/* ── Breaker (L10) ────────────────────────────────────────────────────── */

function HammerEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <rect x="4" y="3" width="14" height="6.5" rx="1.6" fill="#f87171" />
            <rect x="10" y="9.5" width="3.4" height="11" rx="1.4" fill="#fca5a5" />
        </svg>
    );
}

function RipEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#38bdf8" d="M5 4h8l-1.4 2.6L14 8.8l-1.6 2L14 13H5z" />
            <path fill="#0369a1" d="M14.6 4H19v9h-5.5l1.4-2.2-1.5-2.1 1.6-2.2z" />
            <path fill="#bae6fd" d="M5 14.5h14V20H5z" />
        </svg>
    );
}

function ToploaderEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <rect x="4.5" y="2.5" width="15" height="19" rx="1.6" fill="none" stroke="#93c5fd" strokeWidth="1.8" />
            <rect x="7.5" y="5.5" width="9" height="13" rx="1" fill="#1d4ed8" />
            <circle cx="12" cy="10.5" r="2.2" fill="#bfdbfe" />
        </svg>
    );
}

function Mint10Emote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <circle cx="12" cy="12" r="10" fill="#10b981" />
            <circle cx="12" cy="12" r="7.4" fill="#065f46" />
            <text x="12" y="15.2" textAnchor="middle" fontSize="8.5" fontWeight="900" fill="#d1fae5" fontFamily="Arial, sans-serif">10</text>
        </svg>
    );
}

/* ── Legend (L13) ─────────────────────────────────────────────────────── */

function CrownEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#eab308" d="M3 7.5 7.8 11 12 4.5 16.2 11 21 7.5 19.2 18H4.8z" />
            <rect x="4.8" y="18" width="14.4" height="2.4" rx="1" fill="#facc15" />
            <circle cx="12" cy="13" r="1.7" fill="#fef9c3" />
        </svg>
    );
}

function RainbowEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#ef4444" d="M2 19a10 10 0 0 1 20 0h-3a7 7 0 0 0-14 0z" />
            <path fill="#facc15" d="M5.6 19a6.4 6.4 0 0 1 12.8 0h-2.6a3.8 3.8 0 0 0-7.6 0z" />
            <path fill="#38bdf8" d="M8.8 19a3.2 3.2 0 0 1 6.4 0z" />
        </svg>
    );
}

function PeakEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#64748b" d="m3 20 7-13 4 7.4L16.5 11 21 20z" />
            <path fill="#e2e8f0" d="m10 7 1.7 3.2L10 12l-1.8-1.8z" />
            <path fill="#f43f5e" d="M10 3.5v3.6l3-1.8z" />
        </svg>
    );
}

function DiamondEmote({ className }: SvgProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path fill="#22d3ee" d="M7 4h10l4 6-9 11L3 10z" />
            <path fill="#cffafe" d="M9.5 10 12 5.5l2.5 4.5L12 16z" />
        </svg>
    );
}

const EMOTE_ICONS: Record<string, React.ComponentType<SvgProps>> = {
    gg: GgEmote, hype: HypeEmote, whiff: WhiffEmote, gl: GlEmote,
    energy: EnergyEmote, potion: PotionEmote, coinflip: CoinflipEmote, sleeve: SleeveEmote,
    holo: HoloEmote, moneyrain: MoneyrainEmote, grail: GrailEmote, mailday: MaildayEmote,
    hammer: HammerEmote, rip: RipEmote, toploader: ToploaderEmote, mint10: Mint10Emote,
    crown: CrownEmote, rainbow: RainbowEmote, peak: PeakEmote, diamond: DiamondEmote,
};

export function EmoteIcon({ emote, className }: { emote: string; className?: string }) {
    const Icon = EMOTE_ICONS[emote];
    if (!Icon) return null;
    return <Icon className={className} />;
}

/**
 * A chat body with `:emote:` tokens expanded inline. Unknown tokens render as
 * the literal text they are.
 */
export function ChatBody({ body }: { body: string }) {
    const parts = splitChatBody(body);
    return (
        <>
            {parts.map((p, i) =>
                p.type === 'emote' ? (
                    <EmoteIcon
                        key={i}
                        emote={p.value}
                        className="inline-block w-[18px] h-[18px] align-[-4px] mx-px"
                    />
                ) : (
                    <React.Fragment key={i}>{p.value}</React.Fragment>
                ),
            )}
        </>
    );
}
