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
 * Two checkouts can end up in one Flash parcel: fulfillment attaches a
 * follow-up purchase to the buyer's still-unshipped waybill when it lands
 * within the auto-merge window, and the seller can combine parcels by hand
 * (lib/shipTogether). The waybill is then the thing the seller packs and
 * labels, so the "To ship" list groups by it. Rows with no real waybill yet
 * (label still being prepared, MANUAL placeholder) fall back to the checkout
 * grouping above, which is what they were before a waybill existed.
 */
export interface ParcelGroupableRow extends TransferGroupableRow {
    shipping_labels?: { tracking_number?: string | null }[] | null;
}

export function isRealWaybill(trackingNumber: string | null | undefined): trackingNumber is string {
    return !!trackingNumber && trackingNumber !== 'MANUAL' && trackingNumber !== 'N/A';
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
 * Can this row's parcel still be combined with another of the same buyer's?
 * True only while the label exists and Flash has not scanned the parcel:
 * status 'label_generated' with a real waybill whose label row is still
 * 'created'. Live-break spot orders are consolidated at settle instead.
 * Mirrors the server rules in lib/shipTogether.ts.
 */
export function canCombineParcel(row: {
    status: string;
    break_spot_id?: string | null;
    shipping_labels?: { tracking_number?: string | null; status?: string | null }[] | null;
}): boolean {
    if (row.break_spot_id) return false;
    if (row.status !== 'label_generated') return false;
    const label = row.shipping_labels?.[0];
    if (!label || !isRealWaybill(label.tracking_number)) return false;
    return !label.status || label.status === 'created';
}

export interface CombinableRow extends ParcelGroupableRow {
    status: string;
    buyer_id?: string | null;
    break_spot_id?: string | null;
    shipping_labels?: { tracking_number?: string | null; status?: string | null }[] | null;
}

/**
 * Buyer id -> that buyer's parcels still waiting on the seller's desk. A
 * buyer with two or more entries is a "ship together" candidate.
 */
export function combinableParcelsByBuyer<T extends CombinableRow>(parcels: T[][]): Map<string, T[][]> {
    const byBuyer = new Map<string, T[][]>();
    for (const group of parcels) {
        const buyerId = group[0]?.buyer_id;
        if (!buyerId) continue;
        if (!group.every((row) => canCombineParcel(row))) continue;
        byBuyer.set(buyerId, [...(byBuyer.get(buyerId) || []), group]);
    }
    return byBuyer;
}
