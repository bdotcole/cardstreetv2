'use client'

import { Fragment, useEffect, useState } from 'react'
import {
    BarChart, Bar, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from 'recharts'

interface ReferredAccount {
    id: string
    display_name: string | null
    created_at: string | null
    stripe_region: string | null
}

interface Breakdown {
    clicks: number
    installs: number
    storeVisits: number
    signups: number
    attributedAccounts: ReferredAccount[]
    suspectedTestEvents: number
}

interface PartnerRow {
    id: string
    display_name: string | null
    total_downloads: number
    partner_level: number | null
    partner_fee: number | null
    partner_joined_at: string | null
    breakdown?: Breakdown
}

interface EventTotals { clicks: number; installs: number; storeVisits: number; signups: number }

interface DailyEntry { date: string; downloads: number }

const TIER_INFO: Record<number, { name: string; emoji: string; color: string }> = {
    1: { name: 'Bronze Rare', emoji: '🟤', color: '#d97706' },
    2: { name: 'Silver Rare', emoji: '⚪', color: '#94a3b8' },
    3: { name: 'Gold Rare', emoji: '🟡', color: '#eab308' },
    4: { name: 'Platinum Rare', emoji: '🔷', color: '#e2e8f0' },
    5: { name: 'Sapphire Rare', emoji: '💎', color: '#60a5fa' },
    6: { name: 'Ruby Rare', emoji: '🔴', color: '#f87171' },
    7: { name: 'Emerald Rare', emoji: '🟢', color: '#4ade80' },
    8: { name: 'Diamond Rare', emoji: '💠', color: '#06b6d4' },
    9: { name: 'Black Opal Rare', emoji: '🌌', color: '#a78bfa' },
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
        <div className="bg-brand-darker border border-white/10 rounded-xl px-4 py-3 shadow-xl">
            <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">{label}</p>
            <p className="text-lg font-black text-brand-cyan">{payload[0].value.toLocaleString()}</p>
        </div>
    )
}

export default function DownloadsPage() {
    const [topPartners, setTopPartners] = useState<PartnerRow[]>([])
    const [allPartners, setAllPartners] = useState<PartnerRow[]>([])
    const [dailyDownloads, setDailyDownloads] = useState<DailyEntry[]>([])
    const [eventTotals, setEventTotals] = useState<EventTotals>({ clicks: 0, installs: 0, storeVisits: 0, signups: 0 })
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch('/api/admin/downloads')
            .then(r => r.json())
            .then(data => {
                setTopPartners(data.topPartners ?? [])
                setAllPartners(data.allPartners ?? [])
                setDailyDownloads(data.dailyDownloads ?? [])
                if (data.eventTotals) setEventTotals(data.eventTotals)
            })
            .finally(() => setLoading(false))
    }, [])

    const toggle = (id: string) => setExpanded(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
    })

    const totalDownloads = allPartners.reduce((s, p) => s + (p.total_downloads ?? 0), 0)
    const totalAttributedAccounts = allPartners.reduce((s, p) => s + (p.breakdown?.attributedAccounts.length ?? 0), 0)

    const barData = topPartners.map(p => ({
        name: (p.display_name ?? 'Unknown').split(' ')[0],
        downloads: p.total_downloads ?? 0,
        level: p.partner_level ?? 1,
    }))

    const lineData = dailyDownloads.map(d => ({
        date: d.date.slice(5), // MM-DD
        downloads: d.downloads,
    }))

    if (loading) return (
        <div className="flex items-center justify-center h-64">
            <div className="animate-spin h-10 w-10 border-2 border-white/10 border-t-brand-cyan rounded-full" />
        </div>
    )

    return (
        <div className="space-y-8 animate-fadeIn">
            <div>
                <h1 className="text-xl font-black text-white italic">Download Analytics</h1>
                <p className="text-slate-500 text-sm">{totalDownloads.toLocaleString()} total downloads across {allPartners.length} partners</p>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Total Partners', value: allPartners.length, color: 'text-yellow-400' },
                    { label: 'Total Downloads', value: totalDownloads.toLocaleString(), color: 'text-brand-green' },
                    { label: 'Last 30 Days', value: dailyDownloads.reduce((s, d) => s + d.downloads, 0).toLocaleString(), color: 'text-brand-cyan' },
                    { label: 'Attributed Accounts', value: totalAttributedAccounts.toLocaleString(), color: 'text-blue-400' },
                ].map(card => (
                    <div key={card.label} className="glass rounded-2xl p-4 border border-white/10">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{card.label}</p>
                        <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
                    </div>
                ))}
            </div>

            {/* Signal-quality breakdown — the blended "downloads" number split by
                how confident each signal is. Confirmed installs are strongest;
                iOS store visits are intent (a tap to the App Store, not a proven
                install); attributed signups are the accounts we actually linked. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Confirmed Installs', sub: 'Android · Play referrer', value: eventTotals.installs, color: 'text-brand-green' },
                    { label: 'iOS Store Visits', sub: 'Intent, not confirmed', value: eventTotals.storeVisits, color: 'text-amber-400' },
                    { label: 'Attributed Signups', sub: 'Linked to an account', value: eventTotals.signups, color: 'text-brand-cyan' },
                    { label: 'Link Clicks', sub: 'Analytics — not counted', value: eventTotals.clicks, color: 'text-slate-400' },
                ].map(card => (
                    <div key={card.label} className="glass rounded-2xl p-4 border border-white/10">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{card.label}</p>
                        <p className={`text-2xl font-black ${card.color}`}>{card.value.toLocaleString()}</p>
                        <p className="text-[10px] text-slate-600 mt-0.5">{card.sub}</p>
                    </div>
                ))}
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Bar Chart – Top Partners */}
                <div className="glass rounded-2xl border border-white/10 p-6">
                    <h2 className="text-sm font-black text-white uppercase tracking-wide italic mb-6">Top 10 Partners</h2>
                    {topPartners.length === 0 ? (
                        <p className="text-slate-500 text-sm text-center py-10">No partner downloads yet</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={barData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                <Bar dataKey="downloads" radius={[6, 6, 0, 0]}>
                                    {barData.map((entry, i) => (
                                        <Cell key={i} fill={TIER_INFO[entry.level]?.color ?? '#06b6d4'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* Line Chart – Daily trend */}
                <div className="glass rounded-2xl border border-white/10 p-6">
                    <h2 className="text-sm font-black text-white uppercase tracking-wide italic mb-6">Downloads — Last 30 Days</h2>
                    {dailyDownloads.every(d => d.downloads === 0) ? (
                        <p className="text-slate-500 text-sm text-center py-10">No download events recorded yet</p>
                    ) : (
                        <ResponsiveContainer width="100%" height={260}>
                            <LineChart data={lineData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} interval={4} />
                                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(6,182,212,0.3)', strokeWidth: 1 }} />
                                <Line
                                    type="monotone" dataKey="downloads"
                                    stroke="#06b6d4" strokeWidth={2.5}
                                    dot={false} activeDot={{ r: 5, fill: '#06b6d4', stroke: '#0f1419', strokeWidth: 2 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* Full Leaderboard Table */}
            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/5">
                    <h2 className="text-sm font-black text-white uppercase tracking-wide italic">Partner Leaderboard</h2>
                    <p className="text-[11px] text-slate-500 mt-0.5">Click a row to see the accounts attributed to that partner and its signal breakdown.</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Rank</th>
                                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Partner</th>
                                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Tier</th>
                                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Downloads</th>
                                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Accounts</th>
                                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Fee</th>
                                <th className="px-6 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Partner Since</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {allPartners.length === 0 && (
                                <tr><td colSpan={7} className="px-6 py-16 text-center text-slate-500 text-sm">No partners yet</td></tr>
                            )}
                            {allPartners.map((partner, i) => {
                                const tier = TIER_INFO[partner.partner_level ?? 1]
                                const pct = totalDownloads > 0 ? ((partner.total_downloads ?? 0) / totalDownloads) * 100 : 0
                                const b = partner.breakdown
                                const accounts = b?.attributedAccounts ?? []
                                const isOpen = expanded.has(partner.id)
                                const suspect = (b?.suspectedTestEvents ?? 0) > 0
                                return (
                                    <Fragment key={partner.id}>
                                        <tr
                                            onClick={() => toggle(partner.id)}
                                            className="hover:bg-white/5 transition-colors cursor-pointer"
                                        >
                                            <td className="px-6 py-4">
                                                <span className={`text-sm font-black ${i < 3 ? 'text-yellow-400' : 'text-slate-600'}`}>#{i + 1}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <i className={`fa-solid fa-chevron-right text-[9px] text-slate-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                                    <p className="text-sm font-semibold text-slate-200">{partner.display_name ?? 'Unnamed'}</p>
                                                    {suspect && (
                                                        <span
                                                            title={`${b!.suspectedTestEvents} events look like QR self-testing (mixed devices within 3 min). Not excluded from the count.`}
                                                            className="text-[9px] font-bold uppercase tracking-wide text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5"
                                                        >
                                                            ⚠ test?
                                                        </span>
                                                    )}
                                                </div>
                                                {b && (
                                                    <p className="text-[10px] text-slate-500 mt-1 ml-4">
                                                        {b.installs} install · {b.storeVisits} store · {b.signups} signup · {b.clicks} click
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-xs font-semibold" style={{ color: tier?.color }}>
                                                    {tier?.emoji} {tier?.name}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <div>
                                                    <p className="text-sm font-black text-brand-green">{(partner.total_downloads ?? 0).toLocaleString()}</p>
                                                    <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden w-24 ml-auto">
                                                        <div className="h-full rounded-full bg-brand-green" style={{ width: `${pct}%` }} />
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <span className={`text-sm font-black ${accounts.length ? 'text-blue-400' : 'text-slate-600'}`}>
                                                    {accounts.length}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4 text-right">
                                                <span className="text-sm font-semibold text-slate-300">{partner.partner_fee ?? 5.0}%</span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className="text-xs text-slate-500">
                                                    {partner.partner_joined_at ? new Date(partner.partner_joined_at).toLocaleDateString() : '—'}
                                                </span>
                                            </td>
                                        </tr>
                                        {isOpen && (
                                            <tr className="bg-black/20">
                                                <td colSpan={7} className="px-6 py-4">
                                                    <div className="ml-4">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                                            Attributed Accounts ({accounts.length})
                                                        </p>
                                                        {accounts.length === 0 ? (
                                                            <p className="text-xs text-slate-500">
                                                                No accounts linked yet. Downloads are counted from install / store-visit
                                                                events; an account links only when a referred user signs up and attribution
                                                                fires (Android install→signup, or the web cookie path).
                                                            </p>
                                                        ) : (
                                                            <div className="flex flex-wrap gap-2">
                                                                {accounts.map(a => (
                                                                    <div key={a.id} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                                                                        <p className="text-xs font-semibold text-slate-200">{a.display_name ?? 'Unnamed'}</p>
                                                                        <p className="text-[10px] text-slate-500">
                                                                            {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                                                                            {a.stripe_region ? ` · ${a.stripe_region.toUpperCase()}` : ''}
                                                                        </p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {suspect && (
                                                            <p className="text-[11px] text-amber-400/80 mt-3">
                                                                ⚠ {b!.suspectedTestEvents} of this partner&apos;s events fall in a short window
                                                                across mixed device types — likely the partner testing their own QR. These are
                                                                <span className="font-semibold"> not</span> excluded from the download count; flagged for review only.
                                                            </p>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
