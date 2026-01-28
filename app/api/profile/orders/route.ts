import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET - List user's orders with pagination
export async function GET(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status') // 'active' | 'completed' | null (all)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)
        const offset = (page - 1) * limit

        let query = supabase
            .from('orders')
            .select(`
                *,
                transaction:transactions(
                    amount,
                    listing:listings(
                        card_data,
                        condition
                    )
                )
            `, { count: 'exact' })
            .eq('buyer_id', user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        // Filter by status
        if (status === 'active') {
            query = query.in('status', ['processing', 'shipped', 'out_for_delivery'])
        } else if (status === 'completed') {
            query = query.in('status', ['delivered', 'cancelled'])
        }

        const { data: orders, error, count } = await query

        if (error) throw error

        return NextResponse.json({
            orders: orders || [],
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
