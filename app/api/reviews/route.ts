import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { fetchPublicSellers } from '@/lib/publicProfiles'
import { checkRateLimit } from '@/lib/rateLimit'

// POST /api/reviews -- the buyer reviews a delivered or completed order on its own,
// without re-confirming delivery. /api/orders/complete still accepts a review at
// confirmation time; this covers the orders that completed by themselves (the
// 48h auto-release) or that the buyer confirmed without rating. One review per
// order; posting again edits it. Same trigger recomputes the seller aggregate.
export async function POST(request: NextRequest) {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rl = await checkRateLimit(`review:${user.id}:1d`, { windowSeconds: 86400, max: 20 })
    if (!rl.allowed) return NextResponse.json({ error: 'Too many reviews today' }, { status: 429 })

    const body = await request.json().catch(() => ({}))
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    const rating = Math.round(Number(body?.rating))
    const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 2000) : ''
    if (!orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    if (!(rating >= 1 && rating <= 5)) return NextResponse.json({ error: 'rating must be 1 to 5' }, { status: 400 })

    const admin = createAdminClient()
    const { data: order } = await admin
        .from('orders')
        .select('id, buyer_id, seller_id, status, listing_id')
        .eq('id', orderId)
        .maybeSingle()
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (order.buyer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!['delivered', 'completed'].includes(order.status)) {
        return NextResponse.json({ error: 'You can review once the order is delivered', code: 'NOT_REVIEWABLE' }, { status: 400 })
    }

    let itemName: string | null = null
    if (order.listing_id) {
        const { data: listingRow } = await admin.from('listings').select('card_data').eq('id', order.listing_id).maybeSingle()
        itemName = (listingRow?.card_data as { name?: string } | null)?.name ?? null
    }

    const { data: review, error } = await admin
        .from('reviews')
        .upsert(
            {
                order_id: orderId,
                reviewer_id: user.id,
                seller_id: order.seller_id,
                rating,
                comment: comment || null,
                item_name: itemName,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'order_id' },
        )
        .select('rating, comment')
        .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ review })
}

// GET /api/reviews?seller_id=<uuid> — public list of a seller's reviews, newest
// first, mapped into the client `Review` shape consumed by ReviewList. Every
// review is tied to a delivered order, so they're all verified purchases.
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const sellerId = searchParams.get('seller_id')
    if (!sellerId) {
        return NextResponse.json({ error: 'seller_id is required' }, { status: 400 })
    }
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    const supabase = await createClient()
    const { data, error } = await supabase
        .from('reviews')
        .select(`
            id,
            rating,
            comment,
            item_name,
            created_at,
            reviewer_id
        `)
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
        .limit(limit)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Reviewer display name/avatar come from the public_profiles view (the base
    // table no longer allows cross-user reads, so a reviewer:profiles(...) embed
    // would null out). Identity (reviewer_id) is still never returned to clients.
    const reviewerMap = await fetchPublicSellers(supabase, (data || []).map((r: any) => r.reviewer_id))
    const reviews = (data || []).map((r: any) => {
        const reviewer = reviewerMap.get(r.reviewer_id)
        return {
            id: r.id,
            reviewerId: '',
            reviewerName: reviewer?.display_name || 'CardStreet buyer',
            reviewerAvatar: reviewer?.avatar_url || '',
            rating: r.rating,
            comment: r.comment || '',
            date: r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
            verifiedPurchase: true,
            itemName: r.item_name || undefined,
        }
    })

    return NextResponse.json(
        { reviews },
        { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    )
}
