import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PersonInfo {
    id: string
    display_name: string | null
    username: string | null
    email: string | null
    created_at: string | null
    banned_at: string | null
    banned_reason: string | null
    active_listings: number
}

// GET /api/admin/reports — all reports, enriched with reporter, the reported
// listing (live status + snapshot) and its seller, so moderation is one click.
//
// Deliberately avoids PostgREST FK-hinted joins: the old server page joined
// profiles(email) — a column that no longer exists — and the error was
// swallowed, rendering "No reports found" while reports sat in the table.
// Every query here surfaces its error.
export async function GET() {
    const gate = await requireAdmin()
    if (gate) return gate

    const supabase = createAdminClient()

    const { data: reports, error } = await supabase
        .from('reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = reports ?? []

    // The reported listings (for entity_type='listing')
    const listingIds = [...new Set(
        rows.filter(r => r.entity_type === 'listing' && UUID_RE.test(r.entity_id)).map(r => r.entity_id as string)
    )]
    const listingMap = new Map<string, Record<string, unknown>>()
    if (listingIds.length > 0) {
        const { data: listings, error: listingsErr } = await supabase
            .from('listings')
            .select('id, seller_id, card_id, status, price, condition, is_graded, grading_company, grade, created_at, image_front_url, image_back_url, card_data')
            .in('id', listingIds)
        if (listingsErr) return NextResponse.json({ error: listingsErr.message }, { status: 500 })
        for (const l of listings ?? []) listingMap.set(l.id, l)
    }

    // Everyone involved: reporters, listing sellers, directly-reported sellers
    const profileIds = new Set<string>()
    for (const r of rows) {
        if (UUID_RE.test(r.reporter_id)) profileIds.add(r.reporter_id)
        if (r.entity_type === 'seller' && UUID_RE.test(r.entity_id)) profileIds.add(r.entity_id)
    }
    for (const l of listingMap.values()) {
        if (typeof l.seller_id === 'string') profileIds.add(l.seller_id)
    }

    const profileMap = new Map<string, Record<string, unknown>>()
    let banColumnsPresent = true
    if (profileIds.size > 0) {
        // select('*') so this works with or without the ban-columns migration.
        const { data: profiles, error: profilesErr } = await supabase
            .from('profiles')
            .select('*')
            .in('id', [...profileIds])
        if (profilesErr) return NextResponse.json({ error: profilesErr.message }, { status: 500 })
        for (const p of profiles ?? []) profileMap.set(p.id, p)
        banColumnsPresent = (profiles ?? []).length === 0 || 'banned_at' in (profiles![0] as object)
    }

    // Emails live in auth.users, not profiles (removed in the PII-leak fix).
    const emailMap = new Map<string, string>()
    await Promise.all([...profileIds].slice(0, 100).map(async (id) => {
        const { data } = await supabase.auth.admin.getUserById(id)
        if (data?.user?.email) emailMap.set(id, data.user.email)
    }))

    // Live listing counts per involved seller
    const sellerIds = [...new Set([...listingMap.values()].map(l => l.seller_id as string)
        .concat(rows.filter(r => r.entity_type === 'seller' && UUID_RE.test(r.entity_id)).map(r => r.entity_id as string)))]
    const activeCount = new Map<string, number>()
    if (sellerIds.length > 0) {
        const { data: sellerListings } = await supabase
            .from('listings')
            .select('seller_id')
            .in('seller_id', sellerIds)
            .in('status', ['active', 'draft'])
        for (const l of sellerListings ?? []) {
            activeCount.set(l.seller_id, (activeCount.get(l.seller_id) ?? 0) + 1)
        }
    }

    const person = (id: string | null | undefined): PersonInfo | null => {
        if (!id) return null
        const p = profileMap.get(id)
        if (!p) return null
        return {
            id,
            display_name: (p.display_name as string) ?? null,
            username: (p.username as string) ?? null,
            email: emailMap.get(id) ?? null,
            created_at: (p.created_at as string) ?? null,
            banned_at: (p.banned_at as string) ?? null,
            banned_reason: (p.banned_reason as string) ?? null,
            active_listings: activeCount.get(id) ?? 0,
        }
    }

    const enriched = rows.map(r => {
        const listingRow = r.entity_type === 'listing' ? listingMap.get(r.entity_id) : undefined
        const cardData = (listingRow?.card_data ?? null) as { name?: string; images?: { small?: string; large?: string }; imageUrl?: string } | null
        return {
            id: r.id,
            created_at: r.created_at,
            status: r.status,
            reason: r.reason,
            description: r.description,
            entity_type: r.entity_type,
            entity_id: r.entity_id,
            entity_name: r.entity_name,
            reporter: person(r.reporter_id),
            listing: listingRow ? {
                id: listingRow.id,
                card_id: listingRow.card_id,
                status: listingRow.status,
                price: listingRow.price,
                condition: listingRow.condition,
                is_graded: listingRow.is_graded,
                grading_company: listingRow.grading_company,
                grade: listingRow.grade,
                created_at: listingRow.created_at,
                card_name: cardData?.name ?? r.entity_name ?? null,
                catalog_image: cardData?.images?.small ?? cardData?.imageUrl ?? null,
                photo_front: listingRow.image_front_url ?? null,
                photo_back: listingRow.image_back_url ?? null,
                seller: person(listingRow.seller_id as string),
            } : null,
            // For entity_type='seller' the reported account itself
            target_seller: r.entity_type === 'seller' ? person(r.entity_id) : null,
        }
    })

    return NextResponse.json({ reports: enriched, banColumnsPresent })
}
