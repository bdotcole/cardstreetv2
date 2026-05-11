/**
 * Shared Order Fulfillment Logic
 * 
 * Called by the Stripe webhook after payment confirmation.
 * Handles: Flash Express shipments, label generation, pickup scheduling,
 * shipping label DB records, and Courier notifications.
 * 
 * Designed to be idempotent — if orders are already 'paid' or beyond,
 * it skips them gracefully.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createShipment, generateLabel, requestPickup, isRegionError } from '@/lib/flashExpress';
import {
    sendSoldNotification,
    sendOrderConfirmationNotification,
    sendLabelGeneratedNotification,
} from '@/lib/courier';

function getAdminSupabase(): SupabaseClient {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

export interface FulfillmentResult {
    success: boolean;
    ordersUpdated: number;
    trackingNumbers: string[];
    errors: string[];
}

/**
 * Fulfills all orders associated with a given transfer_group.
 * 
 * Steps:
 *   1. Find orders with status 'pending_payment' matching the transfer_group
 *   2. Update them to 'paid'
 *   3. Create Flash Express shipments per seller
 *   4. Generate & upload labels
 *   5. Schedule pickups
 *   6. Insert shipping_labels records
 *   7. Update orders to 'label_generated'
 *   8. Send Courier notifications
 * 
 * @param transferGroup The Stripe transfer_group linking payment to orders
 * @param paymentId The Stripe PaymentIntent ID for audit trail
 */
export async function fulfillOrdersByTransferGroup(
    transferGroup: string,
    paymentId: string
): Promise<FulfillmentResult> {
    const supabase = getAdminSupabase();
    const result: FulfillmentResult = {
        success: false,
        ordersUpdated: 0,
        trackingNumbers: [],
        errors: [],
    };

    try {
        // ─── Step 1: Find pending orders ───
        const { data: orders, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('transfer_group', transferGroup)
            .eq('status', 'pending_payment');

        if (fetchError) {
            result.errors.push(`DB fetch error: ${fetchError.message}`);
            return result;
        }

        if (!orders || orders.length === 0) {
            // Orders may already be fulfilled (idempotent)
            console.log(`[Fulfillment] No pending_payment orders for transfer_group ${transferGroup} — likely already fulfilled.`);
            result.success = true;
            return result;
        }

        console.log(`[Fulfillment] Found ${orders.length} orders to fulfill for transfer_group ${transferGroup}`);

        // ─── Step 2: Atomically update orders to 'paid' (CAS guard) ───
        // The `.eq('status', 'pending_payment')` clause makes the UPDATE a
        // compare-and-swap. If a concurrent webhook delivery already flipped
        // these rows to 'paid', our UPDATE matches zero rows and we abort BEFORE
        // firing the (non-idempotent) Flash Express side effects. Without this
        // guard, the SELECT+UPDATE pair was a TOCTOU race: two parallel
        // invocations could both pass the read-side filter and both proceed to
        // create duplicate shipments, labels, pickups, and notifications.
        const orderIds = orders.map(o => o.id);
        const { data: updatedRows, error: updateError } = await supabase
            .from('orders')
            .update({
                status: 'paid',
                payment_id: paymentId,
                updated_at: new Date().toISOString(),
            })
            .in('id', orderIds)
            .eq('status', 'pending_payment')
            .select('id');

        if (updateError) {
            result.errors.push(`Failed to update orders to paid: ${updateError.message}`);
            return result;
        }

        const winningCount = updatedRows?.length ?? 0;
        if (winningCount < orderIds.length) {
            // Another worker (concurrent webhook delivery, or admin action) won
            // the CAS for at least one of these orders. Abort entirely so we
            // don't create duplicate Flash Express shipments. The winning
            // worker is responsible for fulfillment.
            console.warn(
                `[Fulfillment] CAS guard tripped: expected to flip ${orderIds.length} orders pending_payment→paid, ` +
                `only flipped ${winningCount}. Concurrent fulfillment in progress — aborting side effects for ` +
                `transfer_group ${transferGroup}.`
            );
            result.success = true;
            result.ordersUpdated = winningCount;
            return result;
        }

        result.ordersUpdated = winningCount;

        // ─── Step 3-6: Flash Express per seller ───
        const sellerIds = [...new Set(orders.map(o => o.seller_id))];

        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', sellerIds);

        // Get buyer profile (all orders in a transfer_group share a buyer)
        const buyerId = orders[0].buyer_id;
        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', buyerId)
            .single();

        const labelsToInsert: any[] = [];
        const sellerLabelMap = new Map<string, string>();

        for (const sellerId of sellerIds) {
            const sellerOrders = orders.filter(o => o.seller_id === sellerId);
            if (sellerOrders.length === 0) continue;

            const primaryOrder = sellerOrders[0];
            const sellerProfile = sellerProfiles?.find(p => p.id === sellerId);

            const src = {
                name: sellerProfile?.display_name || 'CardStreet Seller',
                phone: sellerProfile?.phone_number || '0000000000',
                provinceName: sellerProfile?.province || 'กรุงเทพมหานคร',
                cityName: sellerProfile?.state || sellerProfile?.district || 'เขตบางรัก',
                districtName: sellerProfile?.sub_district || sellerProfile?.district || 'บางรัก',
                postalCode: sellerProfile?.postcode || '10500',
                detailAddress: sellerProfile?.address || 'CardStreet Platform',
            };

            const dst = {
                name: buyerProfile?.display_name || 'CardStreet Buyer',
                phone: buyerProfile?.phone_number || '0000000000',
                provinceName: buyerProfile?.province || 'กรุงเทพมหานคร',
                cityName: buyerProfile?.state || buyerProfile?.district || 'เขตบางรัก',
                districtName: buyerProfile?.sub_district || buyerProfile?.district || 'บางรัก',
                postalCode: buyerProfile?.postcode || '10500',
                detailAddress: buyerProfile?.address || 'CardStreet Platform',
            };

            try {
                // Create Flash Express shipment
                console.log(`[Fulfillment] Creating Flash Express shipment for seller ${sellerId}...`);
                const flashOrder = await createShipment({
                    outTradeNo: primaryOrder.id,
                    srcName: src.name,
                    srcPhone: src.phone,
                    srcProvinceName: src.provinceName,
                    srcCityName: src.cityName,
                    srcDistrictName: src.districtName,
                    srcPostalCode: src.postalCode,
                    srcDetailAddress: src.detailAddress,
                    dstName: dst.name,
                    dstPhone: dst.phone,
                    dstProvinceName: dst.provinceName,
                    dstCityName: dst.cityName,
                    dstDistrictName: dst.districtName,
                    dstPostalCode: dst.postalCode,
                    dstDetailAddress: dst.detailAddress,
                    weight: 500,
                    expressCategory: 1,
                    articleCategory: 3,
                    remark: 'CardStreet TCG - Handle with care',
                });

                result.trackingNumbers.push(flashOrder.pno);

                // Generate label
                let labelUrl = '';
                try {
                    const labelPdf = await generateLabel(flashOrder.pno);
                    const fileName = `shipping-labels/${primaryOrder.id}_${flashOrder.pno}.pdf`;
                    const { error: uploadError } = await supabase
                        .storage
                        .from('public-assets')
                        .upload(fileName, labelPdf, { contentType: 'application/pdf', upsert: true });

                    if (uploadError) {
                        const flashBase = process.env.FLASH_EXPRESS_ENV === 'production'
                            ? 'https://open-api.flashexpress.com'
                            : 'https://open-api-tra.flashexpress.com';
                        labelUrl = `${flashBase}/open/v1/orders/${flashOrder.pno}/pre_print`;
                    } else {
                        const { data: publicUrl } = supabase.storage.from('public-assets').getPublicUrl(fileName);
                        labelUrl = publicUrl.publicUrl;
                    }
                } catch (labelErr) {
                    console.error('[Fulfillment] Label generation error (non-fatal):', labelErr);
                }

                if (labelUrl) sellerLabelMap.set(sellerId, labelUrl);

                // Request pickup
                let pickupId = '';
                let pickupStatus = 'pending';
                try {
                    const pickup = await requestPickup({
                        srcName: src.name,
                        srcPhone: src.phone,
                        srcProvinceName: src.provinceName,
                        srcCityName: src.cityName,
                        srcDistrictName: src.districtName,
                        srcPostalCode: src.postalCode,
                        srcDetailAddress: src.detailAddress,
                        estimateParcelNumber: 1,
                        remark: 'CardStreet order pickup',
                    });
                    pickupId = String(pickup.ticketPickupId);
                    pickupStatus = 'scheduled';
                } catch (pickupErr) {
                    console.error('[Fulfillment] Pickup request error (non-fatal):', pickupErr);
                    pickupStatus = 'manual';
                }

                // Prepare label records
                const courierTrackingUrl = `https://www.flashexpress.com/fle/tracking?se=${flashOrder.pno}`;
                for (const order of sellerOrders) {
                    labelsToInsert.push({
                        order_id: order.id,
                        tracking_number: flashOrder.pno,
                        carrier_name: 'Flash Express',
                        status: 'created',
                        label_url: labelUrl || 'N/A',
                        flash_order_id: flashOrder.outTradeNo,
                        flash_sort_code: flashOrder.sortCode,
                        pickup_id: pickupId,
                        pickup_status: pickupStatus,
                        courier_tracking_url: courierTrackingUrl,
                    });
                }

                // Update these orders to label_generated
                await supabase
                    .from('orders')
                    .update({ status: 'label_generated' })
                    .in('id', sellerOrders.map(o => o.id));

            } catch (flashErr: any) {
                if (isRegionError(flashErr)) {
                    // Training sandbox rejects most non-Bangkok addresses. Insert a
                    // placeholder label so the order can move forward and the seller
                    // is notified; the label will be created manually.
                    console.warn(
                        `[Fulfillment] Flash Express region mismatch for seller ${sellerId} — ` +
                        `inserting manual-label placeholder so order flow can continue. ` +
                        `Original error: ${flashErr.message}`
                    );
                    for (const order of sellerOrders) {
                        labelsToInsert.push({
                            order_id: order.id,
                            tracking_number: 'MANUAL',
                            carrier_name: 'Flash Express',
                            status: 'awaiting_manual',
                            label_url: '',
                            flash_order_id: null,
                            flash_sort_code: null,
                            pickup_id: null,
                            pickup_status: 'manual',
                            courier_tracking_url: null,
                        });
                    }
                    await supabase
                        .from('orders')
                        .update({ status: 'label_generated' })
                        .in('id', sellerOrders.map(o => o.id));
                    result.errors.push(
                        `Flash Express region mismatch for seller ${sellerId} — manual label required`
                    );
                } else {
                    console.error(`[Fulfillment] Flash Express error for seller ${sellerId}:`, flashErr);
                    result.errors.push(`Flash Express error for seller ${sellerId}: ${flashErr.message}`);
                    // Orders stay as 'paid' — seller can manually ship via the dashboard
                }
            }
        }

        // ─── Insert shipping labels ───
        if (labelsToInsert.length > 0) {
            const { error: labelInsertError } = await supabase
                .from('shipping_labels')
                .upsert(labelsToInsert, { onConflict: 'order_id' });

            if (labelInsertError) {
                console.error('[Fulfillment] Failed to insert shipping labels:', labelInsertError);
                result.errors.push(`Label insert error: ${labelInsertError.message}`);
            }
        }

        // ─── Step 8: Send notifications ───
        try {
            // Notify buyer
            const totalAmount = orders.reduce((sum, o) => sum + (o.total_amount || 0) + (o.shipping_fee || 0), 0);
            await sendOrderConfirmationNotification(
                buyerId,
                { id: orders.length > 1 ? 'multiple' : orders[0].id, total_amount: totalAmount },
                result.trackingNumbers
            );

            // Notify each seller
            for (const sellerId of sellerIds) {
                const sellerOrders = orders.filter(o => o.seller_id === sellerId);
                const sellerTotal = sellerOrders.reduce((sum, o) => sum + o.total_amount, 0);

                await sendSoldNotification(sellerId, { id: sellerOrders[0].id, total_amount: sellerTotal });

                const labelUrl = sellerLabelMap.get(sellerId);
                if (labelUrl) {
                    await sendLabelGeneratedNotification(sellerId, { id: sellerOrders[0].id }, labelUrl);
                }
            }
        } catch (notifErr) {
            console.error('[Fulfillment] Notification error (non-fatal):', notifErr);
            result.errors.push(`Notification error: ${(notifErr as Error).message}`);
        }

        result.success = true;
        console.log(`[Fulfillment] Completed for transfer_group ${transferGroup}: ${result.ordersUpdated} orders, ${result.trackingNumbers.length} shipments`);

    } catch (err: any) {
        console.error('[Fulfillment] Fatal error:', err);
        result.errors.push(`Fatal: ${err.message}`);
    }

    return result;
}
