import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET - List user's active sales/shipments
export async function GET(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
        const offset = (page - 1) * limit

        const { data: shipments, error, count } = await supabase
            .from('orders')
            .select(`
                *,
                listing:listings(
                    card_data,
                    condition,
                    price
                ),
                shipping_labels(*)
            `, { count: 'exact' })
            .eq('seller_id', user.id)
            .in('status', ['paid', 'label_generated', 'shipped', 'out_for_delivery'])
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) throw error

        return NextResponse.json({
            shipments: shipments || [],
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit)
            }
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
