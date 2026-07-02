import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// POST - Dismiss a finished shipment from the seller's Pending Shipments
// panel (swipe on mobile, Clear on desktop). Only stamps seller_cleared_at —
// the order itself is untouched and stays in Sales History.
export async function POST(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { orderId } = await request.json()
        if (!orderId) {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
        }

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, seller_id, status')
            .eq('id', orderId)
            .single()

        if (orderError || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }
        if (order.seller_id !== user.id) {
            return NextResponse.json({ error: 'Unauthorized to modify this order' }, { status: 403 })
        }
        // Active shipments can't be dismissed — the panel is the seller's
        // to-do list until the parcel is in the buyer's hands.
        if (!['delivered', 'completed'].includes(order.status)) {
            return NextResponse.json(
                { error: 'Only delivered orders can be cleared' },
                { status: 400 }
            )
        }

        // Sellers have no UPDATE policy on orders (locked in
        // 20260515_lock_seller_order_updates) — stamp via service role after
        // the ownership check above.
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        const { error: updateError } = await admin
            .from('orders')
            .update({ seller_cleared_at: new Date().toISOString() })
            .eq('id', orderId)
            .eq('seller_id', user.id)

        if (updateError) throw updateError

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('[Shipments/Clear] Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
