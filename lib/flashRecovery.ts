/**
 * Single-order Flash shipment recovery.
 *
 * Used by the seller's self-serve "Print Label" route (/api/orders/[id]/label)
 * when an order has reached a shippable state without a usable
 * shipping_labels row. Since labels are minted by the seller (lib/parcels),
 * a 'paid' order with no label is the normal resting state of a fresh sale,
 * and this helper simply mints for that one order on demand. It never
 * double-mints: an existing real waybill is reused, and lib/parcels claims
 * the order before calling Flash.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { mintParcel } from '@/lib/parcels';

export interface RecoverableOrder {
    id: string;
    seller_id: string;
    buyer_id: string;
    transfer_group: string | null;
}

export type ShipmentRecoveryResult =
    | { ok: true; trackingNumber: string; created: boolean }
    | { ok: false; reason: 'profile_missing' | 'flash_error' | 'live_break_order'; error: string };

/**
 * Ensure `order` has a Flash waybill, creating one only if needed. Returns the
 * tracking number (reused or freshly minted). Never throws.
 */
export async function recoverShipmentForOrder(
    admin: SupabaseClient,
    order: RecoverableOrder,
): Promise<ShipmentRecoveryResult> {
    // Reuse an existing REAL waybill (a 'MANUAL' placeholder is a region-error
    // stand-in and is treated as "needs a real waybill", matching the prior
    // label-route behaviour).
    const { data: freshLabel } = await admin
        .from('shipping_labels')
        .select('tracking_number')
        .eq('order_id', order.id)
        .maybeSingle();
    const existing = freshLabel?.tracking_number || null;
    if (existing && existing !== 'MANUAL' && existing !== 'PENDING') {
        return { ok: true, trackingNumber: existing, created: false };
    }

    const result = await mintParcel(admin, { sellerId: order.seller_id, orderIds: [order.id] });
    if (result.ok) {
        return { ok: true, trackingNumber: result.trackingNumber, created: true };
    }
    const reason =
        result.code === 'LIVE_BREAK' ? 'live_break_order'
        : result.code === 'PROFILE_MISSING' ? 'profile_missing'
        : 'flash_error';
    return { ok: false, reason, error: result.error };
}
