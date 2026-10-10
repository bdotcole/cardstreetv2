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

export function isRealWaybill(trackingNumber: string | null | undefined): trackingNumber is string {
    return (
        !!trackingNumber &&
        trackingNumber !== 'MANUAL' &&
        trackingNumber !== 'N/A' &&
        trackingNumber !== 'PENDING'
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

export interface ShipmentRow extends ParcelGroupableRow {
    status: string;
    buyer_id?: string | null;
    break_spot_id?: string | null;
    shipping_labels?: { tracking_number?: string | null; status?: string | null }[] | null;
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
