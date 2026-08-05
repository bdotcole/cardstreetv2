/**
 * POST /api/live/streams/[id]/settle — Smart-Bundling settlement after a
 * stream ends: group each buyer's PAID spot orders into ONE shipments row
 * (one Flash parcel, one fee), quote shipping by combined weight, and mint a
 * single shipping-fee order the buyer pays ON-SESSION later (spot orders
 * carried zero shipping by design).
 *
 * Idempotent: a buyer who already has a shipment for this stream is skipped,
 * and only orders with shipment_id still NULL are grouped — a re-run after a
 * partial failure picks up exactly the buyers that were missed.
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';
import {
    estimateRateWithCityFallback,
    isRegionError,
    fallbackShippingSatang,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
    type ParcelItemInfo,
} from '@/lib/flashExpress';

const SHIPPING_PROFILE_COLS =
    'id, display_name, phone_number, province, state, district, sub_district, postcode, address';

interface ShippingProfile {
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

interface SpotOrderRow {
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    shipment_id: string | null;
    break_spot_id: string;
    stripe_region: string | null;
}

/**
 * Get-or-create the ONE shipping-fee order the buyer pays on-session later;
 * its `liveship_<shipmentId>` transfer_group keys the existing checkout +
 * finalize rail (no platform fee — pass-through freight). Idempotent by
 * transfer_group lookup: a re-run, a concurrent settle, or the
 * partial-failure backfill can never mint a second payable fee order — a
 * duplicate in the same group would double what the webhook flips to paid.
 * Throws with a describable message on insert failure; the caller records it.
 */
async function ensureShippingFeeOrder(
    admin: SupabaseClient,
    shipment: { id: string; buyer_id: string; shipping_fee: number },
    sellerId: string,
    sellerRegion: 'th' | 'us',
): Promise<string> {
    const transferGroup = `liveship_${shipment.id}`;

    const { data: existing } = await admin
        .from('orders')
        .select('id')
        .eq('transfer_group', transferGroup)
        .neq('status', 'cancelled')
        .limit(1)
        .maybeSingle<{ id: string }>();

    let feeOrderId = existing?.id ?? null;
    if (!feeOrderId) {
        const { data: feeOrder, error: feeOrderErr } = await admin
            .from('orders')
            .insert({
                listing_id: null,
                buyer_id: shipment.buyer_id,
                seller_id: sellerId,
                status: 'pending_payment',
                total_amount: shipment.shipping_fee,
                platform_fee: 0,
                shipping_fee: 0,
                escrow_status: 'held',
                payment_method: 'credit_card',
                transfer_group: transferGroup,
                stripe_region: sellerRegion,
            })
            .select('id')
            .single<{ id: string }>();
        if (feeOrderErr || !feeOrder) {
            throw new Error(`fee order insert failed (${feeOrderErr?.message})`);
        }
        feeOrderId = feeOrder.id;
    }

    // CAS: only fill an empty link, never clobber one a concurrent run set.
    await admin
        .from('shipments')
        .update({ shipping_fee_order_id: feeOrderId })
        .eq('id', shipment.id)
        .is('shipping_fee_order_id', null);

    return feeOrderId;
}

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { stream } = ctx;

        // Settling mid-show would strand later sales outside the parcel.
        if (stream.status !== 'ended') {
            return NextResponse.json(
                { error: 'Stream must be ended before settling' },
                { status: 409 },
            );
        }

        const admin = createAdminClient();

        // ─── The stream's sold spots and their (paid, ungrouped) orders ───
        const { data: soldSpots } = await admin
            .from('break_spots')
            .select('id, stream_item_id, order_id')
            .eq('stream_id', stream.id)
            .eq('status', 'sold')
            .not('order_id', 'is', null)
            .returns<{ id: string; stream_item_id: string; order_id: string }[]>();

        const spotByOrderId = new Map((soldSpots ?? []).map(s => [s.order_id, s]));
        const orderIds = [...spotByOrderId.keys()];

        if (orderIds.length === 0) {
            await admin.from('streams').update({ settled_at: new Date().toISOString() }).eq('id', stream.id);
            return NextResponse.json({ success: true, shipments: [], skippedBuyers: 0 });
        }

        // 'paid' is the terminal state a finalized spot order sits in — spot
        // orders never enter the per-order label pipeline, so later statuses
        // don't occur here. pending_payment (buyer never paid) and any
        // cancelled/refunded rows are excluded.
        const { data: orders } = await admin
            .from('orders')
            .select('id, buyer_id, seller_id, status, shipment_id, break_spot_id, stripe_region')
            .in('id', orderIds)
            .eq('status', 'paid')
            .returns<SpotOrderRow[]>();

        const eligible = (orders ?? []).filter(o => o.shipment_id === null);

        // Idempotency: buyers already settled in a previous run keep their
        // shipment untouched.
        const { data: existingShipments } = await admin
            .from('shipments')
            .select('id, buyer_id, shipping_fee, shipping_fee_order_id')
            .eq('stream_id', stream.id)
            .returns<{
                id: string;
                buyer_id: string;
                shipping_fee: number;
                shipping_fee_order_id: string | null;
            }[]>();
        const settledBuyers = new Set((existingShipments ?? []).map(s => s.buyer_id));

        const byBuyer = new Map<string, SpotOrderRow[]>();
        let skippedBuyers = 0;
        for (const order of eligible) {
            if (settledBuyers.has(order.buyer_id)) {
                skippedBuyers++;
                continue;
            }
            const list = byBuyer.get(order.buyer_id) ?? [];
            list.push(order);
            byBuyer.set(order.buyer_id, list);
        }

        // Seller profile up front: both the quote legs and the fee-order
        // backfill below need the platform region.
        const { data: sellerProfile } = await admin
            .from('profiles')
            .select(`${SHIPPING_PROFILE_COLS}, stripe_region`)
            .eq('id', stream.seller_id)
            .maybeSingle<ShippingProfile & { stripe_region: string | null }>();
        const sellerRegion =
            sellerProfile?.stripe_region === 'th' || sellerProfile?.stripe_region === 'us'
                ? sellerProfile.stripe_region
                : 'us';

        const errors: string[] = [];

        // ─── Re-run repair: shipments whose fee order never landed ───
        // A previous settle could insert the shipment then fail before the fee
        // order (or before linking it) — the buyer would never be charged
        // freight. Backfill from the stored shipment row; the helper dedupes
        // by transfer_group, so an orphaned-but-unlinked fee order is relinked
        // rather than duplicated. Must run BEFORE the no-new-buyers early
        // return: on a re-run every order already has shipment_id, so this is
        // the only code that still executes.
        let feeOrdersBackfilled = 0;
        for (const s of existingShipments ?? []) {
            if (s.shipping_fee_order_id !== null) continue;
            try {
                await ensureShippingFeeOrder(admin, s, stream.seller_id, sellerRegion);
                feeOrdersBackfilled++;
            } catch (err: any) {
                errors.push(`shipment ${s.id}: fee backfill failed (${err?.message ?? err})`);
            }
        }

        if (byBuyer.size === 0) {
            await admin.from('streams').update({ settled_at: new Date().toISOString() }).eq('id', stream.id);
            return NextResponse.json({
                success: errors.length === 0,
                shipments: [],
                skippedBuyers,
                feeOrdersBackfilled,
                errors,
            });
        }

        // ─── Lot snapshots for weights + profiles for the quote legs ───
        const lotIds = [
            ...new Set(
                eligible
                    .map(o => spotByOrderId.get(o.id)?.stream_item_id)
                    .filter((x): x is string => typeof x === 'string'),
            ),
        ];
        const { data: lots } = await admin
            .from('stream_items')
            .select('id, card_data, packs_per_spot')
            .in('id', lotIds)
            .returns<{ id: string; card_data: Record<string, unknown> | null; packs_per_spot: number }[]>();
        const lotById = new Map((lots ?? []).map(l => [l.id, l]));

        const buyerIds = [...byBuyer.keys()];
        const { data: buyerProfiles } = await admin
            .from('profiles')
            .select(SHIPPING_PROFILE_COLS)
            .in('id', buyerIds)
            .returns<ShippingProfile[]>();
        const buyerById = new Map((buyerProfiles ?? []).map(p => [p.id, p]));

        const createdShipments: {
            id: string;
            buyerId: string;
            orders: number;
            shippingFee: number;
            shippingFeeOrderId: string | null;
        }[] = [];

        for (const [buyerId, buyerOrders] of byBuyer) {
            try {
                const buyer = buyerById.get(buyerId);

                // Weight model: one parcel item per spot, carrying the lot's
                // sealed flags. A random_pack spot really holds packs_per_spot
                // loose packs, not the whole box — the per-type sealed weights
                // plus the 500g floor over-quote slightly, which is the
                // platform-safe direction (Flash bills actual at pickup).
                const items: ParcelItemInfo[] = buyerOrders.map(o => {
                    const lot = lotById.get(spotByOrderId.get(o.id)?.stream_item_id ?? '');
                    const cd = (lot?.card_data ?? {}) as { isSealed?: boolean; productType?: string | null };
                    return { isSealed: cd.isSealed === true, productType: cd.productType ?? null };
                });
                const weightGrams = estimateParcelWeightGramsForItems(items);

                let shippingSatang: number;
                try {
                    const quote = await estimateRateWithCityFallback({
                        srcProvinceName: sellerProfile?.province || 'กรุงเทพมหานคร',
                        srcCityName: sellerProfile?.state || sellerProfile?.district || 'เขตบางรัก',
                        srcPostalCode: sellerProfile?.postcode || '10500',
                        dstProvinceName: buyer?.province || 'กรุงเทพมหานคร',
                        dstCityName: buyer?.state || buyer?.district || 'เขตบางรัก',
                        dstPostalCode: buyer?.postcode || '10110',
                        weight: weightGrams,
                        ...estimateParcelDimsCmForItems(items),
                    });
                    shippingSatang = quote.estimatePrice + quote.upCountryAmount;
                } catch (err) {
                    shippingSatang = fallbackShippingSatang(sellerProfile?.province, buyer?.province);
                    if (isRegionError(err)) {
                        console.warn(`[Live/Settle] Flash region mismatch for buyer ${buyerId} — fallback`);
                    } else {
                        console.error(`[Live/Settle] Flash estimate error for buyer ${buyerId} — fallback:`, err);
                    }
                }

                const { data: shipment, error: shipmentErr } = await admin
                    .from('shipments')
                    .insert({
                        buyer_id: buyerId,
                        seller_id: stream.seller_id,
                        stream_id: stream.id,
                        status: 'awaiting_shipping_fee',
                        shipping_fee: shippingSatang / 100,
                        address_snapshot: buyer
                            ? {
                                display_name: buyer.display_name,
                                phone_number: buyer.phone_number,
                                province: buyer.province,
                                state: buyer.state,
                                district: buyer.district,
                                sub_district: buyer.sub_district,
                                postcode: buyer.postcode,
                                address: buyer.address,
                            }
                            : null,
                        weight_grams: weightGrams,
                    })
                    .select('id')
                    .single<{ id: string }>();

                let shipmentId: string;
                let shipmentFeeThb = shippingSatang / 100;
                if (shipmentErr || !shipment) {
                    // 23505 on the (stream_id, buyer_id) unique index: a
                    // concurrent settle already created this buyer's shipment.
                    // Adopt it — the shipment_id CAS and fee helper below are
                    // both idempotent — instead of dropping the buyer.
                    if (shipmentErr?.code !== '23505') {
                        errors.push(`buyer ${buyerId}: shipment insert failed (${shipmentErr?.message})`);
                        continue;
                    }
                    const { data: adopted } = await admin
                        .from('shipments')
                        .select('id, shipping_fee')
                        .eq('stream_id', stream.id)
                        .eq('buyer_id', buyerId)
                        .maybeSingle<{ id: string; shipping_fee: number }>();
                    if (!adopted) {
                        errors.push(`buyer ${buyerId}: shipment conflict but refetch found none`);
                        continue;
                    }
                    shipmentId = adopted.id;
                    // The winner's stored quote is the binding one.
                    shipmentFeeThb = adopted.shipping_fee;
                } else {
                    shipmentId = shipment.id;
                }

                // CAS on shipment_id IS NULL so a concurrent settle can't
                // re-group an order into two parcels.
                await admin
                    .from('orders')
                    .update({ shipment_id: shipmentId })
                    .in('id', buyerOrders.map(o => o.id))
                    .is('shipment_id', null);

                // The one shipping-fee order the buyer pays on-session later
                // (see ensureShippingFeeOrder for the idempotency contract).
                let feeOrderId: string | null = null;
                try {
                    feeOrderId = await ensureShippingFeeOrder(
                        admin,
                        { id: shipmentId, buyer_id: buyerId, shipping_fee: shipmentFeeThb },
                        stream.seller_id,
                        sellerRegion,
                    );
                } catch (feeErr: any) {
                    errors.push(`buyer ${buyerId}: ${feeErr?.message ?? feeErr}`);
                }

                createdShipments.push({
                    id: shipmentId,
                    buyerId,
                    orders: buyerOrders.length,
                    shippingFee: shipmentFeeThb,
                    shippingFeeOrderId: feeOrderId,
                });
            } catch (err: any) {
                errors.push(`buyer ${buyerId}: ${err?.message ?? err}`);
            }
        }

        await admin.from('streams').update({ settled_at: new Date().toISOString() }).eq('id', stream.id);

        if (errors.length > 0) {
            console.error('[Live/Settle] partial settle:', errors);
        }

        return NextResponse.json({
            success: errors.length === 0,
            shipments: createdShipments,
            skippedBuyers,
            feeOrdersBackfilled,
            errors,
        });
    } catch (err: any) {
        console.error('[Live/Settle] error:', err);
        return NextResponse.json({ error: 'Settle failed' }, { status: 500 });
    }
}
