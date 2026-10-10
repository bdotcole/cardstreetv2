'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Admin -> Social -> Content: what each post did, so Arisa can see which
 * formats, hooks and posting times work. Reads /api/admin/social/content
 * (posts with the content columns, Instagram online-followers by hour, the
 * past weekly reports) and ranks client-side.
 *
 * Engagement rate = (likes + comments + shares + saves) / max(reach, views),
 * the same definition the weekly email uses, so the two never disagree.
 */

type Platform = 'facebook' | 'instagram' | 'youtube' | 'tiktok'
type Brand = 'cardstreet' | 'chopper_kuma'

const PLATFORM_LABEL: Record<Platform, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
const PLATFORM_COLOR: Record<Platform, string> = { facebook: '#3987e5', instagram: '#d95926', youtube: '#199e70', tiktok: '#c98500' }

interface Account { id: string; platform: Platform; display_name: string | null; handle: string | null }
interface Post {
    account_id: string
    external_id: string
    published_at: string | null
    caption: string | null
    media_type: string | null
    permalink: string | null
    thumbnail_url: string | null
    reach: number | null
    views: number | null
    likes: number | null
    comments: number | null
    shares: number | null
    saves: number | null
    format: string | null
    duration_seconds: number | null
    watch_time_seconds: number | null
    avg_watch_seconds: number | null
    avg_watch_pct: number | null
    hook_pct: number | null
    follows: number | null
    profile_visits: number | null
    total_interactions: number | null
    has_retention: boolean
}
interface Report {
    id: string
    week_start: string
    week_end: string
    sent_to: string | null
    sent_at: string | null
    narrative: { headline?: string; summary?: string; generatedBy?: string } | null
}
interface Payload {
    brand: Brand
    window: { since: string; until: string; days: number }
    accounts: Account[]
    posts: Post[]
    onlineFollowersByHour: number[] | null
    reports: Report[]
    reportsError: string | null
    error?: string
}

type SortKey = 'engagement' | 'reach' | 'views' | 'saves' | 'shares' | 'watch' | 'hook' | 'newest'

function num(v: number | null | undefined): string { return v === null || v === undefined ? '—' : Math.round(v).toLocaleString() }
function pct(v: number | null | undefined): string { return v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%` }
function secs(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—'
    const s = Math.round(Number(v))
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
function engagementRate(p: Post): number | null {
    const base = Math.max(p.reach ?? 0, p.views ?? 0)
    if (base < 1) return null
    return ((p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / base * 100
}
function bangkokHour(iso: string | null): number | null {
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : (d.getUTCHours() + 7) % 24
}
function bucket(h: number): string { return h < 6 ? 'night 00–05' : h < 12 ? 'morning 06–11' : h < 18 ? 'afternoon 12–17' : 'evening 18–23' }
function avg(xs: (number | null)[]): number | null {
    const v = xs.filter((x): x is number => x !== null && Number.isFinite(x))
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export default function ContentView({ brand, brandLabel, range }: { brand: Brand; brandLabel: string; range: number }) {
    const [data, setData] = useState<Payload | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [platform, setPlatform] = useState<'all' | Platform>('all')
    const [format, setFormat] = useState<string>('all')
    const [sort, setSort] = useState<SortKey>('engagement')
    const [busy, setBusy] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/admin/social/content?brand=${brand}&days=${range}`, { cache: 'no-store' })
            const json = await res.json().catch(() => ({})) as Payload
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
            setData(json)
            setError(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }, [brand, range])
    useEffect(() => { load() }, [load])

    const platformOf = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, a.platform])), [data])
    const posts = useMemo(() => (data?.posts ?? []).map((p) => ({ ...p, platform: platformOf.get(p.account_id) ?? ('facebook' as Platform), er: engagementRate(p), hour: bangkokHour(p.published_at) })), [data, platformOf])
    const formats = useMemo(() => [...new Set(posts.map((p) => p.format ?? 'post'))].sort(), [posts])

    const shown = useMemo(() => {
        const list = posts.filter((p) => (platform === 'all' || p.platform === platform) && (format === 'all' || (p.format ?? 'post') === format))
        const key = (p: typeof list[number]): number => {
            switch (sort) {
                case 'engagement': return p.er ?? -1
                case 'reach': return p.reach ?? p.views ?? -1
                case 'views': return p.views ?? -1
                case 'saves': return p.saves ?? -1
                case 'shares': return p.shares ?? -1
                case 'watch': return p.avg_watch_pct ?? (p.avg_watch_seconds ?? -1)
                case 'hook': return p.hook_pct ?? -1
                case 'newest': return p.published_at ? Date.parse(p.published_at) : -1
            }
        }
        return [...list].sort((a, b) => key(b) - key(a))
    }, [posts, platform, format, sort])

    const formatSummary = useMemo(() => {
        const groups = new Map<string, typeof posts>()
        for (const p of posts) {
            const k = `${p.platform}|${p.format ?? 'post'}`
            groups.set(k, [...(groups.get(k) ?? []), p])
        }
        return [...groups.entries()].map(([k, ps]) => {
            const [pl, f] = k.split('|')
            return { platform: pl as Platform, format: f, count: ps.length, er: avg(ps.map((p) => p.er)), reach: avg(ps.map((p) => p.reach ?? p.views)), saves: avg(ps.map((p) => p.saves)), watch: avg(ps.map((p) => p.avg_watch_pct)), hook: avg(ps.map((p) => p.hook_pct)) }
        }).sort((a, b) => (b.er ?? -1) - (a.er ?? -1))
    }, [posts])

    const hourSummary = useMemo(() => {
        const groups = new Map<string, typeof posts>()
        for (const p of posts) if (p.hour !== null) groups.set(bucket(p.hour), [...(groups.get(bucket(p.hour)) ?? []), p])
        return ['morning 06–11', 'afternoon 12–17', 'evening 18–23', 'night 00–05'].map((b) => ({ bucket: b, count: groups.get(b)?.length ?? 0, er: avg((groups.get(b) ?? []).map((p) => p.er)), reach: avg((groups.get(b) ?? []).map((p) => p.reach ?? p.views)) }))
    }, [posts])

    const bestHours = useMemo(() => {
        const h = data?.onlineFollowersByHour
        if (!h) return null
        const max = Math.max(...h, 1)
        return h.map((v, hour) => ({ hour, v, share: v / max }))
    }, [data])

    const openPreview = async () => {
        setBusy('preview')
        setNotice(null)
        try {
            const res = await fetch(`/api/admin/social/insights?brand=${brand}`, { cache: 'no-store' })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
            const w = window.open('', '_blank')
            if (w) { w.document.open(); w.document.write(json.html); w.document.close() }
            setNotice(`Preview built (${json.narrative?.generatedBy === 'gemini' ? 'Gemini narrative' : 'rule-based narrative'}). It will go to ${json.recipient}.`)
            load()
        } catch (e) {
            setNotice(`Preview failed: ${e instanceof Error ? e.message : 'unknown error'}`)
        } finally {
            setBusy(null)
        }
    }
    const sendNow = async () => {
        if (!window.confirm(`Send this week's ${brandLabel} insights email now?`)) return
        setBusy('send')
        setNotice(null)
        try {
            const res = await fetch('/api/admin/social/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand }) })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
            setNotice(json.sent ? `Sent to ${json.sentTo}: "${json.headline}"` : 'Report built but the email did not send (Courier not configured?).')
            load()
        } catch (e) {
            setNotice(`Send failed: ${e instanceof Error ? e.message : 'unknown error'}`)
        } finally {
            setBusy(null)
        }
    }

    const Key = ({ platform: pl }: { platform: Platform }) => <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle" style={{ backgroundColor: PLATFORM_COLOR[pl] }} />
    const th = 'py-2 px-2 font-black text-[10px] uppercase tracking-widest text-slate-500 text-right whitespace-nowrap'
    const td = 'py-2 px-2 text-right tabular-nums text-slate-200 whitespace-nowrap'

    if (loading && !data) return <div className="text-center py-20 text-slate-500 text-sm">Loading content…</div>
    if (error) return <div className="rounded-xl border border-brand-red/30 bg-brand-red/10 px-4 py-3 text-xs text-brand-red">{error}</div>
    if (!data) return null

    const overallEr = avg(posts.map((p) => p.er))
    const bestFormat = formatSummary.find((f) => f.count >= 2 && f.er !== null)
    const bestBucket = [...hourSummary].filter((b) => b.count >= 2 && b.er !== null).sort((a, b) => (b.er ?? 0) - (a.er ?? 0))[0]
    const topOnline = bestHours ? [...bestHours].sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.hour) : []

    return (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {notice && (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-brand-cyan/30 bg-brand-cyan/10 px-4 py-3 text-xs text-brand-cyan">
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice(null)} className="text-brand-cyan/70 hover:text-brand-cyan" aria-label="Dismiss">x</button>
                </div>
            )}

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                <Tile label="Posts analysed" value={String(posts.length)} sub={`published in the last ${range} days`} />
                <Tile label="Avg engagement rate" value={pct(overallEr)} sub="interactions ÷ reach (or views)" />
                <Tile label="Best format" value={bestFormat ? `${bestFormat.format}` : '—'} sub={bestFormat ? `${PLATFORM_LABEL[bestFormat.platform]} · ${pct(bestFormat.er)} avg over ${bestFormat.count}` : 'needs 2+ posts per format'} />
                <Tile label="Best posting time" value={bestBucket ? bestBucket.bucket.split(' ')[0] : '—'} sub={bestBucket ? `${bestBucket.bucket.split(' ')[1]} Bangkok · ${pct(bestBucket.er)} avg` : 'needs 2+ posts per slot'} />
            </div>

            <div className="glass rounded-2xl border border-white/10 p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <h2 className="text-sm font-black text-white">Posts</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        <select value={platform} onChange={(e) => setPlatform(e.target.value as any)} className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white">
                            <option value="all">All platforms</option>
                            {(['facebook', 'instagram', 'youtube'] as Platform[]).filter((pl) => posts.some((p) => p.platform === pl)).map((pl) => <option key={pl} value={pl}>{PLATFORM_LABEL[pl]}</option>)}
                        </select>
                        <select value={format} onChange={(e) => setFormat(e.target.value)} className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white">
                            <option value="all">All formats</option>
                            {formats.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white">
                            <option value="engagement">Sort: engagement rate</option>
                            <option value="reach">Sort: reach</option>
                            <option value="views">Sort: views</option>
                            <option value="saves">Sort: saves</option>
                            <option value="shares">Sort: shares</option>
                            <option value="watch">Sort: watch %</option>
                            <option value="hook">Sort: hook (30s)</option>
                            <option value="newest">Sort: newest</option>
                        </select>
                    </div>
                </div>
                {shown.length === 0 ? (
                    <p className="text-xs text-slate-500 py-6 text-center">No posts in this window yet — the daily sync stores the latest 15 per account; run Sync now on the Overview to pull them.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr>
                                    <th className={`${th} text-left`}>Post</th>
                                    <th className={th}>Published</th>
                                    <th className={th}>Reach</th>
                                    <th className={th}>Views</th>
                                    <th className={th}>Engage.</th>
                                    <th className={th}>Likes</th>
                                    <th className={th}>Comments</th>
                                    <th className={th}>Shares</th>
                                    <th className={th}>Saves</th>
                                    <th className={th}>Follows</th>
                                    <th className={th}>Avg watch</th>
                                    <th className={th}>Hook 30s</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {shown.map((p) => (
                                    <tr key={`${p.account_id}:${p.external_id}`} className="hover:bg-white/[0.02]">
                                        <td className="py-2 px-2">
                                            <div className="flex items-center gap-3 min-w-[260px] max-w-[380px]">
                                                {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-white/5 shrink-0" />}
                                                <div className="min-w-0">
                                                    <p className="flex items-center gap-1.5 text-[10px] text-slate-500"><Key platform={p.platform} />{PLATFORM_LABEL[p.platform]} · {p.format ?? 'post'}{p.duration_seconds ? ` · ${secs(p.duration_seconds)}` : ''}</p>
                                                    {p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer" className="text-white font-bold hover:text-brand-cyan line-clamp-1">{p.caption?.trim() || '(no caption)'}</a> : <p className="text-white font-bold line-clamp-1">{p.caption?.trim() || '(no caption)'}</p>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className={td}>{p.published_at ? new Date(p.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}{p.hour !== null ? <span className="text-slate-500"> {String(p.hour).padStart(2, '0')}:00</span> : null}</td>
                                        <td className={td}>{num(p.reach)}</td>
                                        <td className={td}>{num(p.views)}</td>
                                        <td className={`${td} font-black text-white`}>{pct(p.er)}</td>
                                        <td className={td}>{num(p.likes)}</td>
                                        <td className={td}>{num(p.comments)}</td>
                                        <td className={td}>{num(p.shares)}</td>
                                        <td className={td}>{num(p.saves)}</td>
                                        <td className={td}>{num(p.follows)}</td>
                                        <td className={td}>{p.avg_watch_pct !== null ? pct(p.avg_watch_pct) : secs(p.avg_watch_seconds)}</td>
                                        <td className={td}>{pct(p.hook_pct)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="text-[10px] text-slate-600 mt-3">Engagement = (likes + comments + shares + saves) ÷ reach (views where reach isn't reported). Avg watch: YouTube = % of the video; Instagram Reels = seconds. Hook = YouTube viewers still watching at 30s. A dash means the platform doesn't report it.</p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="glass rounded-2xl border border-white/10 p-5">
                    <h2 className="text-sm font-black text-white mb-3">By format</h2>
                    {formatSummary.length === 0 ? <p className="text-xs text-slate-500">No posts yet.</p> : (
                        <table className="w-full text-xs">
                            <thead><tr><th className={`${th} text-left`}>Format</th><th className={th}>Posts</th><th className={th}>Avg engage.</th><th className={th}>Avg reach</th><th className={th}>Avg saves</th><th className={th}>Watch / hook</th></tr></thead>
                            <tbody className="divide-y divide-white/5">
                                {formatSummary.map((f) => (
                                    <tr key={`${f.platform}|${f.format}`}>
                                        <td className="py-2 px-2 text-slate-200"><span className="flex items-center gap-1.5"><Key platform={f.platform} />{PLATFORM_LABEL[f.platform]} · {f.format}</span></td>
                                        <td className={td}>{f.count}</td>
                                        <td className={`${td} font-black text-white`}>{pct(f.er)}</td>
                                        <td className={td}>{num(f.reach)}</td>
                                        <td className={td}>{f.saves === null ? '—' : f.saves.toFixed(1)}</td>
                                        <td className={td}>{f.hook !== null ? `${pct(f.hook)} hook` : f.watch !== null ? `${pct(f.watch)} watched` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                <div className="glass rounded-2xl border border-white/10 p-5 space-y-4">
                    <div>
                        <h2 className="text-sm font-black text-white mb-3">When you post (Bangkok time)</h2>
                        <table className="w-full text-xs">
                            <thead><tr><th className={`${th} text-left`}>Slot</th><th className={th}>Posts</th><th className={th}>Avg engage.</th><th className={th}>Avg reach</th></tr></thead>
                            <tbody className="divide-y divide-white/5">
                                {hourSummary.map((b) => (
                                    <tr key={b.bucket}><td className="py-2 px-2 text-slate-200">{b.bucket}</td><td className={td}>{b.count}</td><td className={`${td} font-black text-white`}>{pct(b.er)}</td><td className={td}>{num(b.reach)}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">When Instagram followers are online</h3>
                        {bestHours ? (
                            <>
                                <div className="flex items-end gap-[2px] h-16">
                                    {bestHours.map((h) => (
                                        <div key={h.hour} className="flex-1 rounded-t-sm" title={`${String(h.hour).padStart(2, '0')}:00 — ${h.v.toLocaleString()} online`} style={{ height: `${Math.max(4, h.share * 100)}%`, backgroundColor: topOnline.includes(h.hour) ? '#d95926' : 'rgba(255,255,255,0.18)' }} />
                                    ))}
                                </div>
                                <div className="flex justify-between text-[9px] text-slate-600 mt-1"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
                                <p className="text-[11px] text-slate-400 mt-2">Peak hours: <b className="text-white">{topOnline.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}</b> — post just before them.</p>
                            </>
                        ) : <p className="text-xs text-slate-500">Instagram hasn't reported online-followers for this window yet (it serves the last 30 days only).</p>}
                    </div>
                </div>
            </div>

            <div className="glass rounded-2xl border border-white/10 p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <div>
                        <h2 className="text-sm font-black text-white">Weekly insights email</h2>
                        <p className="text-[10px] text-slate-500">Every Monday 09:00 Bangkok, for the week just ended. Preview builds this week-to-date without sending.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={openPreview} disabled={busy !== null} className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition disabled:opacity-40">{busy === 'preview' ? 'Building…' : 'Preview'}</button>
                        <button type="button" onClick={sendNow} disabled={busy !== null} className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-brand-cyan text-slate-950 hover:bg-cyan-400 transition disabled:opacity-40">{busy === 'send' ? 'Sending…' : 'Send now'}</button>
                    </div>
                </div>
                {data.reportsError ? (
                    <p className="text-xs text-yellow-300/90">Reports table missing — run migration 20261010_social_content_signups.sql.</p>
                ) : data.reports.length === 0 ? (
                    <p className="text-xs text-slate-500">No reports yet. The first one goes out next Monday, or press Send now.</p>
                ) : (
                    <ul className="divide-y divide-white/5">
                        {data.reports.map((r) => (
                            <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-white truncate">{r.narrative?.headline ?? `Week of ${r.week_start}`}</p>
                                    <p className="text-[10px] text-slate-500">{r.week_start} → {r.week_end} · {r.sent_at ? `sent to ${r.sent_to} ${new Date(r.sent_at).toLocaleDateString('en-GB')}` : 'built, not sent'}{r.narrative?.generatedBy === 'rules' ? ' · rule-based narrative' : ''}</p>
                                </div>
                                <a href={`/api/admin/social/insights?id=${r.id}`} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-[10px] font-bold text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/20 rounded-lg hover:bg-brand-cyan/20 transition shrink-0">Open</a>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="glass rounded-2xl p-5 border border-white/10">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
            <p className="text-2xl font-black text-white mt-1.5 leading-none truncate">{value}</p>
            {sub && <p className="text-[10px] text-slate-500 mt-2">{sub}</p>}
        </div>
    )
}
