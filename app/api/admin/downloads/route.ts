import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

// GET /api/admin/downloads — download analytics data
//
// "Downloads" (the tier metric, profiles.total_downloads) blends three signals
// of very different confidence: confirmed Android installs (Play Install
// Referrer), iOS store visits (a tap through to the App Store — intent, not a
// confirmed install), and attributed signups. This route returns the blended
// count for continuity but also breaks it down per signal per partner, lists
// the accounts actually attributed to each partner (profiles.referred_by), and
// flags likely QR self-testing so a burst of partner test scans is legible
// rather than silently inflating a tier. None of this changes total_downloads.

type EventType = 'click' | 'install' | 'store_visit' | 'signup'

interface EventRow {
    partner_id: string
    event_type: EventType | string
    device_type: string | null
    downloaded_at: string
}

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
    // Read-only heuristic: count of events that fall inside a suspected QR
    // self-test burst (many events, mixed device types, within a short window).
    suspectedTestEvents: number
}

const emptyBreakdown = (): Breakdown => ({
    clicks: 0, installs: 0, storeVisits: 0, signups: 0,
    attributedAccounts: [], suspectedTestEvents: 0,
})

// Flags a partner's events that look like the partner testing their own QR:
// >= 3 events inside a 3-minute window spanning >= 2 distinct device types.
// Returns how many of the partner's events fall in such a cluster. Purely
// diagnostic — it never alters counts or tiers.
const BURST_WINDOW_MS = 3 * 60 * 1000
function countSuspectedTestEvents(rows: EventRow[]): number {
    if (rows.length < 3) return 0
    const sorted = [...rows].sort((a, b) => a.downloaded_at.localeCompare(b.downloaded_at))
    const flagged = new Set<number>()
    for (let i = 0; i < sorted.length; i++) {
        const windowIdx: number[] = []
        const devices = new Set<string>()
        const startMs = new Date(sorted[i].downloaded_at).getTime()
        for (let j = i; j < sorted.length; j++) {
            if (new Date(sorted[j].downloaded_at).getTime() - startMs > BURST_WINDOW_MS) break
            windowIdx.push(j)
            devices.add(sorted[j].device_type || 'unknown')
        }
        if (windowIdx.length >= 3 && devices.size >= 2) {
            for (const idx of windowIdx) flagged.add(idx)
        }
    }
    return flagged.size
}

export async function GET() {
    const gate = await requireAdmin()
    if (gate) return gate

    const supabase = createAdminClient()

    // All partners (leaderboard + used to attach per-partner breakdowns).
    const { data: allPartners, error: allErr } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, total_downloads, partner_level, partner_fee, partner_joined_at')
        .not('partner_joined_at', 'is', null)
        .order('total_downloads', { ascending: false })

    if (allErr) return NextResponse.json({ error: allErr.message }, { status: 500 })

    // Every partner_downloads event. The table is small (one row per click /
    // install / store visit / signup, deduped per device) so aggregating in JS
    // is cheap and lets us break the blended count down by signal.
    const { data: events, error: evErr } = await supabase
        .from('partner_downloads')
        .select('partner_id, event_type, device_type, downloaded_at')
        .order('downloaded_at', { ascending: true })

    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

    // Accounts actually attributed to a partner (the authoritative account
    // linkage — total_downloads counts events, referred_by counts humans).
    const { data: referred, error: refErr } = await supabase
        .from('profiles')
        .select('id, display_name, created_at, stripe_region, referred_by')
        .not('referred_by', 'is', null)

    if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 })

    // Aggregate events per partner.
    const rowsByPartner: Record<string, EventRow[]> = {}
    const eventTotals = { clicks: 0, installs: 0, storeVisits: 0, signups: 0 }
    for (const row of (events ?? []) as EventRow[]) {
        (rowsByPartner[row.partner_id] ??= []).push(row)
        if (row.event_type === 'click') eventTotals.clicks++
        else if (row.event_type === 'install') eventTotals.installs++
        else if (row.event_type === 'store_visit') eventTotals.storeVisits++
        else if (row.event_type === 'signup') eventTotals.signups++
    }

    const accountsByPartner: Record<string, ReferredAccount[]> = {}
    for (const acct of referred ?? []) {
        (accountsByPartner[(acct as any).referred_by] ??= []).push({
            id: acct.id,
            display_name: acct.display_name,
            created_at: acct.created_at,
            stripe_region: (acct as any).stripe_region ?? null,
        })
    }

    const breakdownFor = (partnerId: string): Breakdown => {
        const rows = rowsByPartner[partnerId] ?? []
        const b = emptyBreakdown()
        for (const r of rows) {
            if (r.event_type === 'click') b.clicks++
            else if (r.event_type === 'install') b.installs++
            else if (r.event_type === 'store_visit') b.storeVisits++
            else if (r.event_type === 'signup') b.signups++
        }
        b.attributedAccounts = (accountsByPartner[partnerId] ?? [])
            .sort((a, c) => (c.created_at ?? '').localeCompare(a.created_at ?? ''))
        b.suspectedTestEvents = countSuspectedTestEvents(rows)
        return b
    }

    const allWithBreakdown = (allPartners ?? []).map(p => ({
        ...p,
        breakdown: breakdownFor(p.id),
    }))
    const topPartners = allWithBreakdown.slice(0, 10)

    // Downloads-per-day for the last 30 days. Counts every signal that feeds
    // total_downloads (installs + attributed signups + iOS store visits), so
    // the trend matches the leaderboard number. Raw clicks are link-open
    // analytics and never count.
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const cutoff = thirtyDaysAgo.toISOString()

    const dayMap: Record<string, number> = {}
    for (const row of (events ?? []) as EventRow[]) {
        if (row.downloaded_at < cutoff) continue
        if (row.event_type === 'click') continue
        const day = row.downloaded_at.slice(0, 10)
        dayMap[day] = (dayMap[day] ?? 0) + 1
    }
    const dailyDownloads: { date: string; downloads: number }[] = []
    for (let i = 29; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        dailyDownloads.push({ date: key, downloads: dayMap[key] ?? 0 })
    }

    return NextResponse.json({
        topPartners,
        dailyDownloads,
        allPartners: allWithBreakdown,
        eventTotals,
    })
}
