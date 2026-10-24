'use client';

import React from 'react';
import type { PackTier } from '@/lib/slabPacks/types';
import { TierEmblem, tierVars } from './ui';

/**
 * The foil pack, drawn entirely in CSS and SVG: no image assets, so a new
 * tier is a colour entry in lib/slabPacks/tiers.ts and nothing else.
 *
 * The silhouette is a clip-path with pinked (zigzag) ends and a tear notch
 * on each side, the way a real booster is cut. For the rip the same face is
 * rendered twice and clipped into the strip above the tear line and the body
 * below it, so the two pieces line up exactly until the strip comes away.
 */

/** Where the pack tears, as a share of its height. slabPacks.css uses the same 13%. */
export const TEAR_Y = 13;

const TEETH = 17;
const TOOTH = 1.5;
// The tear notches: how far they cut in, and how tall they are.
const NOTCH_IN = 2.2;
const NOTCH_H = 1.3;

function zigzag(yEdge: number, inward: number, leftToRight: boolean): string[] {
    const pts: string[] = [];
    for (let i = 0; i <= TEETH * 2; i++) {
        const x = (i / (TEETH * 2)) * 100;
        const y = i % 2 === 0 ? yEdge : yEdge + inward;
        pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
    }
    return leftToRight ? pts : pts.reverse();
}

// The tear itself, notch to notch: rough but shallow, since foil rips close
// to straight.
function tearEdge(leftToRight: boolean): string[] {
    const pts: string[] = [];
    const n = 11;
    for (let i = 0; i <= n; i++) {
        const x = NOTCH_IN + (i / n) * (100 - NOTCH_IN * 2);
        const jitter = i === 0 || i === n ? 0 : (i % 2 === 0 ? 0.45 : -0.4) + ((i * 37) % 5) * 0.07;
        pts.push(`${x.toFixed(2)}% ${(TEAR_Y + jitter).toFixed(2)}%`);
    }
    return leftToRight ? pts : pts.reverse();
}

const poly = (pts: string[]) => `polygon(${pts.join(', ')})`;
const pt = (x: number, y: number) => `${x}% ${y}%`;

export const PACK_CLIP = {
    whole: poly([
        ...zigzag(0, TOOTH, true),
        pt(100, TEAR_Y - NOTCH_H), pt(100 - NOTCH_IN, TEAR_Y), pt(100, TEAR_Y + NOTCH_H),
        ...zigzag(100, -TOOTH, false),
        pt(0, TEAR_Y + NOTCH_H), pt(NOTCH_IN, TEAR_Y), pt(0, TEAR_Y - NOTCH_H),
    ]),
    strip: poly([...zigzag(0, TOOTH, true), pt(100, TEAR_Y - NOTCH_H), ...tearEdge(false), pt(0, TEAR_Y - NOTCH_H)]),
    body: poly([...tearEdge(true), pt(100, TEAR_Y + NOTCH_H), ...zigzag(100, -TOOTH, false), pt(0, TEAR_Y + NOTCH_H)]),
};

/** The printed face of a pack. Fills its parent; clip it to taste. */
export function PackFace({ tier, subtitle }: { tier: PackTier; subtitle: string }) {
    // The name is set as large as its longest word allows, one word per
    // line, so "Gold" and "Galaxy Opal" both fill the pack edge to edge.
    const words = tier.name.split(' ');
    const longest = Math.max(...words.map((w) => w.length));
    const nameSize = Math.min(27, 74 / (longest * 0.62));
    return (
        <div className="sp-pack-face">
            <div className="sp-pack-grain" />
            <div className="sp-pack-material" />
            <div className="sp-pack-stars" />
            <div className="sp-pack-holo" />
            <div className="sp-pack-sparkle" />
            <div className="sp-pack-form" />
            <div className="sp-pack-crimp" data-edge="top" />
            <div className="sp-pack-crimp" data-edge="bottom" />
            <div className="sp-pack-art">
                <span className="sp-pack-mark">Cardstreet</span>
                <TierEmblem tier={tier.key} className="sp-pack-emblem" />
                <span className="sp-display sp-pack-name" style={{ fontSize: `${nameSize.toFixed(1)}cqw` }}>
                    {words.map((w) => (
                        <span key={w} className="block">{w}</span>
                    ))}
                </span>
                <span className="sp-pack-sub">{subtitle}</span>
            </div>
            <span className="sp-pack-micro">Authentic · Graded · Sealed</span>
            <div className="sp-pack-sheen" />
        </div>
    );
}

/** A whole, sealed pack. Width comes from the parent; height follows. */
export default function PackArt({
    tier, subtitle, className = '', style,
}: {
    tier: PackTier;
    subtitle: string;
    className?: string;
    style?: React.CSSProperties;
}) {
    return (
        <div className={`sp-pack ${className}`} data-tier={tier.key} data-material={tier.theme.material} style={{ ...tierVars(tier), ...style }}>
            <div className="sp-pack-piece" style={{ clipPath: PACK_CLIP.whole }}>
                <PackFace tier={tier} subtitle={subtitle} />
            </div>
        </div>
    );
}
