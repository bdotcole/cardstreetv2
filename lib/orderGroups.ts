/**
 * Grouping for the order-display surfaces (buyer orders, seller shipments,
 * sales history).
 *
 * A multi-item checkout inserts one `orders` row per listing, all sharing a
 * `transfer_group` — one payment, one parcel, one shipping fee (see
 * app/api/orders/checkout and lib/fulfillOrder). The per-row shape is the
 * bookkeeping unit; the PURCHASE is the transfer group. List views render one
 * card per group so a five-card checkout reads as a single order with five
 * items instead of five unrelated orders.
 *
 * Rows without a transfer_group (defensive — every checkout since the column
 * shipped stamps it) fall back to a singleton group keyed by the row id.
 * Insertion order is preserved: a group sits where its first row appeared in
 * the (created_at DESC) list, and rows of one checkout share created_at so
 * they arrive adjacent anyway.
 */
export interface TransferGroupableRow {
    id: string;
    transfer_group?: string | null;
}

export function groupByTransferGroup<T extends TransferGroupableRow>(rows: T[]): T[][] {
    const byKey = new Map<string, T[]>();
    for (const row of rows) {
        const key = row.transfer_group || row.id;
        const bucket = byKey.get(key);
        if (bucket) bucket.push(row);
        else byKey.set(key, [row]);
    }
    return [...byKey.values()];
}

/**
 * Parcel grouping for the SELLER's shipment surfaces.
 *
 * The seller mints the Flash waybill when they are ready (lib/parcels) and
 * may put several of one buyer's checkouts in it, so the waybill is the thing
 * the seller packs and labels and the "To ship" list groups by it. Rows with
 * no real waybill yet (label not created, MANUAL placeholder, PENDING claim)
 * fall back to the checkout grouping above.
 */
export interface ParcelGroupableRow extends TransferGroupableRow {
    shipping_labels?: { tracking_number?: string | null }[] | null;
}

/**
 * A Flash waybill of ours, as opposed to a placeholder: MANUAL (a region
 * error, support handles it), PENDING (a claim in flight), N/A, or SELF (the
 * seller shipped the parcel themselves; the carrier and number live in the
 * handoff columns, lib/parcels shipSelf). Only a real waybill is polled at
 * Flash or printed.
 */
export function isRealWaybill(trackingNumber: string | null | undefined): trackingNumber is string {
    return (
        !!trackingNumber &&
        trackingNumber !== 'MANUAL' &&
        trackingNumber !== 'N/A' &&
        trackingNumber !== 'PENDING' &&
        trackingNumber !== 'SELF'
    );
}

export function parcelKey(row: ParcelGroupableRow): string {
    const pno = row.shipping_labels?.[0]?.tracking_number;
    if (isRealWaybill(pno)) return `pno:${pno}`;
    return row.transfer_group || row.id;
}

export function groupByParcel<T extends ParcelGroupableRow>(rows: T[]): T[][] {
    const byKey = new Map<string, T[]>();
    for (const row of rows) {
        const key = parcelKey(row);
        const bucket = byKey.get(key);
        if (bucket) bucket.push(row);
        else byKey.set(key, [row]);
    }
    return [...byKey.values()];
}

/** How many separate checkouts a parcel group holds (1 = an ordinary parcel). */
export function countCheckouts(group: TransferGroupableRow[]): number {
    return new Set(group.map((r) => r.transfer_group || r.id)).size;
}

/**
 * What the seller told us when the parcel left outside our Flash waybill
 * (migration 20261016_shipping_label_handoff.sql; written by lib/parcels
 * handOffParcel). All null for a parcel that travels under the waybill.
 */
export interface HandoffFields {
    handoff_carrier?: string | null;
    handoff_tracking_number?: string | null;
    handed_off_at?: string | null;
}

export interface ShipmentRow extends ParcelGroupableRow {
    status: string;
    buyer_id?: string | null;
    break_spot_id?: string | null;
    shipping_labels?: ({ tracking_number?: string | null; status?: string | null } & HandoffFields)[] | null;
}

/** A label row exists and is not a half-made PENDING claim. */
export function hasShippingLabel(row: { shipping_labels?: { tracking_number?: string | null }[] | null }): boolean {
    const pno = row.shipping_labels?.[0]?.tracking_number;
    return !!pno && pno !== 'PENDING';
}

/**
 * The seller may say this parcel left another way: label_generated with a
 * label row (a real waybill or the MANUAL placeholder; a PENDING claim is not
 * a label yet) that Flash has not scanned and nobody has handed off. Mirrors
 * the server rule in lib/parcels handOffParcel. Any pickup_status qualifies:
 * a cancelled courier or a planned drop-off is exactly the parcel a seller
 * carries to a Flash counter, where staff key it in under a new number.
 */
export function isHandoffable(row: ShipmentRow): boolean {
    if (row.break_spot_id) return false;
    if (row.status !== 'label_generated') return false;
    if (!hasShippingLabel(row)) return false;
    const label = row.shipping_labels?.[0];
    if (label?.handed_off_at) return false;
    return !label?.status || label.status === 'created' || label.status === 'awaiting_manual';
}

/**
 * The carrier and number a handed-off parcel travels under, for the buyer's
 * tracking line and the seller's card; null while the parcel is Flash's.
 */
export function handoffOf(
    label: HandoffFields | null | undefined,
): { carrier: string | null; trackingNumber: string | null } | null {
    if (!label?.handed_off_at && !label?.handoff_carrier) return null;
    return {
        carrier: label.handoff_carrier || null,
        trackingNumber: label.handoff_tracking_number || null,
    };
}

/**
 * Paid, no waybill yet: the seller still has to create the label. Mirrors the
 * server rule in lib/parcels (LABEL_READY_STATUSES, no real waybill). A
 * PENDING claim counts as "still awaiting" so the button stays visible; a
 * second click is refused server-side while the first is in flight.
 */
export function isAwaitingLabel(row: ShipmentRow): boolean {
    if (row.break_spot_id) return false;
    if (row.status !== 'paid' && row.status !== 'processing') return false;
    const pno = row.shipping_labels?.[0]?.tracking_number;
    if (pno === 'MANUAL') return false;
    return !isRealWaybill(pno);
}

/**
 * A labelled parcel Flash has not scanned yet: still on the seller's desk, so
 * the buyer's later orders can be added to it (lib/parcels attachToParcel).
 */
export function isUnscannedParcel(row: ShipmentRow): boolean {
    if (row.break_spot_id) return false;
    if (row.status !== 'label_generated') return false;
    const label = row.shipping_labels?.[0];
    if (!label || !isRealWaybill(label.tracking_number)) return false;
    return !label.status || label.status === 'created';
}

/**
 * How a labelled parcel reaches Flash. Sellers choose when they create the
 * label: a courier pickup was booked for every label until 2026-10, without
 * the seller being told, and Flash cancelled 6 of 7 of those pickups because
 * the courier found nobody home or nothing packed. A pickup is now booked
 * only when the seller asks for one.
 */
export type ShipMethod = 'pickup' | 'dropoff';

/**
 * Flash never pushes a pickup cancellation. The hourly cron
 * app/api/cron/reconcile-pickups reads Flash's ticket list and flips a
 * cancelled booking to pickup_status 'cancelled' (isPickupCancelled), which
 * clears this wait. Until it has, a parcel still unscanned this long after
 * its booking may book another: long enough that a courier on today's round
 * is not double-booked, short enough to rebook for tomorrow. Enforced
 * server-side by lib/parcels bookPickup.
 */
export const PICKUP_REBOOK_AFTER_MS = 6 * 60 * 60 * 1000;

interface PickupLabel {
    pickup_status?: string | null;
    updated_at?: string | null;
}

/**
 * Flash cancelled the courier that was booked for this parcel (set by the
 * reconcile-pickups cron). Nothing is booked any more, so the seller may
 * book again at once or drop the parcel off; pickupBookedAt is null here,
 * which is what lets bookPickup skip the rebook window.
 */
export function isPickupCancelled(labels: (PickupLabel | null | undefined)[]): boolean {
    return labels.some((l) => l?.pickup_status === 'cancelled') && pickupBookedAt(labels) === null;
}

/**
 * When the parcel's courier pickup was booked (ms), or null if none is.
 * Rows added to a parcel later copy its pickup fields with a newer
 * updated_at, so the earliest booked row is the booking itself.
 */
export function pickupBookedAt(labels: (PickupLabel | null | undefined)[]): number | null {
    let earliest: number | null = null;
    for (const label of labels) {
        if (label?.pickup_status !== 'scheduled') continue;
        const at = Date.parse(label.updated_at || '');
        if (Number.isNaN(at)) continue;
        if (earliest === null || at < earliest) earliest = at;
    }
    return earliest;
}

/** Buyer id -> the parcel groups whose every row satisfies `predicate`. */
export function parcelsByBuyer<T extends ShipmentRow>(
    parcels: T[][],
    predicate: (row: T) => boolean,
): Map<string, T[][]> {
    const byBuyer = new Map<string, T[][]>();
    for (const group of parcels) {
        const buyerId = group[0]?.buyer_id;
        if (!buyerId) continue;
        if (!group.every(predicate)) continue;
        byBuyer.set(buyerId, [...(byBuyer.get(buyerId) || []), group]);
    }
    return byBuyer;
}

// ---------------------------------------------------------------------------
// Money as the seller and the buyer should see it
// ---------------------------------------------------------------------------

export interface OrderMoneyRow {
    total_amount?: number | null;
    platform_fee?: number | null;
    /** Collector Pass voucher taken off the buyer's charge (20260829_collector_pass_store.sql). */
    discount_amount?: number | null;
}

/**
 * What the platform took from this sale, as the seller should see it.
 *
 * A buyer voucher is paid out of OUR fee, never out of the seller's proceeds
 * (TH direct charges make that mandatory), and /api/orders/checkout stores
 * `platform_fee` ALREADY REDUCED by the voucher, with `discount_amount`
 * recording the cut. `total_amount - platform_fee` therefore overstates the
 * seller's money by the voucher. The seller's real fee is the normal one,
 * platform_fee + discount_amount, and their net does not move: a voucher sale
 * and a plain sale of the same card pay the seller the same amount, which is
 * the whole point of funding vouchers from the fee.
 */
export function sellerFeeOf(row: OrderMoneyRow): number {
    return (Number(row.platform_fee) || 0) + (Number(row.discount_amount) || 0);
}

/** The seller's gross for a sale (list price minus the platform fee), before Stripe's processing fee. */
export function sellerNetOf(row: OrderMoneyRow): number {
    return (Number(row.total_amount) || 0) - sellerFeeOf(row);
}

/** What the buyer was charged for one order row: the list price less their voucher share (shipping is inside the price since 2026-09-27). */
export function buyerPaidOf(row: OrderMoneyRow): number {
    return (Number(row.total_amount) || 0) - (Number(row.discount_amount) || 0);
}
