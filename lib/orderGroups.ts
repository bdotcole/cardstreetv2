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
