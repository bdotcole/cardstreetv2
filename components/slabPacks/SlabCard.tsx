'use client';

import React from 'react';
import { motion, type Transition } from 'framer-motion';
import { PsaLogo } from '@/components/graderLogos';
import { gradeDescriptor, slabImage } from '@/lib/slabPacks/pool';
import type { PackTier, Slab } from '@/lib/slabPacks/types';
import { FanMark, tierVars, useTilt } from './ui';

/**
 * A graded slab as an object, not a picture of one: a clear case with real
 * thickness, the grader's label, the card behind the window, and a mystery
 * back for the moments before it is revealed.
 *
 * The slab is its own container (sizes inside are in cqw), so the same
 * component renders the 60px chase thumbnail and the full-screen reveal.
 * `flipDeg` turns it about its vertical axis: 180 is face-down, 0 or 360 is
 * face-up. `tilt` lets a finger or a mouse lean it, which slides the glare
 * across the acrylic and the foil across the card.
 *
 * The label follows PSA's own layout and carries its wordmark, used
 * nominatively as on the marketplace's slab frames (components/graderLogos).
 */

interface SlabCardProps {
    slab: Slab;
    tier: PackTier;
    /** Which mirrored art to load: `small` for grids, `large` for the hero. */
    art?: 'small' | 'large';
    flipDeg?: number;
    flipTransition?: Transition;
    tilt?: boolean;
    /** 0..1 strength of the foil flash on the card. */
    foil?: number;
    /** Leave the 3D edge out for small, static renders. */
    flat?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

export default function SlabCard({
    slab, tier, art = 'large', flipDeg = 0, flipTransition, tilt = false, foil = 0.4, flat = false, className = '', style,
}: SlabCardProps) {
    const tiltRef = useTilt<HTMLDivElement>(tilt);
    // 180 (mod 360) is face-down. The hidden side stays out of the
    // accessibility tree so a screen reader cannot read the pull early.
    const faceDown = Math.abs(((flipDeg % 360) + 360) % 360 - 180) < 1;

    return (
        <div className={`sp-slab ${className}`} style={{ ...tierVars(tier), ...style }}>
            {/* Perspective lives on a child so its cqw resolves against the slab. */}
            <div className="absolute inset-0" style={{ perspective: '300cqw' }}>
                <motion.div
                    className="sp-slab-3d"
                    initial={false}
                    animate={{ rotateY: flipDeg }}
                    transition={flipTransition ?? { duration: 0 }}
                >
                    <div ref={tiltRef} className="sp-slab-3d" style={{ touchAction: tilt ? 'none' : undefined }}>
                        {!flat && (
                            <>
                                <div className="sp-slab-edge" style={{ transform: 'translateZ(0.9cqw)' }} />
                                <div className="sp-slab-edge" />
                                <div className="sp-slab-edge" style={{ transform: 'translateZ(-0.9cqw)' }} />
                            </>
                        )}

                        <div className="sp-slab-face sp-slab-front" aria-hidden={faceDown}>
                            <div className="sp-case" />
                            <div className="sp-slab-label">
                                <div className="sp-slab-label-stripe" />
                                <div className="sp-slab-label-text">
                                    <span>
                                        {slab.year > 0 ? `${slab.year} ` : ''}POKEMON{slab.lang === 'JP' ? ' JAPANESE' : ''}
                                    </span>
                                    <span className="sp-slab-label-name">{slab.name}</span>
                                    <span>
                                        {slab.setName} · #{slab.number}
                                    </span>
                                </div>
                                <div className="sp-slab-label-grade">
                                    <PsaLogo className="sp-slab-logo" />
                                    <span className="sp-slab-label-desc">{gradeDescriptor(slab.grade)}</span>
                                    <span className="sp-slab-label-num">{slab.grade}</span>
                                </div>
                            </div>
                            <div className="sp-slab-window">
                                <div className="sp-slab-card">
                                    {/* Card art is served straight from our own bucket (see lib/imageUtils). */}
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={slabImage(slab, art)} alt={slab.name} draggable={false} decoding="async" />
                                    <div className="sp-slab-foil" style={{ '--sp-foil': foil } as React.CSSProperties} />
                                </div>
                            </div>
                            <div className="sp-slab-streak" />
                            <div className="sp-slab-glare" />
                        </div>

                        <div className="sp-slab-face sp-slab-back" aria-hidden={!faceDown}>
                            <div className="sp-back">
                                <div className="sp-back-weave" />
                                <div className="sp-back-holo" />
                                <div className="sp-back-mark">
                                    <FanMark className="w-[26cqw] text-white/70" />
                                    <span className="sp-display sp-back-q">?</span>
                                    <span className="sp-back-word">CARDSTREET</span>
                                </div>
                            </div>
                            <div className="sp-slab-glare" />
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
