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
        // Flash pushes webhooks as application/x-www-form-urlencoded (their
        // API-wide convention). This handler used to call request.json()
        // unconditionally, so every real push threw, fell into the catch-all,
        // and was acknowledged with 200 "success" — silently dropping every
        // event Flash ever sent. Parse both encodings.
        const payload = await parseWebhookBody(request)
        if (!payload) {
            console.warn('[FlashWebhook] Unparseable body')
            return NextResponse.json({ errorCode: '1', state: 'success' })
        }

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

        // The event rides in `data` — an object when the body was JSON, a
        // JSON string when it was form-encoded — or in a `dataJson` string.
        // Accept all three so the freight webhooks are not dropped.
        const data = (typeof payload.data === 'object' && payload.data !== null)
            ? payload.data
            : parseDataJson(payload.data) ?? parseDataJson(payload.dataJson)
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

        // Find the shipping labels by tracking number. shipping_fee is what the
        // buyer was charged up front — needed to compute the reconciliation delta.
        //
        // A waybill covers MANY orders, not one: fulfillment creates a single
        // Flash shipment per seller per cart and writes a shipping_labels row
        // for EVERY order in that group, all carrying the same pno. This lookup
        // used to end in `.single()`, so a multi-item cart made PostgREST fail
        // with PGRST116 ("multiple rows returned") — which this handler read as
        // "no matching shipment" and reported as a waybill divergence. Every
        // status event for a multi-item cart was therefore dropped, and those
        // orders only advanced when the hourly reconcile-shipments cron caught
        // up. Read all matching rows and advance each order.
        const { data: labels, error: labelError } = await supabase
            .from('shipping_labels')
            .select('*, orders!inner(id, status, buyer_id, seller_id, shipping_fee)')
            .eq('tracking_number', pno)

        if (labelError) {
            // A DB-side failure is transient, not a mapping problem — 500 so
            // Flash retries rather than us dropping a real event.
            console.error('[FlashWebhook] shipping_labels lookup failed:', labelError.message)
            Sentry.captureException(new Error(`Flash webhook label lookup failed: ${labelError.message}`), {
                extra: { pno, state: data.state },
            })
            return NextResponse.json({ errorCode: '0', error: 'Lookup failed' }, { status: 500 })
        }

        const orders = (labels ?? [])
            .map(l => (l as any).orders)
            .filter((o): o is { id: string; status: string; buyer_id: string; seller_id: string; shipping_fee: number | null } => !!o)

        if (orders.length === 0) {
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

            // Update order status (only move forward). currentIdx must be ON
            // the ladder — cancelled/disputed orders index to -1 and must not
            // be resurrected to delivered by a late carrier event. CAS on the
            // status we read so a concurrent advance (reconcile cron, buyer
            // confirm) is skipped instead of clobbered/re-notified.
            const statusOrder = ['pending', 'pending_payment', 'paid', 'awaiting_shipping_payment', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed']
            const newIdx = statusOrder.indexOf(orderStatus)

            // One parcel, one notification. Every order under this waybill
            // belongs to the same buyer (a cart is grouped by seller), so
            // notifying per order would mail the buyer N times for the single
            // box they received.
            let notified = false
            // Collect rather than return early: a failure on one order must not
            // abandon its siblings. Flash retries on the 500 and the forward-only
            // guard makes the already-advanced ones no-ops.
            let updateFailed: { orderId: string; message: string } | null = null

            for (const order of orders) {
                const currentIdx = statusOrder.indexOf(order.status)
                if (currentIdx < 0 || newIdx <= currentIdx) continue

                const updateData: any = { status: orderStatus }
                if (orderStatus === 'delivered') {
                    updateData.delivered_at = new Date().toISOString()
                    // Set funds release timer (delivery + 48 hours)
                    const releaseAt = new Date()
                    releaseAt.setHours(releaseAt.getHours() + 48)
                    updateData.funds_release_at = releaseAt.toISOString()
                }

                const { data: applied, error: orderUpdateError } = await supabase
                    .from('orders')
                    .update(updateData)
                    .eq('id', order.id)
                    .eq('status', order.status)
                    .select('id')

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
                    updateFailed = { orderId: order.id, message: orderUpdateError.message }
                    continue
                }

                if (!applied || applied.length === 0) {
                    // CAS miss: another path advanced the order first — its
                    // notification already went out, don't duplicate it.
                    console.log(`[FlashWebhook] Order ${order.id}: status changed concurrently, skipping ${orderStatus}`)
                    continue
                }

                console.log(`[FlashWebhook] Order ${order.id} updated: ${order.status} → ${orderStatus}`)

                // Fire notifications for significant status changes
                if (notified) continue
                try {
                    const { sendShippedNotification, sendPackageDeliveredNotification } = await import('@/lib/courier')

                    if (orderStatus === 'delivered') {
                        // Notify buyer that package was delivered (Task 3 requirement)
                        await sendPackageDeliveredNotification(
                            order.buyer_id,
                            order.id,
                            pno
                        )
                        notified = true
                    } else if (orderStatus === 'out_for_delivery') {
                        // Keep using shipped notification for 'out for delivery' as a fallback
                        await sendShippedNotification(
                            order.buyer_id,
                            { id: order.id, total_amount: 0 },
                            pno
                        )
                        notified = true
                    }
                } catch (notifError) {
                    console.error('[FlashWebhook] Notification error (non-fatal):', notifError)
                }
            }

            if (updateFailed) {
                return NextResponse.json({ errorCode: '0', error: 'Order update failed' }, { status: 500 })
            }
        }

        // ─── Freight reconciliation (weight code 1, price code 2) ───
        // Freight is assessed once for the PARCEL. Attribute it to the order
        // that actually carries the buyer's shipping charge (the primary order
        // of the seller group) — the siblings have shipping_fee 0, so running
        // this for each would record the full freight as an under-quote and
        // fire a bogus "freight exceeded the quote" alert per sibling.
        const freightOrder = orders.find(o => Number(o.shipping_fee || 0) > 0) ?? orders[0]
        await reconcileFreight(supabase, freightOrder, data)

        return NextResponse.json({ errorCode: '1', state: 'success' })

    } catch (error: any) {
        console.error('[FlashWebhook] Error processing webhook:', error)
        // Still return success to prevent infinite retries for malformed data
        return NextResponse.json({ errorCode: '1', state: 'success' })
    }
}

/**
 * Reads the webhook body as JSON or form-urlencoded, whichever parses.
 * Flash's pushes are form-encoded; JSON support is kept for manual testing
 * and in case Flash ever switches.
 */
async function parseWebhookBody(request: NextRequest): Promise<Record<string, any> | null> {
    const raw = await request.text()
    if (!raw || raw.trim() === '') return null
    try {
        return JSON.parse(raw)
    } catch {
        // Not JSON — try form encoding
    }
    const obj: Record<string, any> = {}
    for (const [k, v] of new URLSearchParams(raw)) obj[k] = v
    return Object.keys(obj).length > 0 ? obj : null
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
