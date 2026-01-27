import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)

    // Fetch recent listings with seller profile
    const { data: listings, error } = await supabase
        .from('listings')
        .select(`
      *,
      seller:profiles(display_name, avatar_url, is_verified_shop, partner_tier)
    `)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(limit)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(listings)
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    // Verify auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json()

        // Basic validation
        if (!body.card_id || !body.price || !body.condition) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const { data: listing, error } = await supabase
            .from('listings')
            .insert({
                seller_id: user.id,
                card_id: body.card_id,
                card_data: body.card_data, // Snapshot of card details
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
