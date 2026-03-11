import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// GET /api/admin/downloads — download analytics data
export async function GET() {
    const supabase = createAdminClient()

    // Top 10 partners by total_downloads
    const { data: topPartners, error: topErr } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, total_downloads, partner_level, partner_fee')
        .eq('role', 'partner')
        .order('total_downloads', { ascending: false })
        .limit(10)

    if (topErr) return NextResponse.json({ error: topErr.message }, { status: 500 })

    // Downloads per day for the last 30 days (aggregated)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: dailyData, error: dailyErr } = await supabase
        .from('partner_downloads')
        .select('downloaded_at, partner_id')
        .gte('downloaded_at', thirtyDaysAgo.toISOString())
        .order('downloaded_at', { ascending: true })

    if (dailyErr) return NextResponse.json({ error: dailyErr.message }, { status: 500 })

    // Aggregate by day
    const dayMap: Record<string, number> = {}
    for (const row of dailyData ?? []) {
        const day = row.downloaded_at.slice(0, 10)
        dayMap[day] = (dayMap[day] ?? 0) + 1
    }

    // Fill in any missing days with 0
    const dailyDownloads: { date: string; downloads: number }[] = []
    for (let i = 29; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        dailyDownloads.push({ date: key, downloads: dayMap[key] ?? 0 })
    }

    // All partners summary for the leaderboard
    const { data: allPartners, error: allErr } = await supabase
        .from('profiles')
        .select('id, display_name, total_downloads, partner_level, partner_fee, partner_joined_at')
        .eq('role', 'partner')
        .order('total_downloads', { ascending: false })

    if (allErr) return NextResponse.json({ error: allErr.message }, { status: 500 })

    return NextResponse.json({ topPartners, dailyDownloads, allPartners })
}
