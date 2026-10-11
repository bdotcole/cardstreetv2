/**
 * Shop minimum order — one definition for the server gates and every screen
 * that warns the buyer before them.
 *
 * Shipping is inside every listing price, so a parcel costs the seller 30-40
 * baht whether it holds one card or ten. A shop minimum lets a seller list
 * commons at 10 baht each without losing money on a one-card order, and lets a
 * buyer fill a deck from one shop at a fair price. It replaces seller-defined
 * bundle discounts (founder decision, 2026-09-29).
 *
 * The rule: the buyer's total FROM THAT SHOP must reach the shop's minimum.
 * An accepted offer is exempt — the seller agreed to that sale at that price.
 *
 * Pure module apart from fetchSellerMinOrders, which takes whatever Supabase
 * client the caller already has (browser, server or service-role).
 */

/** Upper bound on a shop's minimum, mirrored by the CHECK in the migration. */
export const MIN_ORDER_MAX_THB = 5000;

export const MIN_ORDER_NOT_MET_ERROR_CODE = 'MIN_ORDER_NOT_MET';

/** Whole baht in [0, MIN_ORDER_MAX_THB]; anything unusable is 0 (no minimum). */
export function normalizeMinOrder(value: unknown): number {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
    return Math.min(MIN_ORDER_MAX_THB, Math.floor(n));
}

/** Baht still missing before checkout is allowed; 0 when there is no minimum or it is met. */
export function minOrderShortfall(subtotalThb: number, minOrderThb: unknown): number {
    const min = normalizeMinOrder(minOrderThb);
    if (min <= 0) return 0;
    const subtotal = Number.isFinite(subtotalThb) ? subtotalThb : 0;
    const short = min - subtotal;
    return short > 0 ? Math.ceil(short) : 0;
}

// Structural client type so the browser, server and admin clients all fit.
type QueryableClient = { from: (table: string) => any };

/**
 * Minimums for a set of sellers, keyed by seller id. Sellers with no minimum
 * are simply absent. Fails soft to "no minimums" on any error, including the
 * column not existing yet — a display helper must never block a purchase, and
 * the server gate reads through this same function.
 *
 * `table` is 'public_profiles' for cross-user reads from the browser and
 * 'profiles' for the service-role server routes.
 */
export async function fetchSellerMinOrders(
    supabase: QueryableClient,
    sellerIds: (string | null | undefined)[],
    table: 'public_profiles' | 'profiles' = 'public_profiles',
): Promise<Record<string, number>> {
    const unique = [...new Set(sellerIds.filter((x): x is string => !!x && x !== 'unknown'))];
    if (unique.length === 0) return {};
    try {
        const { data, error } = await supabase
            .from(table)
            .select('id, min_order_thb')
            .in('id', unique);
        if (error || !Array.isArray(data)) return {};
        const out: Record<string, number> = {};
        for (const row of data as { id: string; min_order_thb: unknown }[]) {
            const min = normalizeMinOrder(row?.min_order_thb);
            if (min > 0) out[row.id] = min;
        }
        return out;
    } catch {
        return {};
    }
}

/** "This shop has a ฿100 minimum order. Add ฿40 more from this shop to check out." */
export function minOrderMessage(isThai: boolean, minOrderThb: number, shortfallThb: number): string {
    const min = minOrderThb.toLocaleString();
    const short = shortfallThb.toLocaleString();
    return isThai
        ? `ร้านนี้มียอดสั่งซื้อขั้นต่ำ ฿${min} เพิ่มอีก ฿${short} จากร้านนี้เพื่อชำระเงิน`
        : `This shop has a ฿${min} minimum order. Add ฿${short} more from this shop to check out.`;
}

/** Short standing note for a listing or shop header: "Minimum order ฿100". */
export function minOrderNote(isThai: boolean, minOrderThb: number): string {
    const min = minOrderThb.toLocaleString();
    return isThai ? `ยอดสั่งซื้อขั้นต่ำของร้าน ฿${min}` : `Shop minimum order ฿${min}`;
}
