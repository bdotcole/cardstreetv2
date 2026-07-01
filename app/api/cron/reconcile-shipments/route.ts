/**
 * Reconciliation cron: a webhook-independent safety net for shipment status.
 *
 * The Flash status webhook is the primary path that advances an order
 * label_generated -> shipped -> ... -> delivered. But webhooks are lossy: an
 * event can be dropped (signature/clock skew), never sent, or arrive for a pno
 * we don't have on any order. When that happens the order freezes mid-flight,
 * the buyer never gets the delivered notification, and escrow never releases —
 * with no automatic recovery, because /api/orders/track only runs when a user
 * happens to open the tracking screen.
 *
 * This cron polls Flash /routes for every in-flight order that carries a real
 * waybill and advances it forward, mirroring the webhook's transition logic
 * (forward-only, delivered sets the 48h funds_release_at, notifications fire on
 * the transition this run actually makes so there's no double-send with the
 * webhook). Bounded by a wall-clock budget; overflow is picked up next run.
 *
 * nodejs runtime + CRON_SECRET bearer auth, matching the other crons.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { trackShipment, mapFlashStateToStatus } from '@/lib/flashExpress';
import { sendShippedNotification, sendPackageDeliveredNotification } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Order lifecycle used for forward-only comparison. Must match the webhook's.
const STATUS_ORDER = ['pending', 'pending_payment', 'paid', 'awaiting_shipping_payment', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed'];

// Statuses we consider still "in flight" — a shipment that may still progress.
const IN_FLIGHT = ['label_generated', 'shipped', 'in_transit', 'out_for_delivery'];

const TIME_BUDGET_MS = 100_000; // stop well before the 120s ceiling
const MAX_ORDERS = 200;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const started = Date.now();
    const summary = { scanned: 0, advanced: 0, delivered: 0, errors: 0 };

    // In-flight orders that carry a shipping label. Inner join so we only get
    // orders with a label row; we filter out placeholder/MANUAL pnos below.
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, status, buyer_id, seller_id, shipping_labels!inner(tracking_number, status)')
        .in('status', IN_FLIGHT)
        .limit(MAX_ORDERS);

    if (error) {
        Sentry.captureException(new Error(`reconcile-shipments query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const order of orders || []) {
        if (Date.now() - started > TIME_BUDGET_MS) break;

        const label = (order.shipping_labels as { tracking_number: string | null; status: string | null }[] | null)?.[0];
        const pno = label?.tracking_number;
        if (!pno || pno === 'MANUAL') continue;

        summary.scanned++;

        try {
            const tracking = await trackShipment(pno);
            // Flash state 0 = created but no scans yet — nothing to advance.
            if (!tracking.state || Number.isNaN(tracking.state)) continue;

            const { shippingStatus, orderStatus } = mapFlashStateToStatus(tracking.state);

            // Keep the shipping label's status current regardless of the order.
            if (label?.status !== shippingStatus) {
                await supabase.from('shipping_labels').update({ status: shippingStatus, updated_at: new Date().toISOString() }).eq('order_id', order.id);
            }

            const currentIdx = STATUS_ORDER.indexOf(order.status);
            const newIdx = STATUS_ORDER.indexOf(orderStatus);
            if (newIdx <= currentIdx) continue; // forward-only; already handled (e.g. by the webhook)

            const updateData: Record<string, unknown> = { status: orderStatus, updated_at: new Date().toISOString() };
            if (orderStatus === 'delivered') {
                const deliveredAt = tracking.stateChangeAt ? new Date(tracking.stateChangeAt * 1000) : new Date();
                updateData.delivered_at = deliveredAt.toISOString();
                updateData.funds_release_at = new Date(deliveredAt.getTime() + 48 * 3600 * 1000).toISOString();
            }

            const { error: upErr } = await supabase.from('orders').update(updateData).eq('id', order.id);
            if (upErr) {
                summary.errors++;
                Sentry.captureException(new Error(`reconcile-shipments order update failed: ${upErr.message}`), { extra: { orderId: order.id, orderStatus } });
                continue;
            }

            summary.advanced++;
            console.log(`[ReconcileShipments] Order ${order.id}: ${order.status} -> ${orderStatus} (pno ${pno})`);

            // Fire notifications only for the transition we just made, so we
            // never double-send with the webhook.
            try {
                if (orderStatus === 'delivered') {
                    summary.delivered++;
                    await sendPackageDeliveredNotification(order.buyer_id, order.id, pno);
                } else if (orderStatus === 'out_for_delivery') {
                    await sendShippedNotification(order.buyer_id, { id: order.id, total_amount: 0 }, pno);
                }
            } catch (notifErr) {
                console.error('[ReconcileShipments] Notification error (non-fatal):', notifErr);
            }
        } catch (err: unknown) {
            summary.errors++;
            console.error(`[ReconcileShipments] Track error for order ${order.id} (pno ${pno}):`, err instanceof Error ? err.message : err);
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
