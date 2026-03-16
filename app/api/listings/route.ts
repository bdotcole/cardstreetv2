
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')
    const search = searchParams.get('search') || ''
    const language = searchParams.get('language') || ''
    const sort = searchParams.get('sort') || 'newest'
    const minPrice = parseFloat(searchParams.get('minPrice') || '0')
    const maxPrice = parseFloat(searchParams.get('maxPrice') || '0')

    let query = supabase
        .from('listings')
        .select(`
            id,
            seller_id,
            card_id,
            card_data,
            price,
            condition,
            is_graded,
            status,
            created_at,
            seller:profiles(id, display_name, avatar_url, partner_tier, rating)
        `)
        .eq('status', 'active')

    // Server-side filters
    if (search.trim()) {
        query = query.ilike('card_data->>name', `%${search.trim()}%`)
    }
    if (language && language !== 'all') {
        query = query.eq('card_data->>language', language)
    }
    if (minPrice > 0) query = query.gte('price', minPrice)
    if (maxPrice > 0 && maxPrice < 100000) query = query.lte('price', maxPrice)

    // Sort
    switch (sort) {
        case 'price_asc': query = query.order('price', { ascending: true }); break
        case 'price_desc': query = query.order('price', { ascending: false }); break
        default: query = query.order('created_at', { ascending: false })
    }

    query = query.range(offset, offset + limit - 1)

    const { data: listings, error } = await query

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(listings, {
        headers: {
            // Cache for 30s, serve stale for up to 60s while revalidating
            'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        }
    })
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json()

        if (!body.card_id || !body.price || !body.condition) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const { data: listing, error } = await supabase
            .from('listings')
            .insert({
                seller_id: user.id,
                card_id: body.card_id,
                card_data: body.card_data,
                price: body.price,
                condition: body.condition,
                is_graded: body.is_graded || false,
                grading_company: body.grading_company,
                grade: body.grade,
                status: 'active'
            })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(listing)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
