import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature, mapFlashStateToStatus } from '@/lib/flashExpress'

/**
 * Flash Express Webhook Receiver
 * 
 * Receives status, routes, weight, and price webhooks from Flash Express.
 * Must respond with { "errorCode": "1", "state": "success" } on success.
 * 
 * Register this URL in Flash Express dashboard:
 *   https://cardstreet.app/api/webhooks/flash
 */
export async function POST(request: NextRequest) {
    try {
        const payload = await request.json()

        console.log('[FlashWebhook] Received:', JSON.stringify(payload).substring(0, 500))

        // Verify signature. Return 401 on failure — Flash retries on non-2xx,
        // which is what we want for a transient credential / clock-skew issue.
        // Returning 200 here silently dropped real events.
        if (!verifyWebhookSignature(payload)) {
            console.warn('[FlashWebhook] Invalid signature')
            return NextResponse.json({ errorCode: '0', error: 'Invalid signature' }, { status: 401 })
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        const data = payload.data
        if (!data) {
            console.warn('[FlashWebhook] No data in payload')
            return NextResponse.json({ errorCode: '1', state: 'success' })
        }

        // The pno identifies the shipment
        const pno = data.pno || data.recentPno
        if (!pno) {
            console.warn('[FlashWebhook] No pno in payload data')
            return NextResponse.json({ errorCode: '1', state: 'success' })
        }

        // Find the shipping label by tracking number
        const { data: label, error: labelError } = await supabase
            .from('shipping_labels')
            .select('*, orders!inner(id, status, buyer_id, seller_id)')
            .eq('tracking_number', pno)
            .single()

        if (labelError || !label) {
            console.warn('[FlashWebhook] No matching shipment for pno:', pno)
            // Still respond success so Flash doesn't retry
            return NextResponse.json({ errorCode: '1', state: 'success' })
        }

        // Determine webhook type and update accordingly
        const flashState = parseInt(data.state, 10)

        if (!isNaN(flashState)) {
            const { shippingStatus, orderStatus } = mapFlashStateToStatus(flashState)

            // Update shipping label status
            await supabase
                .from('shipping_labels')
                .update({
                    status: shippingStatus,
                    updated_at: new Date().toISOString(),
                })
                .eq('tracking_number', pno)

            // Update order status (only move forward)
            const statusOrder = ['pending', 'paid', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed']
            const order = (label as any).orders
            const currentIdx = statusOrder.indexOf(order.status)
            const newIdx = statusOrder.indexOf(orderStatus)

            if (newIdx > currentIdx) {
                const updateData: any = { status: orderStatus }
                if (orderStatus === 'delivered') {
                    updateData.delivered_at = new Date().toISOString()
                    // Set funds release timer (delivery + 48 hours)
                    const releaseAt = new Date()
                    releaseAt.setHours(releaseAt.getHours() + 48)
                    updateData.funds_release_at = releaseAt.toISOString()
                }

                await supabase
                    .from('orders')
                    .update(updateData)
                    .eq('id', order.id)

                console.log(`[FlashWebhook] Order ${order.id} updated: ${order.status} → ${orderStatus}`)

                // Fire notifications for significant status changes
                try {
                    const { sendShippedNotification, sendPackageDeliveredNotification } = await import('@/lib/courier')
                    
                    if (orderStatus === 'delivered') {
                        // Notify buyer that package was delivered (Task 3 requirement)
                        await sendPackageDeliveredNotification(
                            order.buyer_id,
                            order.id,
                            pno
                        )
                    } else if (orderStatus === 'out_for_delivery') {
                        // Keep using shipped notification for 'out for delivery' as a fallback
                        await sendShippedNotification(
                            order.buyer_id,
                            { id: order.id, total_amount: 0 },
                            pno
                        )
                    }
                } catch (notifError) {
                    console.error('[FlashWebhook] Notification error (non-fatal):', notifError)
                }
            }
        }

        return NextResponse.json({ errorCode: '1', state: 'success' })

    } catch (error: any) {
        console.error('[FlashWebhook] Error processing webhook:', error)
        // Still return success to prevent infinite retries for malformed data
        return NextResponse.json({ errorCode: '1', state: 'success' })
    }
}
