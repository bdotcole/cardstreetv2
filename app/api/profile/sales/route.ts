import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET - List user's sold items from transactions
export async function GET(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)
        const offset = (page - 1) * limit

        const { data: sales, error, count } = await supabase
            .from('transactions')
            .select(`
                id,
                amount,
                platform_fee,
                status,
                created_at,
                completed_at,
                listing:listings(
                    id,
                    card_data,
                    condition,
                    price,
                    is_graded,
                    grading_company,
                    grade
                )
            `, { count: 'exact' })
            .eq('seller_id', user.id)
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) throw error

        // Calculate total earnings
        const { data: totals } = await supabase
            .from('transactions')
            .select('amount, platform_fee')
            .eq('seller_id', user.id)
            .eq('status', 'completed')

        const totalEarnings = totals?.reduce((sum, t) => sum + (t.amount - (t.platform_fee || 0)), 0) || 0

        return NextResponse.json({
            sales: sales || [],
            totalEarnings,
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
