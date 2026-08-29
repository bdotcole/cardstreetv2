import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

const PAGE_SIZE = 50
const STATUS_FILTERS = ['active', 'draft', 'sold', 'cancelled', 'removed', 'all']

// GET /api/admin/listings — moderation browser over all listings.
// ?status=active|draft|sold|cancelled|removed|all  (default active)
// ?search=<card name substring>
// ?seller=<seller profile id>  (deep-linked from the reports page)
// ?page=N
export async function GET(request: Request) {
    const gate = await requireAdmin()
    if (gate) return gate

    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1)
    const search = (searchParams.get('search') ?? '').trim()
    const seller = (searchParams.get('seller') ?? '').trim()
    const statusParam = searchParams.get('status') ?? 'active'
    const status = STATUS_FILTERS.includes(statusParam) ? statusParam : 'active'
    const offset = (page - 1) * PAGE_SIZE

    let query = supabase
        .from('listings')
        .select('id, seller_id, card_id, status, price, condition, is_graded, grading_company, grade, created_at, image_front_url, card_data', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)

    if (status !== 'all') query = query.eq('status', status)
    if (seller) query = query.eq('seller_id', seller)
    if (search) query = query.ilike('card_data->>name', `%${search}%`)

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = data ?? []

    // Seller profiles for the page (select('*') tolerates the ban-columns
    // migration not having run yet).
    const sellerIds = [...new Set(rows.map(l => l.seller_id).filter(Boolean))]
    const profileMap = new Map<string, Record<string, unknown>>()
    if (sellerIds.length > 0) {
        const { data: profiles, error: profilesErr } = await supabase
            .from('profiles')
            .select('*')
            .in('id', sellerIds)
        if (profilesErr) return NextResponse.json({ error: profilesErr.message }, { status: 500 })
        for (const p of profiles ?? []) profileMap.set(p.id, p)
    }

    const listings = rows.map(l => {
        const cardData = (l.card_data ?? null) as { name?: string; images?: { small?: string }; imageUrl?: string } | null
        const p = profileMap.get(l.seller_id)
        return {
            id: l.id,
            card_id: l.card_id,
            status: l.status,
            price: l.price,
            condition: l.condition,
            is_graded: l.is_graded,
            grading_company: l.grading_company,
            grade: l.grade,
            created_at: l.created_at,
            card_name: cardData?.name ?? null,
            catalog_image: cardData?.images?.small ?? cardData?.imageUrl ?? null,
            photo_front: l.image_front_url ?? null,
            seller: p ? {
                id: l.seller_id,
                display_name: (p.display_name as string) ?? null,
                username: (p.username as string) ?? null,
                banned_at: (p.banned_at as string) ?? null,
            } : { id: l.seller_id, display_name: null, username: null, banned_at: null },
        }
    })

    return NextResponse.json({ listings, total: count ?? 0, pageSize: PAGE_SIZE })
}
