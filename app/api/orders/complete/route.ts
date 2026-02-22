import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { orderId, reviewScore, reviewComment } = await request.json()

        if (!orderId) {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
        }

        // Verify ownership as buyer
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('buyer_id, seller_id, status')
            .eq('id', orderId)
            .single()

        if (orderError || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        if (order.buyer_id !== user.id) {
            return NextResponse.json({ error: 'Unauthorized to modify this order' }, { status: 403 })
        }

        if (order.status !== 'shipped' && order.status !== 'out_for_delivery' && order.status !== 'delivered') {
            return NextResponse.json({ error: 'Order is not ready to be completed' }, { status: 400 })
        }

        // Complete the order
        const { error: updateError } = await supabase
            .from('orders')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                escrow_status: 'released' // Real system would have an escrow webhook or background worker
            })
            .eq('id', orderId)

        if (updateError) throw updateError

        // Process review if provided
        if (reviewScore) {
            // Note: In a real system you would write to a `reviews` table
            // and trigger an RPC to update the seller profile's average rating.
            // For now, this is a placeholder acknowledging the review payload.
            console.log(`Review received for Seller ${order.seller_id}: ${reviewScore}/5 - ${reviewComment}`);
        }

        return NextResponse.json({ success: true })

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
