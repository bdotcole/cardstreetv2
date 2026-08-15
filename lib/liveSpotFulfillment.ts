/**
 * Live-breaks payment finalization (server-only).
 *
 * Why this exists apart from lib/fulfillOrder.ts: marketplace fulfillment
 * mints a per-order Flash waybill + pickup, but live-break spot orders ship
 * NOTHING at payment time — parcels are consolidated per buyer at stream
 * settle. Routing a `live_*` transfer_group through the marketplace path
 * would create phantom shipments; routing a marketplace group through here
 * would strand it unshipped. lib/stripeWebhook.ts branches on the
 * transfer_group prefix to keep the two rails apart.
 *
 * This module is the SINGLE implementation of spot finalization. Both the
 * client-driven /api/live/spots/finalize route and the Stripe webhook call
 * finalizeLiveSpotOrders — the webhook path is what closes the PromptPay
 * double-sell window (an async payment succeeding after the buyer closed the
 * app still flips the spot server-side).
 *
 * Idempotent end to end: the order CAS decides who announces, and
 * finalize_break_spot is CAS-guarded in SQL, so duplicate webhook deliveries
 * and a webhook/finalize-route race are both no-op re-runs.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { postSystemChat } from '@/lib/liveBreaks';

interface LiveSpotOrderRow {
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    break_spot_id: string | null;
}

export interface LiveFinalizeResult {
    success: boolean;
    ordersPaid: number;
    alreadyPaid: number;
    errors: string[];
}

/**
 * Finalize every spot order in a `live_*` transfer_group after its
 * PaymentIntent succeeded: CAS pending_payment -> paid, flip each spot
 * held -> sold via the finalize_break_spot RPC, announce new sales in chat.
 *
 * The caller is responsible for having verified the payment (Stripe webhook
 * signature, or an explicit PaymentIntent retrieve in the finalize route).
 */
export async function finalizeLiveSpotOrders(
    transferGroup: string,
    paymentId: string,
): Promise<LiveFinalizeResult> {
    const result: LiveFinalizeResult = {
        success: false,
        ordersPaid: 0,
        alreadyPaid: 0,
        errors: [],
    };

    try {
        const admin = createAdminClient();

        const { data: orders, error: fetchErr } = await admin
            .from('orders')
            .select('id, buyer_id, seller_id, status, break_spot_id')
            .eq('transfer_group', transferGroup)
            .returns<LiveSpotOrderRow[]>();

        if (fetchErr) {
            result.errors.push(`order fetch failed: ${fetchErr.message}`);
            return result;
        }

        const allOrders = orders ?? [];
        // A live_ group is minted exclusively by /api/live/spots/checkout, so
        // every row must carry break_spot_id. A row without one is corrupt
        // data and must never be flipped or finalized here.
        const spotOrders = allOrders.filter(
            (o): o is LiveSpotOrderRow & { break_spot_id: string } => o.break_spot_id !== null,
        );
        if (spotOrders.length !== allOrders.length) {
            result.errors.push(
                `${allOrders.length - spotOrders.length} order(s) in ${transferGroup} lack break_spot_id — skipped`,
            );
        }
        if (spotOrders.length === 0) {
            console.warn(`[LiveSpotFulfillment] No spot orders for transfer_group ${transferGroup}`);
            result.success = result.errors.length === 0;
            return result;
        }

        // A cancelled order in a PAID group means the buyer paid a superseded
        // duplicate-checkout group (e.g. an old PromptPay QR). The spot must
        // NOT finalize against it — the replacement group owns the spot — and
        // ops must refund. Surface loudly.
        const cancelledOrders = spotOrders.filter(o => o.status === 'cancelled');
        if (cancelledOrders.length > 0) {
            result.errors.push(
                `${cancelledOrders.length} cancelled order(s) in paid group ${transferGroup} — ` +
                'superseded duplicate checkout was paid; manual refund required',
            );
        }

        // ─── CAS flip: only rows still pending become paid ───
        const { data: newlyPaid, error: flipErr } = await admin
            .from('orders')
            .update({
                status: 'paid',
                payment_id: paymentId,
                updated_at: new Date().toISOString(),
            })
            .in('id', spotOrders.map(o => o.id))
            .eq('status', 'pending_payment')
            .select('id, break_spot_id')
            .returns<{ id: string; break_spot_id: string }[]>();

        if (flipErr) {
            result.errors.push(`order flip failed: ${flipErr.message}`);
            return result;
        }

        const newlyPaidRows = newlyPaid ?? [];
        const newlyPaidIds = new Set(newlyPaidRows.map(o => o.id));
        result.ordersPaid = newlyPaidRows.length;
        result.alreadyPaid = spotOrders.filter(o => o.status === 'paid').length;

        // ─── held -> sold via the idempotent RPC ───
        // Run for already-'paid' rows too: it heals a prior partial run where
        // the order flipped but the spot didn't. Cancelled rows are excluded
        // (see above); rows another worker is concurrently flipping are
        // finalized by that worker.
        const finalizable = spotOrders.filter(
            o => o.status === 'paid' || newlyPaidIds.has(o.id),
        );
        for (const order of finalizable) {
            const { data, error } = await admin.rpc('finalize_break_spot', {
                p_spot_id: order.break_spot_id,
                p_buyer_id: order.buyer_id,
                p_order_id: order.id,
            });
            if (error) {
                result.errors.push(`${order.break_spot_id}: ${error.message}`);
            } else if ((data as { finalized?: boolean } | null)?.finalized !== true) {
                // Hold lapsed and someone else took the spot — money is
                // captured for a spot the buyer no longer holds. Surface
                // loudly for ops; refund is a manual path for the beta.
                result.errors.push(`${order.break_spot_id}: not finalized (hold lost?)`);
            }
        }

        // ─── Announce newly sold spots (once, via the CAS winners) ───
        if (newlyPaidRows.length > 0) {
            const buyerId = spotOrders[0].buyer_id;
            const sellerId = spotOrders[0].seller_id;
            const spotIds = newlyPaidRows.map(o => o.break_spot_id);
            const [{ data: spots }, { data: buyerProfile }] = await Promise.all([
                admin
                    .from('break_spots')
                    .select('id, stream_id, spot_number')
                    .in('id', spotIds)
                    .returns<{ id: string; stream_id: string; spot_number: number }[]>(),
                admin
                    .from('profiles')
                    .select('display_name')
                    .eq('id', buyerId)
                    .maybeSingle<{ display_name: string | null }>(),
            ]);
            const buyerName = buyerProfile?.display_name || 'buyer';
            for (const spot of spots ?? []) {
                await postSystemChat(
                    spot.stream_id,
                    sellerId,
                    `Spot ${spot.spot_number} -> @${buyerName}`,
                );
            }
        }

        result.success = result.errors.length === 0;
        return result;
    } catch (err: any) {
        console.error('[LiveSpotFulfillment] fatal:', err);
        result.errors.push(`fatal: ${err?.message ?? err}`);
        return result;
    }
}

/**
 * Finalize a `liveship_*` (consolidated shipping-fee) order: CAS the fee
 * order paid and move its shipment awaiting_shipping_fee -> pending. Nothing
 * else — the Flash label is minted later from the seller console, never here.
 *
 * LEGACY: settle stopped minting liveship_ fee orders with
 * 20260816_first_checkout_shipping (shipping is now collected at spot
 * checkout). Kept so fee orders already issued under the old model still
 * flip their shipment when the buyer pays.
 */
export async function finalizeLiveShippingFeeOrder(
    transferGroup: string,
    paymentId: string,
): Promise<LiveFinalizeResult> {
    const result: LiveFinalizeResult = {
        success: false,
        ordersPaid: 0,
        alreadyPaid: 0,
        errors: [],
    };

    try {
        const admin = createAdminClient();

        const { data: paidRows, error: flipErr } = await admin
            .from('orders')
            .update({
                status: 'paid',
                payment_id: paymentId,
                updated_at: new Date().toISOString(),
            })
            .eq('transfer_group', transferGroup)
            .eq('status', 'pending_payment')
            .select('id')
            .returns<{ id: string }[]>();

        if (flipErr) {
            result.errors.push(`fee order flip failed: ${flipErr.message}`);
            return result;
        }
        result.ordersPaid = paidRows?.length ?? 0;

        // The settle route mints the group as `liveship_${shipments.id}`.
        const shipmentId = transferGroup.slice('liveship_'.length);
        // CAS on awaiting_shipping_fee so a duplicate webhook delivery can
        // never regress a shipment that already advanced (label_created...).
        const { error: shipErr } = await admin
            .from('shipments')
            .update({ status: 'pending' })
            .eq('id', shipmentId)
            .eq('status', 'awaiting_shipping_fee');
        if (shipErr) {
            result.errors.push(`shipment status update failed: ${shipErr.message}`);
            return result;
        }

        result.success = true;
        return result;
    } catch (err: any) {
        console.error('[LiveSpotFulfillment] shipping-fee fatal:', err);
        result.errors.push(`fatal: ${err?.message ?? err}`);
        return result;
    }
}
