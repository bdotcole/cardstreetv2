'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    BarChart, Bar, LineChart, Line, LabelList,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

/**
 * Admin -> Social: reach, followers, views, link clicks and top posts for the
 * brand social accounts, from the daily snapshots the social-metrics cron
 * stores (lib/social). Two brands (Cardstreet, Chopper & Kuma), one tab each.
 *
 * Colours are the first four categorical slots of the data-viz palette,
 * validated for the admin surface (#0f1419) with the validator in the dataviz
 * skill: every adjacent pair clears the colour-blind and normal-vision floors.
 * The slot is fixed per platform so a filter never repaints a survivor.
 */

type Platform = 'facebook' | 'instagram' | 'youtube' | 'tiktok'
type Brand = 'cardstreet' | 'chopper_kuma'
type Provider = 'meta' | 'youtube' | 'tiktok'

const PLATFORMS: Platform[] = ['facebook', 'instagram', 'youtube', 'tiktok']
const PLATFORM_LABEL: Record<Platform, string> = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }
const PLATFORM_COLOR: Record<Platform, string> = { facebook: '#3987e5', instagram: '#d95926', youtube: '#199e70', tiktok: '#c98500' }
const PLATFORM_PROVIDER: Record<Platform, Provider> = { facebook: 'meta', instagram: 'meta', youtube: 'youtube', tiktok: 'tiktok' }
const PROVIDERS: { key: Provider; label: string; platforms: Platform[] }[] = [
    { key: 'meta', label: 'Facebook & Instagram', platforms: ['facebook', 'instagram'] },
    { key: 'youtube', label: 'YouTube', platforms: ['youtube'] },
    { key: 'tiktok', label: 'TikTok', platforms: ['tiktok'] },
]
const BRANDS: { key: Brand; label: string }[] = [
    { key: 'cardstreet', label: 'Cardstreet' },
    { key: 'chopper_kuma', label: 'Chopper & Kuma' },
]
const RANGES = [7, 28, 90] as const

// What each platform's API can report. Anything false renders "n/a", never a zero.
const REPORTS: Record<Platform, { reach: boolean; link_clicks: boolean; profile_views: boolean }> = {
    facebook: { reach: true, link_clicks: true, profile_views: true },
    instagram: { reach: true, link_clicks: true, profile_views: true },
    youtube: { reach: false, link_clicks: false, profile_views: false },
    tiktok: { reach: false, link_clicks: false, profile_views: false },
}

const SURFACE = '#0f1419'
const GRID = 'rgba(255,255,255,0.07)'
const AXIS_INK = '#898781'
const UP_GOOD = '#4ade80'
const DOWN_BAD = '#f87171'

interface Account {
    id: string
    brand: Brand
    platform: Platform
    external_id: string
    handle: string | null
    display_name: string | null
    avatar_url: string | null
    profile_url: string | null
    parent_account_id: string | null
    enabled: boolean
    has_token: boolean
    connected_at: string
    last_synced_at: string | null
    last_sync_error: string | null
}

interface DailyRow {
    account_id: string
    day: string
    followers: number | null
    follower_delta: number | null
    reach: number | null
    views: number | null
    profile_views: number | null
    link_clicks: number | null
    engagements: number | null
    likes: number | null
    comments: number | null
    shares: number | null
    saves: number | null
    watch_minutes: number | null
    posts: number | null
}

interface PostRow {
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
}

interface TrafficRow { day: string; platform: Platform; sessions: number; users: number }

interface MetricsPayload {
    brand: Brand
    window: { since: string; until: string; prevSince: string; days: number }
    accounts: Account[]
    daily: DailyRow[]
    posts: PostRow[]
    siteTraffic: TrafficRow[]
    providers: Record<Provider, boolean>
    ga4: boolean
    error?: string
    migrationMissing?: boolean
}

type WindowMetric = 'reach' | 'views' | 'link_clicks' | 'engagements' | 'profile_views'

// --- formatting -----------------------------------------------------------

function compact(n: number | null | undefined): string {
    if (n === null || n === undefined) return 'n/a'
    const abs = Math.abs(n)
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
    if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
    return n.toLocaleString()
}

function signed(n: number): string {
    return `${n > 0 ? '+' : n < 0 ? '-' : ''}${compact(Math.abs(n))}`
}

function pct(now: number, before: number): string | null {
    if (!before) return null
    const p = ((now - before) / before) * 100
    return `${p > 0 ? '+' : ''}${p.toFixed(Math.abs(p) >= 10 ? 0 : 1)}%`
}

function shortDay(day: string): string {
    const d = new Date(`${day}T00:00:00Z`)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function relative(iso: string | null): string {
    if (!iso) return 'never'
    const ms = Date.now() - new Date(iso).getTime()
    const h = Math.round(ms / 3_600_000)
    if (h < 1) return 'just now'
    if (h < 48) return `${h}h ago`
    return `${Math.round(h / 24)}d ago`
}

function eachDay(since: string, until: string): string[] {
    const out: string[] = []
    const d = new Date(`${since}T00:00:00Z`)
    const end = new Date(`${until}T00:00:00Z`)
    while (d <= end) {
        out.push(d.toISOString().slice(0, 10))
        d.setUTCDate(d.getUTCDate() + 1)
    }
    return out
}

// --- aggregation ------------------------------------------------------------

interface PlatformSummary {
    platform: Platform
    accounts: Account[]
    followersNow: number | null
    followersDelta: number | null
    totals: Record<WindowMetric, number | null>
    prevTotals: Record<WindowMetric, number | null>
    postsInWindow: number
    lastSynced: string | null
    errors: string[]
}

interface Aggregate {
    days: string[]
    perDay: Array<Record<string, number | string | null>>        // followers by platform
    viewsPerDay: Array<Record<string, number | string | null>>
    reachPerDay: Array<Record<string, number | string | null>>
    clicksPerDay: Array<Record<string, number | string | null>>
    trafficPerDay: Array<Record<string, number | string | null>>
    platforms: PlatformSummary[]
    kpi: {
        followers: { now: number | null; delta: number | null; prevDelta: number | null }
        reach: { now: number | null; prev: number | null }
        views: { now: number | null; prev: number | null }
        clicks: { now: number | null; prev: number | null }
        siteSessions: { now: number | null; prev: number | null }
        engagements: { now: number | null; prev: number | null }
    }
    topPosts: (PostRow & { platform: Platform; accountLabel: string })[]
}

const WINDOW_METRICS: WindowMetric[] = ['reach', 'views', 'link_clicks', 'engagements', 'profile_views']

function sumNullable(values: (number | null | undefined)[]): number | null {
    let any = false
    let total = 0
    for (const v of values) if (v !== null && v !== undefined) { any = true; total += v }
    return any ? total : null
}

function aggregate(p: MetricsPayload): Aggregate {
    const { since, until, prevSince } = p.window
    const days = eachDay(since, until)
    const allDays = eachDay(prevSince, until)
    const accountsById = new Map(p.accounts.map((a) => [a.id, a]))
    const inWindow = (d: string) => d >= since && d <= until
    const inPrev = (d: string) => d >= prevSince && d < since

    // Forward-fill followers per account so a day a platform skipped doesn't read as a drop.
    const followersByAccountDay = new Map<string, Map<string, number>>()
    const rowsByAccount = new Map<string, DailyRow[]>()
    for (const r of p.daily) {
        const list = rowsByAccount.get(r.account_id) ?? []
        list.push(r)
        rowsByAccount.set(r.account_id, list)
    }
    for (const [accountId, rows] of rowsByAccount) {
        const byDay = new Map(rows.map((r) => [r.day, r]))
        const filled = new Map<string, number>()
        let last: number | null = null
        for (const d of allDays) {
            const v = byDay.get(d)?.followers
            if (v !== null && v !== undefined) last = v
            if (last !== null) filled.set(d, last)
        }
        followersByAccountDay.set(accountId, filled)
    }

    const platforms: PlatformSummary[] = PLATFORMS.map((platform) => {
        const accounts = p.accounts.filter((a) => a.platform === platform)
        const rows = p.daily.filter((r) => accountsById.get(r.account_id)?.platform === platform)
        const windowRows = rows.filter((r) => inWindow(r.day))
        const prevRows = rows.filter((r) => inPrev(r.day))
        const totals = Object.fromEntries(WINDOW_METRICS.map((m) => [m, sumNullable(windowRows.map((r) => r[m]))])) as Record<WindowMetric, number | null>
        const prevTotals = Object.fromEntries(WINDOW_METRICS.map((m) => [m, sumNullable(prevRows.map((r) => r[m]))])) as Record<WindowMetric, number | null>
        // "Not reported" beats a sum of nothing.
        if (!REPORTS[platform].reach) totals.reach = prevTotals.reach = null
        if (!REPORTS[platform].link_clicks) totals.link_clicks = prevTotals.link_clicks = null
        if (!REPORTS[platform].profile_views) totals.profile_views = prevTotals.profile_views = null

        const followersNow = sumNullable(accounts.map((a) => {
            const filled = followersByAccountDay.get(a.id)
            return filled?.get(until) ?? (filled ? [...filled.values()].pop() ?? null : null)
        }))
        const deltaSum = sumNullable(windowRows.map((r) => r.follower_delta))
        const followersStart = sumNullable(accounts.map((a) => followersByAccountDay.get(a.id)?.get(since) ?? null))
        const followersDelta = deltaSum ?? (followersNow !== null && followersStart !== null ? followersNow - followersStart : null)

        return {
            platform,
            accounts,
            followersNow,
            followersDelta,
            totals,
            prevTotals,
            postsInWindow: p.posts.filter((post) => accountsById.get(post.account_id)?.platform === platform && post.published_at && inWindow(post.published_at.slice(0, 10))).length,
            lastSynced: accounts.map((a) => a.last_synced_at).filter(Boolean).sort().pop() ?? null,
            errors: accounts.map((a) => a.last_sync_error).filter((e): e is string => Boolean(e)),
        }
    }).filter((s) => s.accounts.length > 0)

    const seriesFor = (metric: 'followers' | WindowMetric) => days.map((day) => {
        const point: Record<string, number | string | null> = { day }
        for (const s of platforms) {
            if (metric === 'followers') {
                point[s.platform] = sumNullable(s.accounts.map((a) => followersByAccountDay.get(a.id)?.get(day) ?? null))
            } else {
                const rows = p.daily.filter((r) => r.day === day && accountsById.get(r.account_id)?.platform === s.platform)
                point[s.platform] = sumNullable(rows.map((r) => r[metric]))
            }
        }
        return point
    })

    const trafficPerDay = days.map((day) => {
        const point: Record<string, number | string | null> = { day }
        for (const pl of PLATFORMS) {
            const row = p.siteTraffic.find((t) => t.day === day && t.platform === pl)
            point[pl] = row ? row.sessions : 0
        }
        return point
    })

    const kpiSum = (metric: WindowMetric, which: 'totals' | 'prevTotals') => sumNullable(platforms.map((s) => s[which][metric]))
    const siteNow = p.siteTraffic.filter((t) => inWindow(t.day)).reduce((a, t) => a + t.sessions, 0)
    const sitePrev = p.siteTraffic.filter((t) => inPrev(t.day)).reduce((a, t) => a + t.sessions, 0)
    const prevFollowerDelta = sumNullable(p.daily.filter((r) => inPrev(r.day)).map((r) => r.follower_delta))

    const topPosts = p.posts
        .filter((post) => post.published_at && inWindow(post.published_at.slice(0, 10)))
        .map((post) => {
            const a = accountsById.get(post.account_id)
            return { ...post, platform: a?.platform ?? 'facebook', accountLabel: a?.display_name ?? a?.handle ?? '' }
        })
        .sort((x, y) => (y.views ?? 0) - (x.views ?? 0) || ((y.likes ?? 0) + (y.comments ?? 0)) - ((x.likes ?? 0) + (x.comments ?? 0)))
        .slice(0, 10)

    return {
        days,
        perDay: seriesFor('followers'),
        viewsPerDay: seriesFor('views'),
        reachPerDay: seriesFor('reach'),
        clicksPerDay: seriesFor('link_clicks'),
        trafficPerDay,
        platforms,
        kpi: {
            followers: { now: sumNullable(platforms.map((s) => s.followersNow)), delta: sumNullable(platforms.map((s) => s.followersDelta)), prevDelta: prevFollowerDelta },
            reach: { now: kpiSum('reach', 'totals'), prev: kpiSum('reach', 'prevTotals') },
            views: { now: kpiSum('views', 'totals'), prev: kpiSum('views', 'prevTotals') },
            clicks: { now: kpiSum('link_clicks', 'totals'), prev: kpiSum('link_clicks', 'prevTotals') },
            siteSessions: { now: p.brand === 'cardstreet' ? siteNow : null, prev: p.brand === 'cardstreet' ? sitePrev : null },
            engagements: { now: kpiSum('engagements', 'totals'), prev: kpiSum('engagements', 'prevTotals') },
        },
        topPosts,
    }
}

// --- chart chrome -----------------------------------------------------------

function PlatformKey({ platform, line }: { platform: Platform; line?: boolean }) {
    return line
        ? <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ backgroundColor: PLATFORM_COLOR[platform] }} />
        : <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle" style={{ backgroundColor: PLATFORM_COLOR[platform] }} />
}

const ChartTooltip = ({ active, payload, label, line }: any) => {
    if (!active || !payload?.length) return null
    const rows = [...payload].filter((p: any) => p.value !== null && p.value !== undefined)
    return (
        <div className="bg-brand-darker border border-white/10 rounded-xl px-3 py-2 shadow-xl min-w-[150px]">
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">{shortDay(String(label))}</p>
            {rows.map((p: any) => (
                <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <PlatformKey platform={p.dataKey as Platform} line={line} />
                        {PLATFORM_LABEL[p.dataKey as Platform] ?? p.dataKey}
                    </span>
                    <span className="text-sm font-black text-white tabular-nums">{Number(p.value).toLocaleString()}</span>
                </div>
            ))}
        </div>
    )
}

const LegendRow = ({ payload, line }: any) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1 justify-end px-2 pb-1">
        {(payload ?? []).map((p: any) => (
            <span key={p.dataKey} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <PlatformKey platform={p.dataKey as Platform} line={line} />
                {PLATFORM_LABEL[p.dataKey as Platform] ?? p.value}
            </span>
        ))}
    </div>
)

/** Direct label on the last point of each line — the legend carries the rest. */
function endLabel(lastIndex: number) {
    return function EndLabel(props: any) {
        const { x, y, value, index } = props
        if (index !== lastIndex || value === null || value === undefined || typeof x !== 'number' || typeof y !== 'number') return null
        return (
            <text x={x + 6} y={y} dy={4} fontSize={11} fontWeight={700} fill="#c3c2b7">
                {compact(Number(value))}
            </text>
        )
    }
}

const axisProps = {
    tick: { fill: AXIS_INK, fontSize: 10 },
    axisLine: { stroke: 'rgba(255,255,255,0.12)' },
    tickLine: false as const,
}

function ChartCard({ title, sub, children, empty }: { title: string; sub?: string; children: React.ReactNode; empty?: string | null }) {
    return (
        <div className="glass rounded-2xl border border-white/10 p-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="text-sm font-black text-white">{title}</h2>
                {sub && <p className="text-[10px] text-slate-500 text-right">{sub}</p>}
            </div>
            {empty ? (
                <div className="h-[220px] flex items-center justify-center text-xs text-slate-500 text-center px-6">{empty}</div>
            ) : children}
        </div>
    )
}

function FollowersChart({ agg }: { agg: Aggregate }) {
    const platforms = agg.platforms.filter((s) => agg.perDay.some((d) => d[s.platform] !== null))
    const lastIndex = agg.perDay.length - 1
    return (
        <ChartCard title="Followers" sub="end of day, every platform" empty={platforms.length === 0 ? 'No follower history yet — it builds from the first sync.' : null}>
            <ResponsiveContainer width="100%" height={260}>
                <LineChart data={agg.perDay} margin={{ top: 10, right: 44, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
                    <YAxis {...axisProps} tickFormatter={(v) => compact(Number(v))} width={48} domain={['auto', 'auto']} />
                    <Tooltip content={<ChartTooltip line />} cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 }} />
                    <Legend content={<LegendRow line />} verticalAlign="top" />
                    {platforms.map((s) => (
                        <Line
                            key={s.platform} type="monotone" dataKey={s.platform} stroke={PLATFORM_COLOR[s.platform]}
                            strokeWidth={2} dot={false} connectNulls isAnimationActive={false}
                            activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
                        >
                            <LabelList dataKey={s.platform} content={endLabel(lastIndex)} />
                        </Line>
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </ChartCard>
    )
}

function StackedBars({ title, sub, data, platforms, empty }: {
    title: string; sub?: string; data: Array<Record<string, number | string | null>>; platforms: Platform[]; empty: string | null
}) {
    return (
        <ChartCard title={title} sub={sub} empty={empty}>
            <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
                    <YAxis {...axisProps} tickFormatter={(v) => compact(Number(v))} width={48} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend content={<LegendRow />} verticalAlign="top" />
                    {platforms.map((pl) => (
                        <Bar key={pl} dataKey={pl} stackId="a" fill={PLATFORM_COLOR[pl]} stroke={SURFACE} strokeWidth={1} maxBarSize={24} isAnimationActive={false} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </ChartCard>
    )
}

function LinesChart({ title, sub, data, platforms, empty }: {
    title: string; sub?: string; data: Array<Record<string, number | string | null>>; platforms: Platform[]; empty: string | null
}) {
    const lastIndex = data.length - 1
    return (
        <ChartCard title={title} sub={sub} empty={empty}>
            <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data} margin={{ top: 10, right: 44, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="day" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
                    <YAxis {...axisProps} tickFormatter={(v) => compact(Number(v))} width={48} />
                    <Tooltip content={<ChartTooltip line />} cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 }} />
                    <Legend content={<LegendRow line />} verticalAlign="top" />
                    {platforms.map((pl) => (
                        <Line
                            key={pl} type="monotone" dataKey={pl} stroke={PLATFORM_COLOR[pl]} strokeWidth={2} dot={false}
                            connectNulls isAnimationActive={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
                        >
                            <LabelList dataKey={pl} content={endLabel(lastIndex)} />
                        </Line>
                    ))}
                </LineChart>
            </ResponsiveContainer>
        </ChartCard>
    )
}

// --- tiles ------------------------------------------------------------------

function StatTile({ label, value, delta, deltaLabel, sub, upIsGood = true }: {
    label: string; value: string; delta?: string | null; deltaLabel?: string; sub?: string; upIsGood?: boolean
}) {
    const positive = delta?.startsWith('+')
    const negative = delta?.startsWith('-')
    // Direction x whether up is good picks the colour; a flat delta stays muted.
    const style = positive ? { color: upIsGood ? UP_GOOD : DOWN_BAD } : negative ? { color: upIsGood ? DOWN_BAD : UP_GOOD } : undefined
    return (
        <div className="glass rounded-2xl p-5 border border-white/10">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
            <p className="text-3xl font-black text-white mt-1.5 leading-none">{value}</p>
            <div className="mt-2 flex items-baseline gap-2 min-h-[16px]">
                {delta && (
                    <span className={`text-xs font-bold ${style ? '' : 'text-slate-500'}`} style={style}>
                        {positive ? '↑ ' : negative ? '↓ ' : ''}{delta.replace(/^[+-]/, '')}
                    </span>
                )}
                {deltaLabel && delta && <span className="text-[10px] text-slate-500">{deltaLabel}</span>}
                {sub && !delta && <span className="text-[10px] text-slate-500">{sub}</span>}
            </div>
        </div>
    )
}

// --- page -------------------------------------------------------------------

export default function AdminSocialPage() {
    const [brand, setBrand] = useState<Brand>('cardstreet')
    const [range, setRange] = useState<(typeof RANGES)[number]>(28)
    const [data, setData] = useState<MetricsPayload | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [syncing, setSyncing] = useState(false)
    const [tableView, setTableView] = useState(false)
    const [busyAccount, setBusyAccount] = useState<string | null>(null)
    const [pendingBackfill, setPendingBackfill] = useState<Brand | null>(null)

    const load = useCallback(async (b: Brand, r: number, quiet = false) => {
        if (quiet) setRefreshing(true); else setLoading(true)
        try {
            const res = await fetch(`/api/admin/social/metrics?brand=${b}&days=${r}`, { cache: 'no-store' })
            const json = await res.json().catch(() => ({})) as MetricsPayload
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
            setData(json)
            setError(json.migrationMissing ? null : (json.error ?? null))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load')
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [])

    const runSync = useCallback(async (b: Brand, days: number, message: string) => {
        setSyncing(true)
        setNotice(message)
        try {
            const res = await fetch('/api/admin/social/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ brand: b, days }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
            const failed = (json.accounts ?? []).filter((a: any) => !a.ok)
            const synced = (json.accounts ?? []).length - failed.length
            setNotice(
                failed.length
                    ? `Synced ${synced} account${synced === 1 ? '' : 's'}; ${failed.length} failed — see Connections below.`
                    : `Synced ${synced} account${synced === 1 ? '' : 's'} (${json.window?.since} to ${json.window?.until}).`,
            )
        } catch (e) {
            setNotice(`Sync failed: ${e instanceof Error ? e.message : 'unknown error'}`)
        } finally {
            setSyncing(false)
            load(b, range, true)
        }
    }, [load, range])

    // Return from an OAuth connect: ?connected=<provider>&accounts=N&brand=<brand>, or ?error=.
    useEffect(() => {
        const sp = new URLSearchParams(window.location.search)
        const connected = sp.get('connected')
        const err = sp.get('error')
        const b = sp.get('brand') as Brand | null
        if (b && BRANDS.some((x) => x.key === b)) setBrand(b)
        if (connected) {
            const n = Number(sp.get('accounts') || 0)
            setNotice(`Connected ${n} account${n === 1 ? '' : 's'} — pulling the last 90 days.`)
            setPendingBackfill(b ?? 'cardstreet')
        } else if (err) {
            setError(err)
        }
        if (connected || err) window.history.replaceState({}, '', window.location.pathname)
    }, [])

    useEffect(() => { load(brand, range, data !== null) }, [brand, range, load]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!pendingBackfill) return
        const b = pendingBackfill
        setPendingBackfill(null)
        runSync(b, 90, 'Pulling the last 90 days for the new accounts…')
    }, [pendingBackfill, runSync])

    const agg = useMemo(() => (data && !data.migrationMissing ? aggregate(data) : null), [data])

    const patchAccount = async (id: string, patch: { brand?: Brand; enabled?: boolean }) => {
        setBusyAccount(id)
        try {
            const res = await fetch(`/api/admin/social/accounts/${id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
            })
            if (!res.ok) {
                const j = await res.json().catch(() => ({}))
                throw new Error(j.error || `HTTP ${res.status}`)
            }
            await load(brand, range, true)
        } catch (e) {
            setNotice(`Update failed: ${e instanceof Error ? e.message : 'unknown error'}`)
        } finally {
            setBusyAccount(null)
        }
    }

    const disconnect = async (a: Account) => {
        const label = a.display_name || a.handle || a.external_id
        if (!window.confirm(`Disconnect ${PLATFORM_LABEL[a.platform]} "${label}"? Its history on this dashboard is deleted too.`)) return
        setBusyAccount(a.id)
        try {
            const res = await fetch(`/api/admin/social/accounts/${a.id}`, { method: 'DELETE' })
            if (!res.ok) {
                const j = await res.json().catch(() => ({}))
                throw new Error(j.error || `HTTP ${res.status}`)
            }
            await load(brand, range, true)
        } catch (e) {
            setNotice(`Disconnect failed: ${e instanceof Error ? e.message : 'unknown error'}`)
        } finally {
            setBusyAccount(null)
        }
    }

    const brandLabel = BRANDS.find((b) => b.key === brand)?.label ?? ''
    const windowLabel = `last ${range} days`
    const anyAccounts = (data?.accounts.length ?? 0) > 0

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Social</h1>
                    <p className="text-slate-500 text-sm mt-1">Reach, followers, views and link clicks across the brand channels</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex rounded-full border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Brand">
                        {BRANDS.map((b) => (
                            <button
                                key={b.key} type="button" onClick={() => setBrand(b.key)} aria-pressed={b.key === brand}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide transition-colors ${b.key === brand ? 'bg-brand-cyan text-slate-950' : 'text-slate-400 hover:text-white'}`}
                            >
                                {b.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex rounded-full border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Range">
                        {RANGES.map((r) => (
                            <button
                                key={r} type="button" onClick={() => setRange(r)} aria-pressed={r === range}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide transition-colors ${r === range ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'}`}
                            >
                                {r}D
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => setTableView((v) => !v)}
                        aria-pressed={tableView}
                        className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition"
                    >
                        {tableView ? 'Charts' : 'Table'}
                    </button>
                    <button
                        type="button"
                        onClick={() => runSync(brand, range, 'Syncing…')}
                        disabled={syncing || !anyAccounts}
                        className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-brand-cyan text-slate-950 hover:bg-cyan-400 transition disabled:opacity-40"
                    >
                        {syncing ? 'Syncing…' : 'Sync now'}
                    </button>
                </div>
            </div>

            {notice && (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-brand-cyan/30 bg-brand-cyan/10 px-4 py-3 text-xs text-brand-cyan">
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice(null)} className="text-brand-cyan/70 hover:text-brand-cyan" aria-label="Dismiss">x</button>
                </div>
            )}
            {error && (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-brand-red/30 bg-brand-red/10 px-4 py-3 text-xs text-brand-red">
                    <span>{error}</span>
                    <button type="button" onClick={() => setError(null)} className="text-brand-red/70 hover:text-brand-red" aria-label="Dismiss">x</button>
                </div>
            )}

            {data?.migrationMissing && (
                <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-5 py-4 text-sm text-yellow-200">
                    <p className="font-black">Database tables are not there yet.</p>
                    <p className="text-xs mt-1 text-yellow-200/80">
                        Run <code className="font-mono">supabase/migrations/20261005_social_metrics.sql</code> in the Supabase SQL Editor, then reload this page.
                    </p>
                </div>
            )}

            {loading && !data ? (
                <div className="text-center py-20 text-slate-500 text-sm">Loading…</div>
            ) : agg ? (
                <div className={`space-y-6 transition-opacity ${refreshing ? 'opacity-60' : ''}`}>
                    {!anyAccounts && (
                        <div className="glass rounded-2xl border border-white/10 px-6 py-8 text-center">
                            <p className="text-white font-black">No {brandLabel} accounts connected yet.</p>
                            <p className="text-xs text-slate-500 mt-1">Use the Connect buttons under Connections below. Each platform is a one-time sign-in; the daily cron does the rest.</p>
                        </div>
                    )}

                    {anyAccounts && (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                                <StatTile
                                    label="Followers" value={compact(agg.kpi.followers.now)}
                                    delta={agg.kpi.followers.delta !== null ? signed(agg.kpi.followers.delta) : null}
                                    deltaLabel={`net new, ${windowLabel}`}
                                    sub={agg.kpi.followers.now === null ? 'no snapshot yet' : 'across every platform'}
                                />
                                <StatTile
                                    label="Reach" value={compact(agg.kpi.reach.now)}
                                    delta={agg.kpi.reach.now !== null && agg.kpi.reach.prev !== null ? pct(agg.kpi.reach.now, agg.kpi.reach.prev) : null}
                                    deltaLabel="vs previous period" sub="Facebook + Instagram only"
                                />
                                <StatTile
                                    label="Views" value={compact(agg.kpi.views.now)}
                                    delta={agg.kpi.views.now !== null && agg.kpi.views.prev !== null ? pct(agg.kpi.views.now, agg.kpi.views.prev) : null}
                                    deltaLabel="vs previous period" sub={windowLabel}
                                />
                                <StatTile
                                    label="Link clicks" value={compact(agg.kpi.clicks.now)}
                                    delta={agg.kpi.clicks.now !== null && agg.kpi.clicks.prev !== null ? pct(agg.kpi.clicks.now, agg.kpi.clicks.prev) : null}
                                    deltaLabel="vs previous period" sub="profile link + CTA taps (FB, IG)"
                                />
                                {brand === 'cardstreet' ? (
                                    <StatTile
                                        label="Site visits from social" value={data?.ga4 ? compact(agg.kpi.siteSessions.now) : 'n/a'}
                                        delta={data?.ga4 && agg.kpi.siteSessions.now !== null && agg.kpi.siteSessions.prev ? pct(agg.kpi.siteSessions.now, agg.kpi.siteSessions.prev) : null}
                                        deltaLabel="vs previous period" sub={data?.ga4 ? 'GA4 sessions, cardstreet.app' : 'GA4 key not set on the server'}
                                    />
                                ) : (
                                    <StatTile
                                        label="Engagements" value={compact(agg.kpi.engagements.now)}
                                        delta={agg.kpi.engagements.now !== null && agg.kpi.engagements.prev !== null ? pct(agg.kpi.engagements.now, agg.kpi.engagements.prev) : null}
                                        deltaLabel="vs previous period" sub="likes + comments + shares + saves"
                                    />
                                )}
                            </div>

                            {tableView ? (
                                <DailyTable agg={agg} brand={brand} />
                            ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                    <FollowersChart agg={agg} />
                                    <StackedBars
                                        title="Views per day" sub="content views / plays"
                                        data={agg.viewsPerDay}
                                        platforms={agg.platforms.map((s) => s.platform)}
                                        empty={agg.viewsPerDay.every((d) => PLATFORMS.every((pl) => d[pl] === null || d[pl] === undefined)) ? 'No views recorded in this window yet.' : null}
                                    />
                                    <LinesChart
                                        title="Reach per day" sub="unique accounts reached (Facebook, Instagram)"
                                        data={agg.reachPerDay}
                                        platforms={agg.platforms.map((s) => s.platform).filter((pl) => REPORTS[pl].reach)}
                                        empty={agg.platforms.some((s) => REPORTS[s.platform].reach) ? (agg.reachPerDay.every((d) => PLATFORMS.every((pl) => d[pl] === null || d[pl] === undefined)) ? 'No reach recorded in this window yet.' : null) : 'YouTube and TikTok do not report reach through their APIs.'}
                                    />
                                    {brand === 'cardstreet' ? (
                                        <StackedBars
                                            title="Visits to cardstreet.app from social" sub="GA4 sessions by referring platform"
                                            data={agg.trafficPerDay}
                                            platforms={PLATFORMS.filter((pl) => agg.platforms.some((s) => s.platform === pl) || agg.trafficPerDay.some((d) => Number(d[pl]) > 0))}
                                            empty={!data?.ga4 ? 'Add GA4_PROPERTY_ID + GA4_SA_KEY_JSON on the server to see which platform sends visitors.' : (agg.trafficPerDay.every((d) => PLATFORMS.every((pl) => !d[pl])) ? 'No social-referred sessions in this window.' : null)}
                                        />
                                    ) : (
                                        <LinesChart
                                            title="Link clicks per day" sub="profile link + CTA taps (Facebook, Instagram)"
                                            data={agg.clicksPerDay}
                                            platforms={agg.platforms.map((s) => s.platform).filter((pl) => REPORTS[pl].link_clicks)}
                                            empty={agg.platforms.some((s) => REPORTS[s.platform].link_clicks) ? (agg.clicksPerDay.every((d) => PLATFORMS.every((pl) => d[pl] === null || d[pl] === undefined)) ? 'No link taps recorded in this window yet.' : null) : 'Only Facebook and Instagram report link taps.'}
                                        />
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                {agg.platforms.map((s) => <PlatformCard key={s.platform} s={s} windowLabel={windowLabel} />)}
                            </div>

                            <TopPosts posts={agg.topPosts} windowLabel={windowLabel} />
                        </>
                    )}

                    <Connections
                        brand={brand}
                        accounts={data?.accounts ?? []}
                        providers={data?.providers ?? { meta: false, youtube: false, tiktok: false }}
                        ga4={Boolean(data?.ga4)}
                        busy={busyAccount}
                        onPatch={patchAccount}
                        onDisconnect={disconnect}
                    />
                </div>
            ) : null}
        </div>
    )
}

function PlatformCard({ s, windowLabel }: { s: PlatformSummary; windowLabel: string }) {
    const a = s.accounts[0]
    const Row = ({ label, value }: { label: string; value: number | null }) => (
        <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">{label}</span>
            <span className={`font-bold tabular-nums ${value === null ? 'text-slate-600' : 'text-white'}`}>{value === null ? 'n/a' : value.toLocaleString()}</span>
        </div>
    )
    return (
        <div className="glass rounded-2xl border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-3">
                {a?.avatar_url ? (
                    <img src={a.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover bg-white/5" />
                ) : (
                    <div className="w-9 h-9 rounded-full" style={{ backgroundColor: PLATFORM_COLOR[s.platform] }} />
                )}
                <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        <PlatformKey platform={s.platform} />{PLATFORM_LABEL[s.platform]}
                        {s.accounts.length > 1 && <span className="text-slate-600">x{s.accounts.length}</span>}
                    </p>
                    {a?.profile_url ? (
                        <a href={a.profile_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-white hover:text-brand-cyan truncate block">
                            {a.display_name || a.handle || a.external_id}
                        </a>
                    ) : (
                        <p className="text-sm font-bold text-white truncate">{a?.display_name || a?.handle || a?.external_id}</p>
                    )}
                </div>
            </div>
            <div>
                <p className="text-2xl font-black text-white leading-none">{compact(s.followersNow)}</p>
                <p className="text-[10px] text-slate-500 mt-1">
                    followers
                    {s.followersDelta !== null && (
                        <span className="ml-1.5 font-bold" style={{ color: s.followersDelta >= 0 ? UP_GOOD : DOWN_BAD }}>{signed(s.followersDelta)}</span>
                    )}
                </p>
            </div>
            <div className="space-y-1 border-t border-white/5 pt-3">
                <Row label={`Reach, ${windowLabel}`} value={s.totals.reach} />
                <Row label="Views" value={s.totals.views} />
                <Row label="Link clicks" value={s.totals.link_clicks} />
                <Row label="Engagements" value={s.totals.engagements} />
                <Row label="Posts" value={s.postsInWindow} />
            </div>
            <p className="text-[10px] text-slate-600">Synced {relative(s.lastSynced)}</p>
            {s.errors.length > 0 && (
                <p className="text-[10px] text-yellow-300/90 break-words">{s.errors.join(' | ')}</p>
            )}
        </div>
    )
}

function TopPosts({ posts, windowLabel }: { posts: Aggregate['topPosts']; windowLabel: string }) {
    return (
        <div className="glass rounded-2xl border border-white/10 p-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 className="text-sm font-black text-white">Top posts</h2>
                <p className="text-[10px] text-slate-500">published in the {windowLabel}, by views</p>
            </div>
            {posts.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No posts in this window yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                                <th className="py-2 pr-3 font-black">Post</th>
                                <th className="py-2 px-3 font-black text-right">Views</th>
                                <th className="py-2 px-3 font-black text-right">Reach</th>
                                <th className="py-2 px-3 font-black text-right">Likes</th>
                                <th className="py-2 px-3 font-black text-right">Comments</th>
                                <th className="py-2 pl-3 font-black text-right">Shares</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {posts.map((p) => (
                                <tr key={`${p.account_id}:${p.external_id}`} className="hover:bg-white/[0.02]">
                                    <td className="py-2 pr-3">
                                        <div className="flex items-center gap-3 min-w-[240px]">
                                            {p.thumbnail_url ? (
                                                <img src={p.thumbnail_url} alt="" className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0" />
                                            ) : (
                                                <div className="w-10 h-10 rounded-lg bg-white/5 shrink-0" />
                                            )}
                                            <div className="min-w-0">
                                                <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                                    <PlatformKey platform={p.platform} />
                                                    {PLATFORM_LABEL[p.platform]}
                                                    {p.published_at && <span>· {shortDay(p.published_at.slice(0, 10))}</span>}
                                                    {p.media_type && <span className="uppercase">· {p.media_type}</span>}
                                                </p>
                                                {p.permalink ? (
                                                    <a href={p.permalink} target="_blank" rel="noreferrer" className="text-white font-bold hover:text-brand-cyan line-clamp-1">
                                                        {p.caption?.trim() || '(no caption)'}
                                                    </a>
                                                ) : (
                                                    <p className="text-white font-bold line-clamp-1">{p.caption?.trim() || '(no caption)'}</p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    {[p.views, p.reach, p.likes, p.comments, p.shares].map((v, i) => (
                                        <td key={i} className={`py-2 ${i === 4 ? 'pl-3' : 'px-3'} text-right tabular-nums ${v === null ? 'text-slate-600' : 'text-slate-200'}`}>
                                            {v === null ? '—' : v.toLocaleString()}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

/** The charts' table twin: one row per day per platform. */
function DailyTable({ agg, brand }: { agg: Aggregate; brand: Brand }) {
    const rows: { day: string; platform: Platform; followers: number | null; reach: number | null; views: number | null; clicks: number | null; site: number | null }[] = []
    for (let i = agg.days.length - 1; i >= 0; i--) {
        const day = agg.days[i]
        for (const s of agg.platforms) {
            rows.push({
                day,
                platform: s.platform,
                followers: (agg.perDay[i][s.platform] as number | null) ?? null,
                reach: REPORTS[s.platform].reach ? (agg.reachPerDay[i][s.platform] as number | null) ?? null : null,
                views: (agg.viewsPerDay[i][s.platform] as number | null) ?? null,
                clicks: REPORTS[s.platform].link_clicks ? (agg.clicksPerDay[i][s.platform] as number | null) ?? null : null,
                site: brand === 'cardstreet' ? (agg.trafficPerDay[i][s.platform] as number | null) ?? null : null,
            })
        }
    }
    const cell = (v: number | null) => (
        <td className={`py-1.5 px-3 text-right tabular-nums ${v === null ? 'text-slate-600' : 'text-slate-200'}`}>{v === null ? 'n/a' : v.toLocaleString()}</td>
    )
    return (
        <div className="glass rounded-2xl border border-white/10 p-5 overflow-x-auto">
            <h2 className="text-sm font-black text-white mb-3">Daily figures</h2>
            <table className="w-full text-xs">
                <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-slate-500 text-left">
                        <th className="py-2 px-3 font-black">Day</th>
                        <th className="py-2 px-3 font-black">Platform</th>
                        <th className="py-2 px-3 font-black text-right">Followers</th>
                        <th className="py-2 px-3 font-black text-right">Reach</th>
                        <th className="py-2 px-3 font-black text-right">Views</th>
                        <th className="py-2 px-3 font-black text-right">Link clicks</th>
                        {brand === 'cardstreet' && <th className="py-2 px-3 font-black text-right">Site visits</th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {rows.map((r) => (
                        <tr key={`${r.day}:${r.platform}`}>
                            <td className="py-1.5 px-3 text-slate-300 tabular-nums">{r.day}</td>
                            <td className="py-1.5 px-3 text-slate-300"><span className="flex items-center gap-1.5"><PlatformKey platform={r.platform} />{PLATFORM_LABEL[r.platform]}</span></td>
                            {cell(r.followers)}{cell(r.reach)}{cell(r.views)}{cell(r.clicks)}
                            {brand === 'cardstreet' && cell(r.site)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function Connections({ brand, accounts, providers, ga4, busy, onPatch, onDisconnect }: {
    brand: Brand
    accounts: Account[]
    providers: Record<Provider, boolean>
    ga4: boolean
    busy: string | null
    onPatch: (id: string, patch: { brand?: Brand; enabled?: boolean }) => void
    onDisconnect: (a: Account) => void
}) {
    return (
        <div className="glass rounded-2xl border border-white/10 p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-black text-white">Connections</h2>
                <p className="text-[10px] text-slate-500">one sign-in per platform; the 08:30 Bangkok cron pulls every day</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {PROVIDERS.filter((prov) =>
                    // TikTok is parked (founder, 2026-10-06): its card appears only once the server
                    // has its keys or an account was connected, so the panel stays about FB / IG / YT.
                    prov.key !== 'tiktok' || providers.tiktok || accounts.some((a) => a.platform === 'tiktok'),
                ).map((prov) => {
                    const rows = accounts.filter((a) => a.brand === brand && PLATFORM_PROVIDER[a.platform] === prov.key)
                    const configured = providers[prov.key]
                    return (
                        <div key={prov.key} className="rounded-xl border border-white/5 bg-black/20 p-4 space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-black text-white flex items-center gap-2">
                                    {prov.platforms.map((pl) => <PlatformKey key={pl} platform={pl} />)}
                                    {prov.label}
                                </p>
                                {configured ? (
                                    <a
                                        href={`/api/admin/social/connect/${prov.key}/start?brand=${brand}`}
                                        className="px-2.5 py-1 text-[10px] font-black uppercase text-brand-cyan bg-brand-cyan/10 border border-brand-cyan/20 rounded-lg hover:bg-brand-cyan/20 transition"
                                    >
                                        {rows.length ? 'Reconnect' : 'Connect'}
                                    </a>
                                ) : (
                                    <span
                                        className="px-2.5 py-1 text-[10px] font-black uppercase text-slate-500 bg-white/5 border border-white/10 rounded-lg cursor-not-allowed"
                                        title="Add the app credentials on the server first — see docs/social-dashboard.md"
                                    >
                                        Not configured
                                    </span>
                                )}
                            </div>
                            {rows.length === 0 ? (
                                <p className="text-[11px] text-slate-500">
                                    {configured
                                        ? `No ${prov.label} account under ${BRANDS.find((b) => b.key === brand)?.label}.`
                                        : 'Server is missing this provider\'s app keys.'}
                                </p>
                            ) : rows.map((a) => (
                                <div key={a.id} className={`rounded-lg border border-white/5 p-3 space-y-2 ${busy === a.id ? 'opacity-50' : ''}`}>
                                    <div className="flex items-center gap-2">
                                        {a.avatar_url ? <img src={a.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover bg-white/5" /> : <span className="w-7 h-7 rounded-full" style={{ backgroundColor: PLATFORM_COLOR[a.platform] }} />}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-bold text-white truncate">{a.display_name || a.handle || a.external_id}</p>
                                            <p className="text-[10px] text-slate-500 truncate">
                                                {PLATFORM_LABEL[a.platform]}{a.handle ? ` · @${a.handle.replace(/^@/, '')}` : ''} · synced {relative(a.last_synced_at)}
                                            </p>
                                        </div>
                                        {!a.has_token && !a.parent_account_id && (
                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-brand-red/20 text-brand-red border border-brand-red/30">no token</span>
                                        )}
                                        {!a.enabled && (
                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400 border border-slate-500/30">paused</span>
                                        )}
                                    </div>
                                    {a.last_sync_error && (
                                        <p className="text-[10px] text-yellow-300/90 break-words">{a.last_sync_error}</p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="text-[10px] text-slate-500 flex items-center gap-1.5">
                                            Brand
                                            <select
                                                value={a.brand}
                                                disabled={busy === a.id || Boolean(a.parent_account_id)}
                                                onChange={(e) => onPatch(a.id, { brand: e.target.value as Brand })}
                                                className="bg-white/5 border border-white/10 rounded-md px-1.5 py-0.5 text-[10px] text-white disabled:opacity-50"
                                                title={a.parent_account_id ? 'Follows its Facebook Page' : 'Move this account to the other brand'}
                                            >
                                                {BRANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                                            </select>
                                        </label>
                                        <button
                                            type="button"
                                            disabled={busy === a.id}
                                            onClick={() => onPatch(a.id, { enabled: !a.enabled })}
                                            className="px-2 py-0.5 text-[10px] font-bold text-slate-300 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition disabled:opacity-40"
                                        >
                                            {a.enabled ? 'Pause' : 'Resume'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy === a.id}
                                            onClick={() => onDisconnect(a)}
                                            className="px-2 py-0.5 text-[10px] font-bold text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-md hover:bg-brand-red/20 transition disabled:opacity-40"
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                })}
            </div>
            <p className="text-[10px] text-slate-600">
                Site visits from social: {ga4 ? 'GA4 connected (sessions by referring platform, Cardstreet only).' : 'GA4 key not on the server — add GA4_PROPERTY_ID and GA4_SA_KEY_JSON to see which platform sends visitors to cardstreet.app.'}
                {' '}YouTube does not expose reach, profile views or link clicks through its API; those read n/a by design. TikTok is parked for now.
            </p>
        </div>
    )
}
