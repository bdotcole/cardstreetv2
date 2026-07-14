import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { fetchPublicSellers } from '@/lib/publicProfiles'

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
