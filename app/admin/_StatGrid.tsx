'use client'

import { useState } from 'react'
import Link from 'next/link'

export type DeltaWindowKey = 'h24' | 'd7' | 'd30'
export type Deltas = Record<DeltaWindowKey, number>

export interface StatCardData {
    label: string
    value: string
    icon: string
    color: string
    sub?: string
    /** Growth in the metric's own unit, per window. */
    deltas: Deltas
    /** Prefix for the delta figure only, e.g. the baht sign on GMV. */
    deltaPrefix?: string
    /** The admin section that works this queue. Tiles without one (GMV,
     *  collections) have no page to open and stay plain. */
    href?: string
}

const WINDOWS: { key: DeltaWindowKey; label: string; since: string }[] = [
    { key: 'h24', label: '24H', since: 'the last 24 hours' },
    { key: 'd7', label: '7D', since: 'the last 7 days' },
    { key: 'd30', label: '30D', since: 'the last 30 days' },
]

/**
 * Stat tiles with a growth badge.
 *
 * The headline figure is always the running total and never reacts to the
 * window picker — the picker only changes the badge in each tile's corner,
 * which is how much of that total arrived inside the window. Client-side
 * because all three windows are computed server-side and shipped together, so
 * switching is instant and costs no round trip.
 */
export default function StatGrid({ cards }: { cards: StatCardData[] }) {
    const [range, setRange] = useState<DeltaWindowKey>('h24')
    const active = WINDOWS.find((w) => w.key === range) ?? WINDOWS[0]

    return (
        <>
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Admin Overview</h1>
                    <p className="text-slate-500 text-sm mt-1">Welcome to the Cardstreet Admin Console</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Growth</span>
                    <div className="flex rounded-full border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Growth window">
                        {WINDOWS.map((w) => (
                            <button
                                key={w.key}
                                type="button"
                                onClick={() => setRange(w.key)}
                                aria-pressed={w.key === range}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide transition-colors ${
                                    w.key === range
                                        ? 'bg-brand-cyan text-slate-950'
                                        : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                {w.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {cards.map((card) => {
                    const delta = card.deltas?.[range] ?? 0
                    const figure = `${card.deltaPrefix ?? ''}${Math.round(delta).toLocaleString()}`
                    const tileClass = `glass rounded-2xl p-5 border border-white/10 relative overflow-hidden group transition-all block ${
                        card.href ? 'hover:border-brand-cyan/40 hover:bg-white/[0.03] active:scale-[0.99]' : 'hover:border-white/20'
                    }`
                    const body = (
                        <>
                            <div className="absolute bottom-3 right-4 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
                                <i className={`${card.icon} text-3xl ${card.color}`} />
                            </div>
                            <div
                                title={`${delta > 0 ? '+' : ''}${figure} in ${active.since}`}
                                className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-black tabular-nums ${
                                    delta > 0 ? 'bg-brand-green/15 text-brand-green' : 'bg-white/5 text-slate-600'
                                }`}
                            >
                                {delta > 0 ? `+${figure}` : figure}
                            </div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 pr-14">{card.label}</p>
                            <p className={`text-3xl font-black ${card.color}`}>{card.value}</p>
                            {card.sub && (
                                <p className="text-[10px] text-slate-600 mt-1 font-semibold flex items-center gap-1.5">
                                    {card.sub}
                                    {card.href && (
                                        <i className="fa-solid fa-arrow-right text-[9px] group-hover:text-brand-cyan group-hover:translate-x-0.5 transition-all" />
                                    )}
                                </p>
                            )}
                        </>
                    )
                    // A tile with a destination is a real link, so middle-click,
                    // keyboard focus and the status-bar URL all work for free.
                    return card.href ? (
                        <Link key={card.label} href={card.href} className={tileClass}>
                            {body}
                        </Link>
                    ) : (
                        <div key={card.label} className={tileClass}>
                            {body}
                        </div>
                    )
                })}
            </div>
        </>
    )
}
