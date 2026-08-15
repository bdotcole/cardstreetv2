/**
 * POST /api/live/streams/[id]/settle — Smart-Bundling settlement after a
 * stream ends: group each buyer's PAID spot orders into ONE shipments row
 * (one Flash parcel, one waybill).
 *
 * Settle charges NOTHING. Since 20260816_first_checkout_shipping shipping is
 * collected at spot checkout — a Flash-quoted base fee on the buyer's FIRST
 * purchase from EACH lot (additional spots from a lot add only its optional
 * per-spot increment) — so this route only records the SUM of shipping
 * already collected on the grouped orders in shipments.shipping_fee —
 * bookkeeping for the waybill — and shipments start at 'pending', ready for
 * label mint. The old model's `liveship_` fee order
 * is retired; the 'awaiting_shipping_fee' status stays in the enum for
 * legacy rows (lib/liveSpotFulfillment still flips any in-flight ones).
 *
 * Idempotent: a buyer who already has a shipment for this stream is skipped,
 * and only orders with shipment_id still NULL are grouped — a re-run after a
 * partial failure picks up exactly the buyers that were missed.
 */

import { NextResponse } from 'next/server';

// No external calls remain (shipping was quoted and charged at spot
// checkout), but a big break is still one buyer-loop of sequential DB writes.
// 300s keeps a 100-buyer show comfortably inside the budget; the idempotency
// contract above covers anything that could still exhaust it.
export const runtime = 'nodejs';
export const maxDuration = 300;
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';
import {
    estimateParcelWeightGramsForItems,
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
    shipping_fee: number | null;
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
        // cancelled/refunded rows are excluded. shipping_fee rides along:
        // each lot's first-purchase row carries that lot's collected base fee
        // (other rows 0 or increments), and the shipment records the sum.
        const { data: orders } = await admin
            .from('orders')
            .select('id, buyer_id, seller_id, status, shipment_id, break_spot_id, shipping_fee')
            .in('id', orderIds)
            .eq('status', 'paid')
            .returns<SpotOrderRow[]>();

        const eligible = (orders ?? []).filter(o => o.shipment_id === null);

        // Idempotency: buyers already settled in a previous run keep their
        // shipment untouched.
        const { data: existingShipments } = await admin
            .from('shipments')
            .select('id, buyer_id')
            .eq('stream_id', stream.id)
            .returns<{ id: string; buyer_id: string }[]>();
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

        const errors: string[] = [];

        if (byBuyer.size === 0) {
            await admin.from('streams').update({ settled_at: new Date().toISOString() }).eq('id', stream.id);
            return NextResponse.json({
                success: true,
                shipments: [],
                skippedBuyers,
                errors,
            });
        }

        // ─── Lot snapshots for weights + buyer profiles for the address ───
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

                // What the buyer ALREADY paid in freight across their batches
                // (a base quote per lot they bought from + any per-spot
                // increments — possibly several base fees, one per break) —
                // pure bookkeeping on the waybill record; nothing new is
                // charged.
                const collectedSatang = buyerOrders.reduce(
                    (sum, o) => sum + Math.round(Number(o.shipping_fee || 0) * 100),
                    0,
                );

                const { data: shipment, error: shipmentErr } = await admin
                    .from('shipments')
                    .insert({
                        buyer_id: buyerId,
                        seller_id: stream.seller_id,
                        stream_id: stream.id,
                        // Shipping is already collected — the parcel is ready
                        // for label mint immediately.
                        status: 'pending',
                        shipping_fee: collectedSatang / 100,
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
                let shipmentFeeThb = collectedSatang / 100;
                if (shipmentErr || !shipment) {
                    // 23505 on the (stream_id, buyer_id) unique index: a
                    // concurrent settle already created this buyer's shipment.
                    // Adopt it — the shipment_id CAS below is idempotent —
                    // instead of dropping the buyer.
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
                    // The winner's stored record is the binding one.
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

                createdShipments.push({
                    id: shipmentId,
                    buyerId,
                    orders: buyerOrders.length,
                    shippingFee: shipmentFeeThb,
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
            errors,
        });
    } catch (err: any) {
        console.error('[Live/Settle] error:', err);
        return NextResponse.json({ error: 'Settle failed' }, { status: 500 });
    }
}
