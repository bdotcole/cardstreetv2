import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { trackShipment, mapFlashStateToStatus } from '@/lib/flashExpress'

export async function GET(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        const orderId = searchParams.get('orderId')

        if (!orderId) {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
        }

        // Verify the user is buyer or seller on this order
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, buyer_id, seller_id, status')
            .eq('id', orderId)
            .single()

        if (orderError || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 })
        }

        if (order.buyer_id !== user.id && order.seller_id !== user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        }

        // Get the shipping label with tracking number
        const { data: label, error: labelError } = await supabase
            .from('shipping_labels')
            .select('*')
            .eq('order_id', orderId)
            .single()

        if (labelError || !label) {
            return NextResponse.json({ error: 'No shipping info found for this order' }, { status: 404 })
        }

        // Call Flash Express tracking API
        const tracking = await trackShipment(label.tracking_number)

        // Update local status based on Flash Express data
        const { shippingStatus, orderStatus } = mapFlashStateToStatus(tracking.state)

        // Update shipping_labels status
        if (label.status !== shippingStatus) {
            await supabase
                .from('shipping_labels')
                .update({ status: shippingStatus })
                .eq('order_id', orderId)
        }

        // Update order status if it progressed forward
        const statusOrder = ['paid', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed']
        const currentIdx = statusOrder.indexOf(order.status)
        const newIdx = statusOrder.indexOf(orderStatus)
        if (newIdx > currentIdx) {
            const updateData: any = { status: orderStatus }
            if (orderStatus === 'delivered') {
                updateData.delivered_at = new Date().toISOString()
            }
            await supabase
                .from('orders')
                .update(updateData)
                .eq('id', orderId)
        }

        return NextResponse.json({
            tracking: {
                pno: tracking.pno,
                state: tracking.state,
                stateText: tracking.stateText,
                lastUpdate: tracking.stateChangeAt,
                routes: tracking.routes,
            },
            label: {
                carrier: label.carrier_name,
                trackingNumber: label.tracking_number,
                labelUrl: label.label_url,
                trackingUrl: label.courier_tracking_url,
                status: shippingStatus,
                pickupStatus: label.pickup_status,
            },
        })

    } catch (error: any) {
        console.error('[Track] Flash Express tracking error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
