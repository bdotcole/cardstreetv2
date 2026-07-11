import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

        // Manually-fulfilled orders have no Flash waybill to poll.
        if (label.tracking_number === 'MANUAL') {
            return NextResponse.json({ error: 'No carrier tracking for this order' }, { status: 404 })
        }

        // Call Flash Express tracking API
        const tracking = await trackShipment(label.tracking_number)

        // Flash state 0 = waybill created, no scans yet. mapFlashStateToStatus
        // falls through to 'shipped' for unknown states, so mapping state 0
        // would advance an order that hasn't been picked up. Report tracking
        // as-is without writing.
        if (!tracking.state || Number.isNaN(tracking.state)) {
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
                    status: label.status,
                    pickupStatus: label.pickup_status,
                },
            })
        }

        // Update local status based on Flash Express data
        const { shippingStatus, orderStatus } = mapFlashStateToStatus(tracking.state)

        // Status writes go through the admin client: RLS locks buyers (and,
        // since 20260515, sellers) out of updating orders/shipping_labels, so
        // the session-client updates here were silent 0-row no-ops. Authz on
        // this route already happened above.
        const admin = createAdminClient()

        // Update shipping_labels status
        if (label.status !== shippingStatus) {
            await admin
                .from('shipping_labels')
                .update({ status: shippingStatus, updated_at: new Date().toISOString() })
                .eq('order_id', orderId)
        }

        // Update order status if it progressed forward. Mirrors the webhook /
        // reconcile-cron transition, including the 48h escrow release timer —
        // without funds_release_at a delivered order never releases funds.
        // currentIdx must be ON the ladder: cancelled/disputed orders index to
        // -1 and would otherwise be resurrected to delivered by any Flash
        // state, releasing escrow on an order support already pulled.
        const statusOrder = ['pending', 'pending_payment', 'paid', 'awaiting_shipping_payment', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed']
        const currentIdx = statusOrder.indexOf(order.status)
        const newIdx = statusOrder.indexOf(orderStatus)
        let appliedOrderStatus = order.status
        if (currentIdx >= 0 && newIdx > currentIdx) {
            const updateData: any = { status: orderStatus }
            if (orderStatus === 'delivered') {
                // delivered_at records the carrier's actual delivery moment;
                // the escrow window runs from DISCOVERY (now), not from that
                // moment — on a late catch-up stateChangeAt+48h can already be
                // in the past, which would release funds before the buyer even
                // learns the parcel arrived.
                const deliveredAt = tracking.stateChangeAt ? new Date(tracking.stateChangeAt * 1000) : new Date()
                updateData.delivered_at = deliveredAt.toISOString()
                updateData.funds_release_at = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
            }
            // CAS on the status we read: if the webhook, the cron, or the
            // buyer's confirm-delivery advanced the order while we awaited
            // Flash, this update matches 0 rows instead of clobbering it.
            const { data: applied } = await admin
                .from('orders')
                .update(updateData)
                .eq('id', orderId)
                .eq('status', order.status)
                .select('id')
            if (applied && applied.length > 0) appliedOrderStatus = orderStatus
        }

        return NextResponse.json({
            tracking: {
                pno: tracking.pno,
                state: tracking.state,
                stateText: tracking.stateText,
                lastUpdate: tracking.stateChangeAt,
                routes: tracking.routes,
            },
            // The client sweeps compare this to their cached order to decide
            // whether to refetch — label status alone misses order-only moves.
            order: { status: appliedOrderStatus },
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
