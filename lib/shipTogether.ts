/**
 * One buyer, one seller, one parcel.
 *
 * A checkout is one payment group and, until now, always one Flash waybill.
 * A buyer who taps Buy Now twice, or checks out two carts minutes apart, gave
 * the seller two labels, two pickup tickets and two Flash fees for cards that
 * fit in one envelope. Two remedies live here, both working on the
 * shipping_labels rows only (payment groups stay separate: Stripe keys off
 * transfer_group and a merged parcel is still N sales):
 *
 *   - findMergeableWaybill: fulfillment asks for the buyer's most recent
 *     unshipped waybill from this seller, minted within AUTO_MERGE_WINDOW_MS,
 *     and attaches the new orders to it instead of minting another. Covers
 *     the rapid double Buy Now with no seller action. The window is short on
 *     purpose: the seller may have already printed, packed and sealed an
 *     older parcel, and nothing in our data says so until Flash scans it.
 *   - mergeParcels: the seller-initiated "Ship together". The seller is the
 *     one who physically hands parcels over, so they know what is still on
 *     the desk; no time window applies. The OLDEST waybill survives (its
 *     pickup is scheduled first and its label is the one most likely already
 *     printed); the newer ones are cancelled at Flash.
 *
 * Flash re-weighs every parcel at the depot and bills the sender the real
 * freight, so the surviving waybill's declared weight going stale is
 * harmless. A cancelled waybill's pickup ticket is left alone: our Flash
 * client has no per-ticket cancel and a courier calling once more costs
 * nothing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { cancelOrder } from '@/lib/flashExpress';
import { isRealWaybill } from '@/lib/orderGroups';

export const AUTO_MERGE_WINDOW_MS = 60 * 60 * 1000;

// The columns copied from the surviving waybill onto the merged orders.
const WAYBILL_COLS =
    'tracking_number, label_url, flash_order_id, flash_sort_code, pickup_id, pickup_status, courier_tracking_url, status, created_at';

export interface WaybillFields {
    tracking_number: string;
    label_url: string | null;
    flash_order_id: string | null;
    flash_sort_code: string | null;
    pickup_id: string | null;
    pickup_status: string | null;
    courier_tracking_url: string | null;
}

interface WaybillRow extends WaybillFields {
    status: string | null;
    created_at: string;
    order_id?: string;
    orders: OrderStub | OrderStub[] | null;
}

interface OrderStub {
    id: string;
    seller_id: string;
    buyer_id: string;
    status: string;
    break_spot_id: string | null;
}

function orderOf(row: WaybillRow): OrderStub | null {
    return Array.isArray(row.orders) ? row.orders[0] ?? null : row.orders;
}

/** A shipping_labels row that attaches `orderId` to an existing waybill. */
export function waybillRowFor(orderId: string, waybill: WaybillFields) {
    return {
        order_id: orderId,
        tracking_number: waybill.tracking_number,
        carrier_name: 'Flash Express',
        status: 'created',
        label_url: waybill.label_url || 'N/A',
        flash_order_id: waybill.flash_order_id,
        flash_sort_code: waybill.flash_sort_code,
        pickup_id: waybill.pickup_id,
        pickup_status: waybill.pickup_status,
        courier_tracking_url: waybill.courier_tracking_url,
    };
}

/**
 * The buyer's most recent waybill from this seller that is still waiting on
 * the seller's desk, or null. "Waiting" = the order is at 'label_generated'
 * and Flash has not scanned the parcel (label row still 'created').
 */
export async function findMergeableWaybill(
    admin: SupabaseClient,
    params: { sellerId: string; buyerId: string; windowMs?: number },
): Promise<(WaybillFields & { orderId: string }) | null> {
    const since = new Date(Date.now() - (params.windowMs ?? AUTO_MERGE_WINDOW_MS)).toISOString();
    try {
        const { data, error } = await admin
            .from('shipping_labels')
            .select(`${WAYBILL_COLS}, orders!inner(id, seller_id, buyer_id, status, break_spot_id)`)
            .eq('orders.seller_id', params.sellerId)
            .eq('orders.buyer_id', params.buyerId)
            .eq('orders.status', 'label_generated')
            .is('orders.break_spot_id', null)
            .eq('status', 'created')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(5);
        if (error || !data) {
            if (error) console.error('[ShipTogether] mergeable-waybill lookup failed:', error.message);
            return null;
        }
        for (const row of data as unknown as WaybillRow[]) {
            if (!isRealWaybill(row.tracking_number)) continue;
            const order = orderOf(row);
            if (!order?.id) continue;
            return {
                orderId: order.id,
                tracking_number: row.tracking_number,
                label_url: row.label_url,
                flash_order_id: row.flash_order_id,
                flash_sort_code: row.flash_sort_code,
                pickup_id: row.pickup_id,
                pickup_status: row.pickup_status,
                courier_tracking_url: row.courier_tracking_url,
            };
        }
        return null;
    } catch (err) {
        // Merging is an optimisation; a lookup hiccup must never block a sale.
        console.error('[ShipTogether] mergeable-waybill lookup threw:', err);
        return null;
    }
}

export type MergeParcelsResult =
    | {
          ok: true;
          keptTrackingNumber: string;
          cancelledTrackingNumbers: string[];
          flashCancelFailures: string[];
          orderIds: string[];
      }
    | { ok: false; status: number; code: string; error: string };

/**
 * Combine every parcel that covers `orderIds` into the oldest one. Expands
 * to ALL orders under each touched waybill so no sibling is left pointing at
 * a cancelled label. Refuses unless every one of them is this seller's, the
 * same buyer's, and still waiting on the desk.
 */
export async function mergeParcels(
    admin: SupabaseClient,
    params: { sellerId: string; orderIds: string[] },
): Promise<MergeParcelsResult> {
    const requested = [...new Set(params.orderIds.filter((id) => typeof id === 'string' && id.length > 0))];
    if (requested.length < 2) {
        return { ok: false, status: 400, code: 'NOT_ENOUGH_ORDERS', error: 'Pick at least two orders to ship together' };
    }

    const { data: seed, error: seedErr } = await admin
        .from('shipping_labels')
        .select('tracking_number, order_id')
        .in('order_id', requested);
    if (seedErr) {
        return { ok: false, status: 500, code: 'LOOKUP_FAILED', error: seedErr.message };
    }
    if (!seed || seed.length !== requested.length) {
        return { ok: false, status: 409, code: 'NOT_MERGEABLE', error: 'One of these orders has no shipping label yet' };
    }
    const allPnos = new Set(seed.map((r) => r.tracking_number));
    const pnos = [...allPnos].filter(isRealWaybill);
    if (pnos.length !== allPnos.size) {
        return { ok: false, status: 409, code: 'NOT_MERGEABLE', error: 'One of these orders needs a manual label' };
    }
    if (pnos.length < 2) {
        return { ok: false, status: 409, code: 'ALREADY_ONE_PARCEL', error: 'These orders already ship as one parcel' };
    }

    // Everything under the touched waybills, not just what the client named.
    const { data: rowsRaw, error: rowsErr } = await admin
        .from('shipping_labels')
        .select(`${WAYBILL_COLS}, order_id, orders!inner(id, seller_id, buyer_id, status, break_spot_id)`)
        .in('tracking_number', pnos);
    if (rowsErr || !rowsRaw) {
        return { ok: false, status: 500, code: 'LOOKUP_FAILED', error: rowsErr?.message || 'Lookup failed' };
    }
    const rows = rowsRaw as unknown as (WaybillRow & { order_id: string })[];

    const buyers = new Set<string>();
    for (const row of rows) {
        const order = orderOf(row);
        if (!order || order.seller_id !== params.sellerId) {
            return { ok: false, status: 403, code: 'FORBIDDEN', error: 'Not your order' };
        }
        if (order.break_spot_id) {
            return { ok: false, status: 409, code: 'NOT_MERGEABLE', error: 'Live-break orders ship with the break parcel' };
        }
        if (order.status !== 'label_generated' || (row.status && row.status !== 'created')) {
            return {
                ok: false,
                status: 409,
                code: 'NOT_MERGEABLE',
                error: 'A parcel Flash has already scanned, or one with no label yet, cannot be combined',
            };
        }
        buyers.add(order.buyer_id);
    }
    if (buyers.size !== 1) {
        return { ok: false, status: 409, code: 'DIFFERENT_BUYERS', error: 'Only parcels for the same buyer can ship together' };
    }

    // Oldest waybill wins: its pickup was booked first and its label is the
    // one most likely already printed.
    const byPno = new Map<string, (WaybillRow & { order_id: string })[]>();
    for (const row of rows) {
        const bucket = byPno.get(row.tracking_number) || [];
        bucket.push(row);
        byPno.set(row.tracking_number, bucket);
    }
    const ordered = [...byPno.entries()].sort((a, b) => {
        const ta = Math.min(...a[1].map((r) => Date.parse(r.created_at) || 0));
        const tb = Math.min(...b[1].map((r) => Date.parse(r.created_at) || 0));
        return ta - tb;
    });
    const [keptPno, keptRows] = ordered[0];
    const kept: WaybillFields = keptRows[0];
    const mergedOrderIds = ordered.slice(1).flatMap(([, rs]) => rs.map((r) => r.order_id));
    const cancelledPnos = ordered.slice(1).map(([pno]) => pno);

    // Repoint in the DB FIRST. If Flash's cancel then fails we hold an orphan
    // waybill nobody will scan; the reverse order could leave the seller
    // printing a label Flash has already voided.
    const { error: updErr } = await admin
        .from('shipping_labels')
        .update({
            tracking_number: kept.tracking_number,
            label_url: kept.label_url || 'N/A',
            flash_order_id: kept.flash_order_id,
            flash_sort_code: kept.flash_sort_code,
            pickup_id: kept.pickup_id,
            pickup_status: kept.pickup_status,
            courier_tracking_url: kept.courier_tracking_url,
            status: 'created',
            updated_at: new Date().toISOString(),
        })
        .in('order_id', mergedOrderIds);
    if (updErr) {
        return { ok: false, status: 500, code: 'UPDATE_FAILED', error: updErr.message };
    }

    const flashCancelFailures: string[] = [];
    for (const pno of cancelledPnos) {
        try {
            await cancelOrder(pno);
        } catch (err) {
            // The orphan waybill is inert (never scanned) but should be voided
            // by hand so it does not linger on the merchant account.
            flashCancelFailures.push(pno);
            console.error(`[ShipTogether] Flash cancel failed for ${pno}:`, err);
            Sentry.captureMessage('Ship-together: Flash waybill cancel failed', {
                level: 'warning',
                tags: { handler: 'ship-together' },
                extra: { pno, keptPno, sellerId: params.sellerId, error: (err as Error)?.message },
            });
        }
    }

    const allOrderIds = rows.map((r) => r.order_id);
    console.log(
        `[ShipTogether] seller ${params.sellerId}: ${cancelledPnos.join(', ')} folded into ${keptPno} ` +
            `(${allOrderIds.length} orders, ${flashCancelFailures.length} cancel failures)`,
    );
    return {
        ok: true,
        keptTrackingNumber: keptPno,
        cancelledTrackingNumbers: cancelledPnos,
        flashCancelFailures,
        orderIds: allOrderIds,
    };
}
