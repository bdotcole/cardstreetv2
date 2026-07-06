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
import * as Sentry from '@sentry/nextjs';
import { createShipmentWithCityFallback, generateLabel, requestPickup, isRegionError, estimateParcelWeightGramsForItems, estimateParcelDimsCmForItems } from '@/lib/flashExpress';
import {
    sendSoldNotification,
    sendOrderConfirmationNotification,
    sendLabelGeneratedNotification,
    sendFirstTimeSaleEmail,
} from '@/lib/courier';
import { recordInternalSales } from '@/lib/internalPricing';

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
            // listing card_data rides along so the shipment declares the real
            // parcel weight when the order contains sealed products.
            .select('id, listing_id, buyer_id, seller_id, status, total_amount, shipping_fee, transfer_group, listing:listings(card_data)')
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

        // ─── Feature B: record realized sales for internal pricing (dark) ───
        // Reached only on a full CAS win (the partial-win branch returned above),
        // so every `orders` row was won by this invocation and no other worker is
        // handling them. Idempotent via market_value_sales.order_id UNIQUE, so a
        // duplicate webhook / the /api/orders/finalize fallback can't double-count.
        // Flag-gated so production is untouched until launch; NEVER throws (pricing
        // must not block or roll back fulfillment).
        if (process.env.INTERNAL_PRICING_ENABLED === 'true') {
            try {
                await recordInternalSales(
                    supabase,
                    orders.map(o => ({
                        id: o.id,
                        listing_id: o.listing_id,
                        total_amount: o.total_amount,
                    })),
                );
            } catch (pricingErr) {
                console.error('[Fulfillment] Internal-pricing record error (non-fatal):', pricingErr);
                result.errors.push(`Internal pricing: ${(pricingErr as Error).message}`);
            }
        }

        // All orders in a transfer_group share a buyer; pin it now so both the
        // inventory-transfer block (below) and the seller/buyer profile lookups
        // (further down) can use it.
        const buyerId = orders[0].buyer_id;

        // ─── Inventory transfer (now post-payment, was pre-payment) ───
        // Re-read each listing by id so we move the actual sold cards into the
        // buyer's collection only after payment is confirmed. Failures here are
        // non-fatal to shipping (we'll still create the label and email) but
        // are recorded in result.errors so the order can be reconciled.
        try {
            const listingIdsForTransfer = orders
                .map(o => o.listing_id)
                .filter((v): v is string => typeof v === 'string');

            if (listingIdsForTransfer.length > 0) {
                const { data: soldListings } = await supabase
                    .from('listings')
                    .select('id, seller_id, card_id, card_data, condition, price')
                    .in('id', listingIdsForTransfer);

                if (soldListings && soldListings.length > 0) {
                    // Ensure the buyer has a destination collection.
                    const { data: existingCollections } = await supabase
                        .from('collections')
                        .select('id')
                        .eq('user_id', buyerId)
                        .limit(1);

                    let targetCollectionId: string;
                    if (!existingCollections || existingCollections.length === 0) {
                        const { data: newCollection } = await supabase
                            .from('collections')
                            .insert({ user_id: buyerId, name: 'Main Vault', include_in_portfolio: true })
                            .select('id')
                            .single();
                        targetCollectionId = newCollection!.id;
                    } else {
                        targetCollectionId = existingCollections[0].id;
                    }

                    for (const listing of soldListings) {
                        await supabase.from('collection_items').insert({
                            collection_id: targetCollectionId,
                            card_id: listing.card_id,
                            card_data: listing.card_data,
                            quantity: 1,
                            condition: listing.condition,
                            purchase_price: listing.price,
                        });

                        // Remove a matching copy from the seller's collection,
                        // if present. Deterministic by id ASC.
                        const { data: sellerItems } = await supabase
                            .from('collection_items')
                            .select('id, collections!inner(user_id)')
                            .eq('card_id', listing.card_id)
                            .eq('collections.user_id', listing.seller_id)
                            .order('id', { ascending: true })
                            .limit(1);

                        if (sellerItems && sellerItems.length > 0) {
                            await supabase.from('collection_items').delete().eq('id', sellerItems[0].id);
                        }
                    }
                }
            }
        } catch (invErr: any) {
            console.error('[Fulfillment] Inventory transfer error (non-fatal):', invErr);
            result.errors.push(`Inventory transfer error: ${invErr.message}`);
        }

        // ─── Step 3-6: Flash Express per seller ───
        const sellerIds = [...new Set(orders.map(o => o.seller_id))];

        const SHIPPING_PROFILE_COLS =
            'id, display_name, phone_number, province, state, district, sub_district, postcode, address';
        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select(SHIPPING_PROFILE_COLS)
            .in('id', sellerIds);

        // Get buyer profile (all orders in a transfer_group share a buyer;
        // buyerId was pinned up at the top of the function).
        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select(SHIPPING_PROFILE_COLS)
            .eq('id', buyerId)
            .single();

        const labelsToInsert: any[] = [];
        // Order IDs whose label rows were successfully prepared. We only flip
        // these to 'label_generated' AFTER the shipping_labels upsert succeeds
        // — otherwise an insert failure (missing column, RLS, constraint, etc.)
        // would leave orders at label_generated with no actual label row, and
        // the seller has no way to print or track. Better to keep the order
        // at 'paid' so the recovery path is "rerun fulfillment" rather than
        // "manually reconstruct a shipping_labels row."
        const ordersToFlipToLabelGenerated: string[] = [];
        const sellerLabelMap = new Map<string, string>();
        // base64-encoded label PDFs per seller, so the "label generated" email
        // can ship the actual PDF as an attachment instead of relying on a
        // working public URL (Supabase Storage upload is currently failing in
        // prod, which used to leave the email with a useless Flash API link).
        const sellerLabelPdfMap = new Map<string, string>();

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
                const flashOrder = await createShipmentWithCityFallback({
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
                    // Match the weight AND dimensions the buyer was quoted at
                    // checkout (one order per item; sealed products declare
                    // their real per-type weight). Declaring real dims — rather
                    // than letting them default to a 1x1x1 cm cube — keeps
                    // Flash from re-rating the parcel at the depot off a bogus
                    // size.
                    weight: estimateParcelWeightGramsForItems(sellerOrders.map(o => ({
                        isSealed: (o as any).listing?.card_data?.isSealed === true,
                        productType: (o as any).listing?.card_data?.productType ?? null,
                    }))),
                    ...estimateParcelDimsCmForItems(sellerOrders.map(o => ({
                        isSealed: (o as any).listing?.card_data?.isSealed === true,
                        productType: (o as any).listing?.card_data?.productType ?? null,
                    }))),
                    expressCategory: 1,
                    articleCategory: 3,
                    remark: 'CardStreet TCG - Handle with care',
                });

                result.trackingNumbers.push(flashOrder.pno);

                // Persist the freshly-minted waybill IMMEDIATELY, before the
                // label/pickup work (any of which can fail). Flash does NOT
                // dedupe on outTradeNo — calling createShipment again for the
                // same order mints a *different* pno — so if this pno is ever
                // lost (e.g. the enriched upsert at the end of the loop fails),
                // the /api/orders/[id]/label recovery path would create a
                // duplicate waybill that diverges from the one actually printed
                // and shipped. That is exactly how order 26126d8d ended up with
                // a delivered parcel under a waybill the DB never stored.
                // Storing the pno up front makes that divergence impossible.
                {
                    const earlyRows = sellerOrders.map(o => ({
                        order_id: o.id,
                        tracking_number: flashOrder.pno,
                        carrier_name: 'Flash Express',
                        status: 'created',
                        label_url: 'N/A',
                        courier_tracking_url: `https://www.flashexpress.com/fle/tracking?se=${flashOrder.pno}`,
                    }));
                    const { error: earlyErr } = await supabase
                        .from('shipping_labels')
                        .upsert(earlyRows, { onConflict: 'order_id' });
                    if (earlyErr) {
                        console.error('[Fulfillment] Early tracking-number persist failed:', earlyErr.message);
                    }
                }

                // Generate label
                let labelUrl = '';
                try {
                    const labelPdf = await generateLabel(flashOrder.pno);
                    // Stash base64 for the email attachment regardless of
                    // whether the storage upload below succeeds.
                    sellerLabelPdfMap.set(sellerId, labelPdf.toString('base64'));

                    const fileName = `shipping-labels/${primaryOrder.id}_${flashOrder.pno}.pdf`;
                    const { error: uploadError } = await supabase
                        .storage
                        .from('public-assets')
                        .upload(fileName, labelPdf, { contentType: 'application/pdf', upsert: true });

                    if (uploadError) {
                        // Storage upload failed (typically the 'public-assets'
                        // bucket is missing or service-role can't write to it).
                        // Don't fall back to the Flash API URL here — that's a
                        // POST-only API endpoint and 405s in a browser. Leave
                        // labelUrl blank; the in-app print flow recovers via
                        // /api/orders/[id]/label, and the email gets the PDF
                        // as an attachment via sellerLabelPdfMap.
                        console.error('[Fulfillment] Label storage upload failed (non-fatal):', uploadError);
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

                // Prepare label records (insert happens after the loop)
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
                    ordersToFlipToLabelGenerated.push(order.id);
                }

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
                        ordersToFlipToLabelGenerated.push(order.id);
                    }
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

        // ─── Insert shipping labels FIRST, then advance order status ───
        // Reversing the previous order: if the upsert fails (missing column,
        // RLS, constraint, etc.) the order stays at 'paid' and a retry can
        // recover it. The old code advanced the order to 'label_generated'
        // before this insert ran, which permanently desynced the two tables
        // when the insert later failed.
        let labelsInserted = true;
        if (labelsToInsert.length > 0) {
            const { error: labelInsertError } = await supabase
                .from('shipping_labels')
                .upsert(labelsToInsert, { onConflict: 'order_id' });

            if (labelInsertError) {
                labelsInserted = false;
                console.error('[Fulfillment] Failed to insert shipping labels:', labelInsertError);
                result.errors.push(`Label insert error: ${labelInsertError.message}`);
            }
        }

        if (labelsInserted && ordersToFlipToLabelGenerated.length > 0) {
            const { error: statusErr } = await supabase
                .from('orders')
                .update({ status: 'label_generated' })
                .in('id', ordersToFlipToLabelGenerated);
            if (statusErr) {
                console.error('[Fulfillment] Failed to advance orders to label_generated:', statusErr);
                result.errors.push(`Order status update error: ${statusErr.message}`);
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

                // One-time onboarding email on the seller's first-ever sale.
                // Durably guarded + idempotent (profiles.first_sale_email_sent_at
                // compare-and-swap), so duplicate webhook deliveries / the
                // /finalize fallback can't double-send. Never throws.
                await sendFirstTimeSaleEmail(sellerId, { orderId: sellerOrders[0].id });

                // Send the label-ready email regardless of whether the
                // storage upload succeeded — the PDF travels as an attachment.
                // sellerLabelPdfMap is populated by generateLabel() above; the
                // function falls back to a dashboard-link-only email if it's
                // missing (e.g. Flash createShipment threw earlier).
                const labelPdfBase64 = sellerLabelPdfMap.get(sellerId) || null;
                if (labelPdfBase64 || sellerLabelMap.has(sellerId)) {
                    await sendLabelGeneratedNotification(sellerId, { id: sellerOrders[0].id }, labelPdfBase64);
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
        Sentry.captureException(err, {
            tags: { handler: 'fulfill-order' },
            extra: { transferGroup, paymentId },
        });
        result.errors.push(`Fatal: ${err.message}`);
    }

    return result;
}
