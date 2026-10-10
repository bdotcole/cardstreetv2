/**
 * Parcels: the Flash waybill is minted when the SELLER is ready, not at
 * payment.
 *
 * Fulfilment used to create one waybill per seller per checkout the moment
 * the buyer paid. A buyer who bought twice from one seller (usually topping a
 * cart up to the shop minimum) then produced two labels, two pickup tickets
 * and two Flash fees for cards that fit one envelope, and folding them back
 * together meant cancelling waybills at Flash. Minting late dissolves all of
 * that: orders rest at 'paid' with no label until the seller presses Create
 * label, and at that moment the seller chooses what travels together.
 *
 *   - mintParcel: one waybill for a set of this seller's unlabelled orders
 *     from ONE buyer (one checkout, or several combined). Shipment, label
 *     PDF, pickup, label rows, status flip, label email.
 *   - attachToParcel: add unlabelled orders to a waybill of the same buyer
 *     that Flash has not scanned yet. No new waybill, nothing cancelled; the
 *     seller just puts more cards in the envelope.
 *
 * Both claim the orders first by inserting a PENDING shipping_labels row per
 * order (plain insert, so the UNIQUE order_id makes a concurrent second click
 * fail instead of minting a second waybill: Flash does not dedupe on
 * outTradeNo, and order 26126d8d once shipped under a waybill the DB never
 * stored). A claim older than CLAIM_STALE_MS is a crashed attempt and is
 * taken over. Flash re-weighs at the depot, so the declared weight only
 * needs to be a fair estimate for the whole parcel.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import {
    createShipmentWithCityFallback,
    generateLabel,
    requestPickup,
    isRegionError,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
    type ParcelItemInfo,
} from '@/lib/flashExpress';
import { sendLabelGeneratedNotification } from '@/lib/courier';
import { isRealWaybill } from '@/lib/orderGroups';

export const SHIPPING_PROFILE_COLS =
    'id, display_name, phone_number, province, state, district, sub_district, postcode, address';
export const PENDING_WAYBILL = 'PENDING';
const CLAIM_STALE_MS = 2 * 60 * 1000;
// Statuses an order can be labelled from. 'processing' is a legacy resting
// state some old rows still carry.
const LABEL_READY_STATUSES = ['paid', 'processing'];

export interface WaybillFields {
    tracking_number: string;
    label_url: string | null;
    flash_order_id: string | null;
    flash_sort_code: string | null;
    pickup_id: string | null;
    pickup_status: string | null;
    courier_tracking_url: string | null;
}

/** A shipping_labels row that puts `orderId` on an existing waybill. */
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

export type ParcelResult =
    | { ok: true; trackingNumber: string; orderIds: string[]; manual: boolean }
    | { ok: false; status: number; code: string; error: string };

type Fail = Extract<ParcelResult, { ok: false }>;
const fail = (status: number, code: string, error: string): Fail => ({ ok: false, status, code, error });

interface OrderRow {
    id: string;
    seller_id: string;
    buyer_id: string;
    status: string;
    break_spot_id: string | null;
    created_at: string;
    listing: { card_data: any } | { card_data: any }[] | null;
    shipping_labels: LabelStub | LabelStub[] | null;
}

interface LabelStub {
    tracking_number: string | null;
    status: string | null;
    created_at: string | null;
}

interface ProfileRow {
    id: string;
    display_name: string | null;
    phone_number: string | null;
    province: string | null;
    state: string | null;
    district: string | null;
    sub_district: string | null;
    postcode: string | null;
    address: string | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

function parcelItemsOf(orders: OrderRow[]): ParcelItemInfo[] {
    const items = orders.map((o) => {
        const cardData = one(o.listing)?.card_data;
        return {
            isSealed: cardData?.isSealed === true,
            productType: cardData?.productType ?? null,
        };
    });
    return items.length > 0 ? items : [{}];
}

function senderOf(p: ProfileRow) {
    return {
        srcName: p.display_name || 'Cardstreet Seller',
        srcPhone: p.phone_number || '0000000000',
        srcProvinceName: p.province || 'กรุงเทพมหานคร',
        srcCityName: p.state || p.district || 'เขตบางรัก',
        srcDistrictName: p.sub_district || p.district || 'บางรัก',
        srcPostalCode: p.postcode || '10500',
        srcDetailAddress: p.address || 'Cardstreet Platform',
    };
}

function recipientOf(p: ProfileRow) {
    return {
        dstName: p.display_name || 'Cardstreet Buyer',
        dstPhone: p.phone_number || '0000000000',
        dstProvinceName: p.province || 'กรุงเทพมหานคร',
        dstCityName: p.state || p.district || 'เขตบางรัก',
        dstDistrictName: p.sub_district || p.district || 'บางรัก',
        dstPostalCode: p.postcode || '10500',
        dstDetailAddress: p.address || 'Cardstreet Platform',
    };
}

/**
 * Load `orderIds` and refuse unless every one is this seller's, the same
 * buyer's, labellable and unlabelled. Clears stale PENDING claims on the way.
 */
async function loadUnlabelledOrders(
    admin: SupabaseClient,
    sellerId: string,
    orderIds: string[],
): Promise<{ ok: true; orders: OrderRow[]; buyerId: string } | Fail> {
    const ids = [...new Set(orderIds.filter((id) => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) return fail(400, 'NO_ORDERS', 'No orders given');

    const { data, error } = await admin
        .from('orders')
        .select('id, seller_id, buyer_id, status, break_spot_id, created_at, listing:listings(card_data), shipping_labels(tracking_number, status, created_at)')
        .in('id', ids);
    if (error) return fail(500, 'LOOKUP_FAILED', error.message);
    const orders = (data ?? []) as unknown as OrderRow[];
    if (orders.length !== ids.length) return fail(404, 'NOT_FOUND', 'Order not found');

    const buyers = new Set<string>();
    const staleClaims: string[] = [];
    for (const o of orders) {
        if (o.seller_id !== sellerId) return fail(403, 'FORBIDDEN', 'Not your order');
        if (o.break_spot_id) {
            return fail(409, 'LIVE_BREAK', 'Live-break orders ship as one consolidated parcel after the show');
        }
        if (!LABEL_READY_STATUSES.includes(o.status)) {
            return fail(409, 'NOT_LABELLABLE', `Order is ${o.status.replace(/_/g, ' ')}, not awaiting a label`);
        }
        const label = one(o.shipping_labels);
        if (label?.tracking_number) {
            if (isRealWaybill(label.tracking_number) || label.tracking_number === 'MANUAL') {
                return fail(409, 'ALREADY_LABELLED', 'This order already has a shipping label');
            }
            if (label.tracking_number === PENDING_WAYBILL) {
                const age = Date.now() - (Date.parse(label.created_at || '') || 0);
                if (age < CLAIM_STALE_MS) {
                    return fail(409, 'IN_PROGRESS', 'A label is already being created for this order');
                }
                staleClaims.push(o.id);
            }
        }
        buyers.add(o.buyer_id);
    }
    if (buyers.size !== 1) return fail(409, 'DIFFERENT_BUYERS', 'Only orders for the same buyer can share a parcel');

    if (staleClaims.length > 0) {
        await admin
            .from('shipping_labels')
            .delete()
            .in('order_id', staleClaims)
            .eq('tracking_number', PENDING_WAYBILL);
    }

    orders.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return { ok: true, orders, buyerId: [...buyers][0] };
}

/** Plain insert of PENDING rows: the UNIQUE order_id arbitrates concurrent clicks. */
async function claimOrders(admin: SupabaseClient, orderIds: string[]): Promise<Fail | null> {
    const { error } = await admin.from('shipping_labels').insert(
        orderIds.map((id) => ({
            order_id: id,
            tracking_number: PENDING_WAYBILL,
            carrier_name: 'Flash Express',
            status: 'created',
            label_url: 'N/A',
            pickup_status: 'pending',
        })),
    );
    if (!error) return null;
    if (error.code === '23505') return fail(409, 'IN_PROGRESS', 'A label is already being created for this order');
    return fail(500, 'CLAIM_FAILED', error.message);
}

async function releaseClaim(admin: SupabaseClient, orderIds: string[]) {
    await admin
        .from('shipping_labels')
        .delete()
        .in('order_id', orderIds)
        .eq('tracking_number', PENDING_WAYBILL);
}

async function advanceToLabelGenerated(admin: SupabaseClient, orderIds: string[]): Promise<string | null> {
    const { error } = await admin
        .from('orders')
        .update({ status: 'label_generated', updated_at: new Date().toISOString() })
        .in('id', orderIds)
        .in('status', LABEL_READY_STATUSES);
    return error ? error.message : null;
}

async function notifyLabelReady(sellerId: string, primaryOrderId: string, pdfBase64: string | null) {
    try {
        await sendLabelGeneratedNotification(sellerId, { id: primaryOrderId }, pdfBase64);
    } catch (e) {
        console.error('[Parcels] label notification failed (non-fatal):', (e as Error).message);
    }
}

/**
 * Mint one Flash waybill for `orderIds` (this seller's unlabelled orders from
 * one buyer): shipment, label PDF, pickup, label rows, status flip, email.
 * A Flash region error becomes a MANUAL placeholder (support handles it), as
 * fulfilment used to do; any other Flash error releases the claim so the
 * seller can simply try again.
 */
export async function mintParcel(
    admin: SupabaseClient,
    params: { sellerId: string; orderIds: string[]; notify?: boolean },
): Promise<ParcelResult> {
    const loaded = await loadUnlabelledOrders(admin, params.sellerId, params.orderIds);
    if (!loaded.ok) return loaded;
    const { orders, buyerId } = loaded;
    const orderIds = orders.map((o) => o.id);
    const primary = orders[0];

    const claimErr = await claimOrders(admin, orderIds);
    if (claimErr) return claimErr;

    const { data: profiles } = await admin
        .from('profiles')
        .select(SHIPPING_PROFILE_COLS)
        .in('id', [params.sellerId, buyerId]);
    const seller = (profiles as ProfileRow[] | null)?.find((p) => p.id === params.sellerId);
    const buyer = (profiles as ProfileRow[] | null)?.find((p) => p.id === buyerId);
    if (!seller || !buyer) {
        await releaseClaim(admin, orderIds);
        return fail(409, 'PROFILE_MISSING', 'Seller or buyer profile is missing');
    }

    const items = parcelItemsOf(orders);
    let flashOrder: Awaited<ReturnType<typeof createShipmentWithCityFallback>>;
    try {
        console.log(`[Parcels] Minting waybill for seller ${params.sellerId}, ${orderIds.length} order(s), primary ${primary.id}`);
        flashOrder = await createShipmentWithCityFallback({
            outTradeNo: primary.id,
            ...senderOf(seller),
            ...recipientOf(buyer),
            weight: estimateParcelWeightGramsForItems(items),
            ...estimateParcelDimsCmForItems(items),
            expressCategory: 1,
            articleCategory: 3,
            remark: 'Cardstreet TCG - Handle with care',
        });
    } catch (err: any) {
        if (isRegionError(err)) {
            // Training sandbox / unmapped address: park the parcel on a MANUAL
            // placeholder so the order moves forward and support is paged.
            const { error: manualErr } = await admin.from('shipping_labels').upsert(
                orderIds.map((id) => ({
                    order_id: id,
                    tracking_number: 'MANUAL',
                    carrier_name: 'Flash Express',
                    status: 'awaiting_manual',
                    label_url: '',
                    flash_order_id: null,
                    flash_sort_code: null,
                    pickup_id: null,
                    pickup_status: 'manual',
                    courier_tracking_url: null,
                })),
                { onConflict: 'order_id' },
            );
            if (manualErr) {
                await releaseClaim(admin, orderIds);
                return fail(500, 'LABEL_WRITE_FAILED', manualErr.message);
            }
            await advanceToLabelGenerated(admin, orderIds);
            Sentry.captureMessage('Flash region mismatch — manual label inserted', {
                level: 'error',
                tags: { handler: 'parcels', kind: 'manual_label' },
                extra: { sellerId: params.sellerId, orderIds, flashError: err.message },
            });
            return { ok: true, trackingNumber: 'MANUAL', orderIds, manual: true };
        }
        await releaseClaim(admin, orderIds);
        console.error(`[Parcels] Flash shipment creation failed for seller ${params.sellerId}:`, err);
        return fail(502, 'FLASH_ERROR', err?.message || 'Flash shipment creation failed');
    }

    // Persist the pno IMMEDIATELY: Flash does not dedupe on outTradeNo, so a
    // lost pno would mean a second waybill diverging from this one.
    const courierTrackingUrl = `https://www.flashexpress.com/fle/tracking?se=${flashOrder.pno}`;
    const baseRow = (id: string) => ({
        order_id: id,
        tracking_number: flashOrder.pno,
        carrier_name: 'Flash Express',
        status: 'created',
        label_url: 'N/A',
        flash_order_id: flashOrder.outTradeNo,
        flash_sort_code: flashOrder.sortCode,
        courier_tracking_url: courierTrackingUrl,
    });
    const { error: earlyErr } = await admin
        .from('shipping_labels')
        .upsert(orderIds.map(baseRow), { onConflict: 'order_id' });
    if (earlyErr) {
        console.error('[Parcels] Early waybill persist failed:', earlyErr.message);
    }

    let labelUrl = '';
    let labelPdfBase64: string | null = null;
    try {
        const labelPdf = await generateLabel(flashOrder.pno);
        labelPdfBase64 = labelPdf.toString('base64');
        const fileName = `shipping-labels/${primary.id}_${flashOrder.pno}.pdf`;
        const { error: uploadError } = await admin.storage
            .from('public-assets')
            .upload(fileName, labelPdf, { contentType: 'application/pdf', upsert: true });
        if (uploadError) {
            // The in-app print flow regenerates from Flash on demand, and the
            // email carries the PDF as an attachment, so this is cosmetic.
            console.error('[Parcels] Label storage upload failed (non-fatal):', uploadError);
        } else {
            labelUrl = admin.storage.from('public-assets').getPublicUrl(fileName).data.publicUrl;
        }
    } catch (labelErr) {
        console.error('[Parcels] Label generation error (non-fatal):', labelErr);
    }

    let pickupId = '';
    let pickupStatus = 'pending';
    try {
        const pickup = await requestPickup({
            ...senderOf(seller),
            estimateParcelNumber: 1,
            remark: 'Cardstreet order pickup',
        });
        pickupId = String(pickup.ticketPickupId);
        pickupStatus = 'scheduled';
    } catch (pickupErr) {
        console.error('[Parcels] Pickup request error (non-fatal):', pickupErr);
        pickupStatus = 'manual';
    }

    const { error: fullErr } = await admin.from('shipping_labels').upsert(
        orderIds.map((id) => ({
            ...baseRow(id),
            label_url: labelUrl || 'N/A',
            pickup_id: pickupId,
            pickup_status: pickupStatus,
        })),
        { onConflict: 'order_id' },
    );
    if (fullErr) {
        console.error('[Parcels] Label row upsert failed:', fullErr.message);
    }

    const flipErr = await advanceToLabelGenerated(admin, orderIds);
    if (flipErr) {
        // The waybill exists and is stored; the status is what lags. Loud, so
        // the pipeline cannot rot quietly.
        Sentry.captureMessage('Parcel minted but orders not advanced to label_generated', {
            level: 'error',
            tags: { handler: 'parcels' },
            extra: { orderIds, pno: flashOrder.pno, error: flipErr },
        });
        return fail(500, 'STATUS_FLIP_FAILED', flipErr);
    }

    if (params.notify !== false) {
        await notifyLabelReady(params.sellerId, primary.id, labelPdfBase64);
    }
    console.log(`[Parcels] Waybill ${flashOrder.pno} covers ${orderIds.length} order(s) for seller ${params.sellerId}`);
    return { ok: true, trackingNumber: flashOrder.pno, orderIds, manual: false };
}

/**
 * Put `orderIds` (unlabelled, same buyer) on `trackingNumber`, a waybill of
 * this seller's that Flash has not scanned yet. The seller adds the cards to
 * the envelope they have not handed over; nothing is minted or cancelled.
 */
export async function attachToParcel(
    admin: SupabaseClient,
    params: { sellerId: string; orderIds: string[]; trackingNumber: string; notify?: boolean },
): Promise<ParcelResult> {
    if (!isRealWaybill(params.trackingNumber)) return fail(400, 'BAD_WAYBILL', 'Not a waybill');

    const { data: targetRows, error: targetErr } = await admin
        .from('shipping_labels')
        .select('tracking_number, label_url, flash_order_id, flash_sort_code, pickup_id, pickup_status, courier_tracking_url, status, orders!inner(id, seller_id, buyer_id, status, break_spot_id)')
        .eq('tracking_number', params.trackingNumber);
    if (targetErr) return fail(500, 'LOOKUP_FAILED', targetErr.message);
    const target = (targetRows ?? []) as unknown as (WaybillFields & {
        status: string | null;
        orders: { id: string; seller_id: string; buyer_id: string; status: string; break_spot_id: string | null } | { id: string; seller_id: string; buyer_id: string; status: string; break_spot_id: string | null }[] | null;
    })[];
    if (target.length === 0) return fail(404, 'PARCEL_NOT_FOUND', 'That parcel was not found');

    let targetBuyer: string | null = null;
    for (const row of target) {
        const o = one(row.orders);
        if (!o || o.seller_id !== params.sellerId) return fail(403, 'FORBIDDEN', 'Not your parcel');
        if (o.break_spot_id) return fail(409, 'LIVE_BREAK', 'Live-break parcels cannot take other orders');
        if (o.status !== 'label_generated' || (row.status && row.status !== 'created')) {
            return fail(409, 'PARCEL_CLOSED', 'That parcel has already been collected by Flash');
        }
        targetBuyer = o.buyer_id;
    }

    const loaded = await loadUnlabelledOrders(admin, params.sellerId, params.orderIds);
    if (!loaded.ok) return loaded;
    if (loaded.buyerId !== targetBuyer) {
        return fail(409, 'DIFFERENT_BUYERS', 'Only orders for the same buyer can share a parcel');
    }
    const orderIds = loaded.orders.map((o) => o.id);

    const claimErr = await claimOrders(admin, orderIds);
    if (claimErr) return claimErr;

    const waybill = target[0];
    const { error: rowErr } = await admin
        .from('shipping_labels')
        .upsert(orderIds.map((id) => waybillRowFor(id, waybill)), { onConflict: 'order_id' });
    if (rowErr) {
        await releaseClaim(admin, orderIds);
        return fail(500, 'LABEL_WRITE_FAILED', rowErr.message);
    }

    const flipErr = await advanceToLabelGenerated(admin, orderIds);
    if (flipErr) return fail(500, 'STATUS_FLIP_FAILED', flipErr);

    if (params.notify !== false) {
        let pdf: string | null = null;
        try {
            pdf = (await generateLabel(waybill.tracking_number)).toString('base64');
        } catch (e) {
            console.error('[Parcels] Label regeneration failed (non-fatal):', (e as Error).message);
        }
        await notifyLabelReady(params.sellerId, orderIds[0], pdf);
    }
    console.log(`[Parcels] ${orderIds.length} order(s) added to waybill ${waybill.tracking_number} for seller ${params.sellerId}`);
    return { ok: true, trackingNumber: waybill.tracking_number, orderIds, manual: false };
}
