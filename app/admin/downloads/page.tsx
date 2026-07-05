'use client'

import { useEffect, useState } from 'react'
import {
    BarChart, Bar, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from 'recharts'

interface PartnerRow {
    id: string
    display_name: string | null
    total_downloads: number
    partner_level: number | null
    partner_fee: number | null
    partner_joined_at: string | null
}

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
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch('/api/admin/downloads')
            .then(r => r.json())
            .then(data => {
                setTopPartners(data.topPartners ?? [])
                setAllPartners(data.allPartners ?? [])
                setDailyDownloads(data.dailyDownloads ?? [])
            })
            .finally(() => setLoading(false))
    }, [])

    const totalDownloads = allPartners.reduce((s, p) => s + (p.total_downloads ?? 0), 0)

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
                    { label: 'Total Partners', value: allPartners.length, icon: 'fa-solid fa-handshake', color: 'text-yellow-400' },
                    { label: 'Total Downloads', value: totalDownloads.toLocaleString(), icon: 'fa-solid fa-download', color: 'text-brand-green' },
                    { label: 'Last 30 Days', value: dailyDownloads.reduce((s, d) => s + d.downloads, 0).toLocaleString(), icon: 'fa-regular fa-calendar', color: 'text-brand-cyan' },
                    { label: 'Avg per Partner', value: allPartners.length ? Math.round(totalDownloads / allPartners.length).toLocaleString() : '—', icon: 'fa-solid fa-chart-bar', color: 'text-blue-400' },
                ].map(card => (
                    <div key={card.label} className="glass rounded-2xl p-4 border border-white/10">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">{card.label}</p>
                        <p className={`text-2xl font-black ${card.color}`}>{card.value}</p>
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
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Rank</th>
                                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Partner</th>
                                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-500">Tier</th>
                                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Downloads</th>
                                <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Fee</th>
                                <th className="px-6 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">Partner Since</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {allPartners.length === 0 && (
                                <tr><td colSpan={6} className="px-6 py-16 text-center text-slate-500 text-sm">No partners yet</td></tr>
                            )}
                            {allPartners.map((partner, i) => {
                                const tier = TIER_INFO[partner.partner_level ?? 1]
                                const pct = totalDownloads > 0 ? ((partner.total_downloads ?? 0) / totalDownloads) * 100 : 0
                                return (
                                    <tr key={partner.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-6 py-4">
                                            <span className={`text-sm font-black ${i < 3 ? 'text-yellow-400' : 'text-slate-600'}`}>#{i + 1}</span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <p className="text-sm font-semibold text-slate-200">{partner.display_name ?? 'Unnamed'}</p>
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
                                            <span className="text-sm font-semibold text-slate-300">{partner.partner_fee ?? 5.0}%</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-xs text-slate-500">
                                                {partner.partner_joined_at ? new Date(partner.partner_joined_at).toLocaleDateString() : '—'}
                                            </span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
