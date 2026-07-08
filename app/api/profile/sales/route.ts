import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Order statuses that represent a real (paid) sale. Everything before `paid`
// (`pending`, `pending_payment`) is a pre-payment reservation and must NOT
// appear in Sales History; `cancelled` is excluded by omission.
const SOLD_ORDER_STATUSES = [
    'paid',
    'label_generated',
    'processing',
    'shipped',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'completed',
    'disputed',
] as const

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

        // A "sale" is an order the buyer actually PAID for. `pending_payment`
        // (and `pending`) are pre-payment reservations — an abandoned checkout
        // sits at `pending_payment` forever (payment never completed, no Stripe
        // charge, no fulfillment). Listing only the paid-and-beyond statuses
        // keeps those phantom rows out of Sales History; `cancelled` is excluded
        // by omission. (An abandoned pending_payment order used to surface here
        // as a fake sale with a 1/1/1970 date — see the date fallback below.)
        const { data: sales, error, count } = await supabase
            .from('orders')
            .select(`
                id,
                total_amount,
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
            .in('status', SOLD_ORDER_STATUSES)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) throw error

        // Calculate total earnings
        const { data: totals } = await supabase
            .from('orders')
            .select('total_amount, platform_fee')
            .eq('seller_id', user.id)
            .eq('status', 'completed')

        const totalEarnings = totals?.reduce((sum, t) => sum + (t.total_amount - (t.platform_fee || 0)), 0) || 0

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
