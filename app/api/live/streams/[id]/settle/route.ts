/**
 * POST /api/live/streams/[id]/settle — settlement after a stream ends: group
 * the stream's PAID spot orders into ONE shipments row per buyer PER LOT
 * (one Flash parcel per break the buyer bought into, one waybill each).
 *
 * Per LOT, not per stream (supersedes the earlier Smart-Bundling-style
 * per-stream parcel): since 20260816_first_checkout_shipping the buyer pays a
 * Flash-quoted base fee on their FIRST purchase from EACH lot (+ optional
 * per-spot increments), so each break's collected shipping funds its own
 * parcel. Settle charges NOTHING — it records the SUM of shipping already
 * collected on the group's orders in shipments.shipping_fee, weighs the
 * parcel from THAT lot's snapshots only, and creates the row at 'pending',
 * ready for label mint. The old model's `liveship_` fee order is retired;
 * the 'awaiting_shipping_fee' status stays in the enum for legacy rows
 * (lib/liveSpotFulfillment still flips any in-flight ones).
 *
 * Idempotent: a (buyer, lot) pair that already has a shipment is skipped, a
 * concurrent insert losing on idx_shipments_one_per_lot_buyer (23505) adopts
 * the winner's row, and only orders with shipment_id still NULL are grouped —
 * a re-run after a partial failure picks up exactly the groups that were
 * missed. Buyers holding a legacy per-STREAM shipment (stream_item_id NULL,
 * from a settle run before 20260817_parcel_per_lot) are skipped wholesale:
 * that parcel already covers all their lots.
 *
 * Pre-migration fail-soft: until 20260817_parcel_per_lot runs, the
 * stream_item_id column doesn't exist (42703 / PGRST204). Settle then falls
 * back to the previous per-stream grouping (one parcel per buyer for the
 * whole stream, adopted on the old per-stream unique index) so mid-transition
 * streams still settle.
 */

import { NextResponse } from 'next/server';

// No external calls remain (shipping was quoted and charged at spot
// checkout), but a big break is still one group-loop of sequential DB writes.
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

interface ExistingShipmentRow {
    id: string;
    buyer_id: string;
    stream_item_id: string | null;
}

/** 42703 = column truly absent; PGRST204 = absent from PostgREST's schema
 *  cache. Either means 20260817_parcel_per_lot hasn't run yet. */
function isMissingLotColumn(err: { code?: string; message?: string } | null): boolean {
    if (!err) return false;
    if (err.code === '42703' || err.code === 'PGRST204') return true;
    return /stream_item_id/.test(err.message ?? '');
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
            return NextResponse.json({ success: true, shipments: [], skippedGroups: 0 });
        }

        // 'paid' is the terminal state a finalized spot order sits in — spot
        // orders never enter the per-order label pipeline, so later statuses
        // don't occur here. pending_payment (buyer never paid) and any
        // cancelled/refunded rows are excluded. shipping_fee rides along:
        // each lot's first-purchase row carries that lot's collected base fee
        // (other rows 0 or increments), and the lot's shipment records the sum.
        const { data: orders } = await admin
            .from('orders')
            .select('id, buyer_id, seller_id, status, shipment_id, break_spot_id, shipping_fee')
            .in('id', orderIds)
            .eq('status', 'paid')
            .returns<SpotOrderRow[]>();

        const eligible = (orders ?? []).filter(o => o.shipment_id === null);

        // ─── Existing shipments (idempotency) + per-lot column probe ───
        // One query does double duty: it reads what earlier runs created AND
        // detects whether 20260817_parcel_per_lot has been applied. On 42703 /
        // PGRST204 (column missing) we drop to the legacy per-stream grouping
        // so settle never breaks mid-transition.
        let perLot = true;
        let existingShipments: ExistingShipmentRow[] = [];
        {
            const { data, error } = await admin
                .from('shipments')
                .select('id, buyer_id, stream_item_id')
                .eq('stream_id', stream.id)
                .returns<ExistingShipmentRow[]>();
            if (error && isMissingLotColumn(error)) {
                perLot = false;
                const { data: legacy } = await admin
                    .from('shipments')
                    .select('id, buyer_id')
                    .eq('stream_id', stream.id)
                    .returns<{ id: string; buyer_id: string }[]>();
                existingShipments = (legacy ?? []).map(s => ({ ...s, stream_item_id: null }));
            } else {
                existingShipments = data ?? [];
            }
        }

        // A legacy per-stream shipment (stream_item_id NULL) already bundles
        // ALL of that buyer's lots from this stream — skip the buyer entirely
        // rather than minting per-lot parcels alongside it.
        const legacySettledBuyers = new Set(
            existingShipments.filter(s => s.stream_item_id === null).map(s => s.buyer_id),
        );
        const settledPairs = new Set(
            existingShipments
                .filter(s => s.stream_item_id !== null)
                .map(s => `${s.buyer_id}|${s.stream_item_id}`),
        );

        // ─── Group: per-lot mode -> (buyer, lot); legacy fallback -> buyer ───
        const groups = new Map<string, { buyerId: string; lotId: string | null; orders: SpotOrderRow[] }>();
        let skippedGroups = 0;
        const skippedKeys = new Set<string>();
        for (const order of eligible) {
            const lotId = perLot
                ? (spotByOrderId.get(order.id)?.stream_item_id ?? null)
                : null;
            const key = lotId === null ? order.buyer_id : `${order.buyer_id}|${lotId}`;
            if (
                legacySettledBuyers.has(order.buyer_id) ||
                (lotId !== null && settledPairs.has(key))
            ) {
                if (!skippedKeys.has(key)) {
                    skippedKeys.add(key);
                    skippedGroups++;
                }
                continue;
            }
            const group = groups.get(key) ?? { buyerId: order.buyer_id, lotId, orders: [] };
            group.orders.push(order);
            groups.set(key, group);
        }

        const errors: string[] = [];

        if (groups.size === 0) {
            await admin.from('streams').update({ settled_at: new Date().toISOString() }).eq('id', stream.id);
            return NextResponse.json({
                success: true,
                shipments: [],
                skippedGroups,
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

        const buyerIds = [...new Set([...groups.values()].map(g => g.buyerId))];
        const { data: buyerProfiles } = await admin
            .from('profiles')
            .select(SHIPPING_PROFILE_COLS)
            .in('id', buyerIds)
            .returns<ShippingProfile[]>();
        const buyerById = new Map((buyerProfiles ?? []).map(p => [p.id, p]));

        const createdShipments: {
            id: string;
            buyerId: string;
            streamItemId: string | null;
            orders: number;
            shippingFee: number;
        }[] = [];

        for (const [, group] of groups) {
            const { buyerId, lotId, orders: groupOrders } = group;
            try {
                const buyer = buyerById.get(buyerId);

                // Weight model: one parcel item per spot, carrying the lot's
                // sealed flags — in per-lot mode every item comes from THIS
                // lot's snapshot (the legacy fallback spans the buyer's lots).
                // A random_pack spot really holds packs_per_spot loose packs,
                // not the whole box — the per-type sealed weights plus the
                // 500g floor over-quote slightly, which is the platform-safe
                // direction (Flash bills actual at pickup).
                const items: ParcelItemInfo[] = groupOrders.map(o => {
                    const lot = lotById.get(spotByOrderId.get(o.id)?.stream_item_id ?? '');
                    const cd = (lot?.card_data ?? {}) as { isSealed?: boolean; productType?: string | null };
                    return { isSealed: cd.isSealed === true, productType: cd.productType ?? null };
                });
                const weightGrams = estimateParcelWeightGramsForItems(items);

                // What the buyer ALREADY paid in freight for this group's
                // orders (the lot's base quote + any per-spot increments) —
                // pure bookkeeping on the waybill record; nothing new is
                // charged.
                const collectedSatang = groupOrders.reduce(
                    (sum, o) => sum + Math.round(Number(o.shipping_fee || 0) * 100),
                    0,
                );

                const { data: shipment, error: shipmentErr } = await admin
                    .from('shipments')
                    .insert({
                        buyer_id: buyerId,
                        seller_id: stream.seller_id,
                        // stream_id stays for provenance; stream_item_id is
                        // the parcel's grain (NULL only on the legacy path).
                        stream_id: stream.id,
                        ...(perLot ? { stream_item_id: lotId } : {}),
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
                    // 23505 on idx_shipments_one_per_lot_buyer (or, on the
                    // legacy path, the old per-stream index): a concurrent
                    // settle already created this group's shipment. Adopt it —
                    // the shipment_id CAS below is idempotent — instead of
                    // dropping the group.
                    if (shipmentErr?.code !== '23505') {
                        errors.push(`buyer ${buyerId} lot ${lotId ?? 'stream'}: shipment insert failed (${shipmentErr?.message})`);
                        continue;
                    }
                    const refetch = admin
                        .from('shipments')
                        .select('id, shipping_fee')
                        .eq('buyer_id', buyerId);
                    const { data: adopted } = await (perLot && lotId !== null
                        ? refetch.eq('stream_item_id', lotId)
                        : refetch.eq('stream_id', stream.id)
                    ).maybeSingle<{ id: string; shipping_fee: number }>();
                    if (!adopted) {
                        errors.push(`buyer ${buyerId} lot ${lotId ?? 'stream'}: shipment conflict but refetch found none`);
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
                    .in('id', groupOrders.map(o => o.id))
                    .is('shipment_id', null);

                createdShipments.push({
                    id: shipmentId,
                    buyerId,
                    streamItemId: lotId,
                    orders: groupOrders.length,
                    shippingFee: shipmentFeeThb,
                });
            } catch (err: any) {
                errors.push(`buyer ${buyerId} lot ${lotId ?? 'stream'}: ${err?.message ?? err}`);
            }
        }

        await admin.from('streams').update({ settled_at: new Date().toISOString() }).eq('id', stream.id);

        if (errors.length > 0) {
            console.error('[Live/Settle] partial settle:', errors);
        }

        return NextResponse.json({
            success: errors.length === 0,
            shipments: createdShipments,
            skippedGroups,
            errors,
        });
    } catch (err: any) {
        console.error('[Live/Settle] error:', err);
        return NextResponse.json({ error: 'Settle failed' }, { status: 500 });
    }
}
