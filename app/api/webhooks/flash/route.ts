import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { verifyWebhookSignature, mapFlashStateToStatus } from '@/lib/flashExpress'

/**
 * Flash Express Webhook Receiver
 *
 * Receives status, routes, weight, and price webhooks from Flash Express.
 * Must respond with { "errorCode": "1", "state": "success" } on success.
 *
 * Two independent concerns are handled per delivery:
 *   - Status (code 0): forward order/shipping status (picked up → delivered).
 *   - Freight reconciliation (weight code 1, price code 2): record the ACTUAL
 *     weight/freight Flash assessed at the depot vs. the up-front estimate the
 *     buyer paid, so an under-quote is visible instead of silently absorbed.
 * A single delivery is one type; running both is harmless (a status webhook
 * carries no weight/price fields, a price webhook carries no forward state).
 *
 * Register this URL in Flash Express for all five event types via
 * POST /api/admin/setup-flash-webhooks:
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

        // Flash posts the body either as a parsed `data` object or as a
        // `dataJson` string (the signed form). Accept both so the freight
        // webhooks — which may only ship `dataJson` — are not dropped.
        const data = payload.data ?? parseDataJson(payload.dataJson)
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

        // Find the shipping label by tracking number. shipping_fee is what the
        // buyer was charged up front — needed to compute the reconciliation delta.
        const { data: label, error: labelError } = await supabase
            .from('shipping_labels')
            .select('*, orders!inner(id, status, buyer_id, seller_id, shipping_fee)')
            .eq('tracking_number', pno)
            .single()

        if (labelError || !label) {
            // An unmatched pno means Flash is sending us real events for a
            // waybill we don't have on any order — which is exactly how a
            // waybill divergence (e.g. a duplicate shipment created for one
            // order, where the DB stored a different pno than the one that
            // actually shipped) stays invisible. Alert instead of silently
            // dropping it. Still 200 so Flash doesn't retry a pno we can't map.
            console.warn('[FlashWebhook] No matching shipment for pno:', pno)
            Sentry.captureMessage(
                `Flash webhook for unmatched pno ${pno} — no shipping_labels row. Possible waybill divergence.`,
                { level: 'warning', extra: { pno, state: data.state, stateText: data.stateText } },
            )
            return NextResponse.json({ errorCode: '1', state: 'success' })
        }

        const order = (label as any).orders

        // ─── Status transition (code 0) ───
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

                const { error: orderUpdateError } = await supabase
                    .from('orders')
                    .update(updateData)
                    .eq('id', order.id)

                if (orderUpdateError) {
                    // A silent failure here is how a delivered parcel stays
                    // "not delivered" forever (e.g. a missing delivered_at /
                    // funds_release_at column made the whole update error). Make
                    // it loud so the status pipeline can't rot unnoticed.
                    console.error(`[FlashWebhook] Order ${order.id} status update failed:`, orderUpdateError.message)
                    Sentry.captureException(new Error(`Flash webhook order status update failed: ${orderUpdateError.message}`), {
                        level: 'error',
                        extra: { orderId: order.id, from: order.status, to: orderStatus, updateData },
                    })
                    return NextResponse.json({ errorCode: '0', error: 'Order update failed' }, { status: 500 })
                }

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

        // ─── Freight reconciliation (weight code 1, price code 2) ───
        await reconcileFreight(supabase, order, data)

        return NextResponse.json({ errorCode: '1', state: 'success' })

    } catch (error: any) {
        console.error('[FlashWebhook] Error processing webhook:', error)
        // Still return success to prevent infinite retries for malformed data
        return NextResponse.json({ errorCode: '1', state: 'success' })
    }
}

/** Parse Flash's `dataJson` string form into an object; null on failure. */
function parseDataJson(dataJson: unknown): Record<string, any> | null {
    if (typeof dataJson !== 'string' || dataJson.trim() === '') return null
    try {
        return JSON.parse(dataJson)
    } catch {
        return null
    }
}

/** First numeric-looking value among the candidate keys, or null. */
function pickNumber(obj: Record<string, any>, keys: string[]): number | null {
    for (const k of keys) {
        const v = obj?.[k]
        if (v === undefined || v === null || v === '') continue
        const n = Number(v)
        if (!Number.isNaN(n)) return n
    }
    return null
}

/**
 * Records the actual freight/weight Flash reports after measuring a parcel.
 *
 * Flash sends these AFTER the buyer has already paid the estimate, so the
 * difference (shipping_fee_delta) is a platform cost we want visible rather
 * than silently eaten. We read several candidate field names and stash the raw
 * payload because Flash's weight/price callbacks aren't documented field-for-
 * field here — the first real payloads in the logs / shipping_reconciliation_raw
 * confirm the exact shape, and the candidate lists below can be trimmed then.
 *
 * Money is assumed to be satang (Flash's API convention — estimate_rate returns
 * "2800" for ฿28); the stored raw payload lets us correct that if a real
 * payload proves otherwise. Weight is grams (what createShipment declares).
 *
 * Writes are best-effort: if the reconciliation columns don't exist yet (the
 * 20260630 migration hasn't been applied), we log and move on rather than 500
 * the webhook into a Flash retry storm.
 */
async function reconcileFreight(
    supabase: SupabaseClient,
    order: { id: string; shipping_fee: number | null },
    data: Record<string, any>,
): Promise<void> {
    const actualSatang = pickNumber(data, [
        'price', 'totalPrice', 'expressPrice', 'freight', 'freightAmount',
        'amount', 'actualPrice', 'fee', 'shippingFee',
    ])
    const actualGrams = pickNumber(data, [
        'weight', 'actualWeight', 'weightValue', 'realWeight',
    ])

    // Neither a price nor a weight webhook — nothing to reconcile.
    if (actualSatang === null && actualGrams === null) return

    const update: Record<string, any> = {
        shipping_reconciliation_raw: data,
        updated_at: new Date().toISOString(),
    }

    if (actualGrams !== null) update.actual_weight_grams = Math.round(actualGrams)

    let delta: number | null = null
    if (actualSatang !== null) {
        const actualFee = actualSatang / 100
        const charged = Number(order.shipping_fee || 0)
        delta = Number((actualFee - charged).toFixed(2))
        update.actual_shipping_fee = actualFee
        update.shipping_fee_delta = delta
    }

    const { error } = await supabase.from('orders').update(update).eq('id', order.id)
    if (error) {
        console.error(
            '[FlashWebhook] Freight reconciliation update failed ' +
            '(has the 20260630 migration been applied?):',
            error.message,
        )
        return
    }

    console.log(`[FlashWebhook] Reconciled freight for order ${order.id}:`, JSON.stringify(update))

    // Surface a real under-quote (> ฿1 over tolerance). The location estimate is
    // accurate, so a positive delta almost always means the seller shipped an
    // oversized box that tripped Flash's dimension-based pricing — visibility
    // here lets the team spot repeat offenders / nudge packaging.
    if (delta !== null && delta > 1) {
        Sentry.captureMessage(
            `Flash freight exceeded the quoted shipping for order ${order.id} by ฿${delta}`,
            {
                level: 'warning',
                extra: {
                    orderId: order.id,
                    chargedShippingFee: order.shipping_fee,
                    actualShippingFee: update.actual_shipping_fee,
                    delta,
                },
            },
        )
    }
}
