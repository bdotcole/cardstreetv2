/**
 * Collector Pass profile frame — the ring a redeemed frame paints around an
 * avatar. Presentation-only (no hooks, no 'use client') so the server-rendered
 * desktop seller page and both client shells share one renderer, mirroring
 * components/rewards/rankChip.tsx.
 *
 * The ring is its OWN element behind the photo: the higher tiers rotate a
 * conic gradient, and rotating a wrapper would spin the face inside it. The
 * inner disc is inset by the ring width and carries a page-colour gap so the
 * art reads as a frame, not a tinted edge.
 */

import React from 'react';
import { FRAME_STYLES } from '@/lib/rewardTiers';

interface AvatarFrameProps {
    /** Equipped frame key (lib/rewardTiers FRAME_STYLES); null or unknown = no frame. */
    frame?: string | null;
    /** Outer diameter in px, ring included. */
    size: number;
    /** Ring width override in px (defaults to the frame's own width). */
    ringWidth?: number;
    /** Gap between ring and photo in px, painted in the page colour. */
    gap?: number;
    /** Ring classes to paint when NO frame is equipped (a surface's default ring). */
    fallbackRing?: string;
    /** Drop the glow on dense surfaces such as the nav bar. */
    noGlow?: boolean;
    className?: string;
    /** Avatar content: an <img class="w-full h-full object-cover"> or initials. */
    children: React.ReactNode;
}

export default function AvatarFrame({
    frame,
    size,
    ringWidth,
    gap = 2,
    fallbackRing,
    noGlow = false,
    className = '',
    children,
}: AvatarFrameProps) {
    const style = frame ? FRAME_STYLES[frame] : undefined;
    const ring = style ? style.ring : fallbackRing;
    const width = ring ? (ringWidth ?? style?.width ?? 3) : 0;
    const glow = style && !noGlow ? (style.glow ?? '') : '';
    const spin = style?.spin ? 'animate-frame-spin motion-reduce:animate-none' : '';

    return (
        <span
            className={`relative inline-block shrink-0 rounded-full align-middle ${className}`}
            style={{ width: size, height: size }}
        >
            {ring && (
                <span aria-hidden="true" className={`absolute inset-0 rounded-full ${ring} ${glow} ${spin}`} />
            )}
            <span
                className={`absolute rounded-full overflow-hidden bg-slate-700 flex items-center justify-center ${
                    ring ? 'border-brand-darker' : ''
                }`}
                style={{ inset: width, borderWidth: ring ? gap : 0 }}
            >
                {children}
            </span>
        </span>
    );
}
