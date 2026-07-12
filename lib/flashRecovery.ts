/**
 * Shared single-order Flash shipment recovery.
 *
 * Used by BOTH the seller's self-serve "Print Label" route
 * (/api/orders/[id]/label) and the automatic recover-unshipped-orders cron, so
 * the "create a waybill for an order that reached a shippable state without a
 * usable shipping_labels row" logic lives in exactly one place.
 *
 * CAUTION: Flash does NOT treat outTradeNo as an idempotency key — a second
 * createShipment for the same order mints a *brand-new* pno (proven by order
 * 26126d8d's two live waybills WFAF97C / WKM1K5C). So we re-read the source of
 * truth immediately before minting and never overwrite an existing real
 * waybill. Parcel weight/dims are declared from the seller's whole transfer
 * group so a multi-item parcel isn't under-declared and re-rated at pickup.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
    createShipmentWithCityFallback,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
    type ParcelItemInfo,
} from '@/lib/flashExpress';

const SHIPPING_PROFILE_COLS =
    'id, display_name, phone_number, province, state, district, sub_district, postcode, address';

export interface RecoverableOrder {
    id: string;
    seller_id: string;
    buyer_id: string;
    transfer_group: string | null;
}

export type ShipmentRecoveryResult =
    | { ok: true; trackingNumber: string; created: boolean }
    | { ok: false; reason: 'profile_missing' | 'flash_error'; error: string };

/**
 * Ensure `order` has a Flash waybill, creating one only if needed. Returns the
 * tracking number (reused or freshly minted). Never throws — Flash / DB errors
 * are returned as a discriminated result the caller can act on.
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
    if (existing && existing !== 'MANUAL') {
        return { ok: true, trackingNumber: existing, created: false };
    }

    const { data: profiles } = await admin
        .from('profiles')
        .select(SHIPPING_PROFILE_COLS)
        .in('id', [order.seller_id, order.buyer_id]);
    const seller = profiles?.find(p => p.id === order.seller_id);
    const buyer = profiles?.find(p => p.id === order.buyer_id);
    if (!seller || !buyer) {
        return { ok: false, reason: 'profile_missing', error: 'Seller or buyer profile missing' };
    }

    // All of this seller's orders in the transfer group ride one waybill; sealed
    // products (booster boxes, ETBs) must declare their real weight rather than
    // fall back to the single-card default.
    let parcelItems: ParcelItemInfo[] = [];
    try {
        let q = admin
            .from('orders')
            .select('id, listing:listings(card_data)')
            .eq('seller_id', order.seller_id);
        q = order.transfer_group
            ? q.eq('transfer_group', order.transfer_group)
            : q.eq('id', order.id);
        const { data: groupOrders } = await q;
        parcelItems = (groupOrders || []).map(o => ({
            isSealed: (o as any).listing?.card_data?.isSealed === true,
            productType: (o as any).listing?.card_data?.productType ?? null,
        }));
    } catch {
        // fall through to single-card default below
    }
    if (parcelItems.length === 0) parcelItems = [{}];

    let flashOrder: Awaited<ReturnType<typeof createShipmentWithCityFallback>>;
    try {
        flashOrder = await createShipmentWithCityFallback({
            outTradeNo: order.id,
            srcName: seller.display_name || 'CardStreet Seller',
            srcPhone: seller.phone_number || '0000000000',
            srcProvinceName: seller.province || 'กรุงเทพมหานคร',
            srcCityName: seller.state || seller.district || 'เขตบางรัก',
            srcDistrictName: seller.sub_district || seller.district || 'บางรัก',
            srcPostalCode: seller.postcode || '10500',
            srcDetailAddress: seller.address || 'CardStreet Platform',
            dstName: buyer.display_name || 'CardStreet Buyer',
            dstPhone: buyer.phone_number || '0000000000',
            dstProvinceName: buyer.province || 'กรุงเทพมหานคร',
            dstCityName: buyer.state || buyer.district || 'เขตบางรัก',
            dstDistrictName: buyer.sub_district || buyer.district || 'บางรัก',
            dstPostalCode: buyer.postcode || '10500',
            dstDetailAddress: buyer.address || 'CardStreet Platform',
            weight: estimateParcelWeightGramsForItems(parcelItems),
            ...estimateParcelDimsCmForItems(parcelItems),
            expressCategory: 1,
            articleCategory: 3,
            remark: 'CardStreet TCG - Handle with care',
        });
    } catch (e: any) {
        return { ok: false, reason: 'flash_error', error: e?.message || 'Flash shipment creation failed' };
    }

    const courierTrackingUrl = `https://www.flashexpress.com/fle/tracking?se=${flashOrder.pno}`;
    const { error: upsertErr } = await admin
        .from('shipping_labels')
        .upsert(
            {
                order_id: order.id,
                tracking_number: flashOrder.pno,
                carrier_name: 'Flash Express',
                status: 'created',
                label_url: 'N/A',
                flash_order_id: flashOrder.outTradeNo,
                flash_sort_code: flashOrder.sortCode,
                pickup_id: null,
                pickup_status: 'pending',
                courier_tracking_url: courierTrackingUrl,
            },
            { onConflict: 'order_id' },
        );
    if (upsertErr) {
        // Not fatal — we have the pno. The next pass re-reads and reuses it.
        console.error('[FlashRecovery] label upsert failed:', upsertErr.message);
    }

    return { ok: true, trackingNumber: flashOrder.pno, created: true };
}
