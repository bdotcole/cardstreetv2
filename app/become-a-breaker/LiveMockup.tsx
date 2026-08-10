'use client';

import React from 'react';
import type { BreakerCopy } from './content';

/**
 * Cardstreet Live interface preview, drawn entirely in CSS.
 *
 * There is no shipped Live screenshot in the repo (the feature is beta-gated
 * behind 'live_broadcast' — see lib/betaFeatures.ts), and inventing product
 * imagery or borrowing card art we don't hold rights to are both off the table.
 * So this is a schematic of the real surface: broadcast frame, live badge with
 * viewer indicator, chat, and a purchase notification. The card shapes are
 * plain rounded rectangles in the brand gradient — a motif, not artwork.
 *
 * It is labelled "Interface preview" in the caption so nobody reads the numbers
 * in it as a claim about real audience size.
 *
 * Motion is restrained and every animation carries motion-reduce:animate-none,
 * so a visitor with prefers-reduced-motion sees the same composition, still.
 */
export default function LiveMockup({ copy }: { copy: BreakerCopy }) {
    const m = copy.mockup;

    return (
        <figure className="w-full max-w-[320px] mx-auto lg:mx-0">
            <div
                className="relative rounded-[1.75rem] border border-white/10 bg-slate-900/80 p-2.5 shadow-2xl shadow-black/40"
                // Decorative: the caption below carries the meaning, and every
                // string inside is illustrative rather than real data.
                aria-hidden="true"
            >
                <div className="relative overflow-hidden rounded-[1.25rem] bg-brand-darker">
                    {/* Broadcast frame */}
                    <div className="relative aspect-[3/4] bg-gradient-to-br from-slate-800 via-slate-900 to-brand-darker">
                        {/* Table-cam motif: sealed product and a fanned row of
                            cards, as geometry rather than imagery. */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="relative h-28 w-40">
                                <div className="absolute left-1/2 top-1 h-16 w-12 -translate-x-1/2 rounded-md bg-gradient-to-b from-brand-cyan/70 to-brand-cyan/20 shadow-lg" />
                                {[-24, -8, 8, 24].map((offset, i) => (
                                    <div
                                        key={offset}
                                        className="absolute bottom-0 h-14 w-10 rounded-md border border-white/10 bg-gradient-to-b from-slate-600/80 to-slate-800/80 shadow-md"
                                        style={{
                                            left: `calc(50% + ${offset}px)`,
                                            transform: `translateX(-50%) rotate(${(i - 1.5) * 6}deg)`,
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Soft vignette so the overlays stay legible */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />

                        {/* Live badge + viewer indicator */}
                        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
                            <span className="flex items-center gap-1.5 rounded-md bg-brand-red px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse motion-reduce:animate-none" />
                                {m.liveLabel}
                            </span>
                            <span className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold text-slate-200 backdrop-blur-sm">
                                <i className="fa-solid fa-eye text-[8px]" />
                                24 {m.viewersLabel}
                            </span>
                        </div>

                        {/* Purchase notification */}
                        <div className="absolute right-2.5 top-11 flex items-center gap-2 rounded-xl border border-brand-green/30 bg-brand-green/15 px-2.5 py-1.5 backdrop-blur-sm">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-green/25 text-brand-green">
                                <i className="fa-solid fa-check text-[9px]" />
                            </span>
                            <span className="leading-tight">
                                <span className="block text-[10px] font-black text-white">
                                    {m.purchaseToast.title}
                                </span>
                                <span className="block text-[9px] text-slate-300">
                                    {m.purchaseToast.detail}
                                </span>
                            </span>
                        </div>

                        {/* Title + chat */}
                        <div className="absolute inset-x-0 bottom-0 space-y-2 p-2.5">
                            <p className="text-[11px] font-bold leading-snug text-white">
                                {m.breakTitle}
                            </p>
                            <ul className="space-y-1">
                                {m.chat.map((line) => (
                                    <li key={line.user} className="text-[10px] leading-snug">
                                        <span className="font-black text-brand-cyan">{line.user}</span>
                                        <span className="text-slate-300"> {line.text}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                                <span className="h-1 flex-1 rounded-full bg-white/10" />
                                <i className="fa-solid fa-paper-plane text-[9px] text-slate-500" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <figcaption className="mt-3 text-center text-[11px] font-bold uppercase tracking-widest text-slate-400 lg:text-left">
                {copy.mockupCaption}
            </figcaption>
        </figure>
    );
}
