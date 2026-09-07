/**
 * Buyer problem reports and post-delivery reviews: the rules shared by the API
 * routes and the three Track Order surfaces (mobile Profile, desktop Orders, the
 * /orders/[id] page). Isomorphic on purpose: no server imports.
 *
 * The CardStreet Guarantee is a policy (identity-verified sellers, fast bans, the
 * buyer made whole from platform funds). This module is the path a buyer takes
 * to invoke it, and the window in which they can.
 */

export const DISPUTE_REASONS = ['not_received', 'not_as_described', 'damaged', 'other'] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

/** Days after delivery (or completion) during which a buyer can still report. */
export const REPORT_WINDOW_DAYS = 7;

/** In-flight statuses: "not received" can be raised at any time. */
const REPORTABLE_IN_FLIGHT = ['shipped', 'in_transit', 'out_for_delivery'];

/** Statuses a buyer may review from. Matches the reviews INSERT policy. */
export const REVIEWABLE_STATUSES = ['delivered', 'completed'];

/** Locale keys for each reason, under the orderActions namespace. */
export const DISPUTE_REASON_KEYS: Record<DisputeReason, string> = {
    not_received: 'orderActions.reasonNotReceived',
    not_as_described: 'orderActions.reasonNotAsDescribed',
    damaged: 'orderActions.reasonDamaged',
    other: 'orderActions.reasonOther',
};

export function canReportOrder(
    order: { status: string; delivered_at?: string | null; completed_at?: string | null },
    now: number = Date.now(),
): boolean {
    if (REPORTABLE_IN_FLIGHT.includes(order.status)) return true;
    if (order.status === 'delivered' || order.status === 'completed') {
        const anchor = order.delivered_at || order.completed_at;
        if (!anchor) return true;
        const t = Date.parse(anchor);
        return !Number.isFinite(t) || now - t <= REPORT_WINDOW_DAYS * 864e5;
    }
    return false;
}

export function canReviewOrder(order: { status: string }): boolean {
    return REVIEWABLE_STATUSES.includes(order.status);
}

/**
 * Seller handling window, in days. Matches the Product JSON-LD's handlingTime
 * (minValue 1, maxValue 2) on every card page, so the promise a buyer read in a
 * search result, the ship-by date on the order page, and the seller's reminders
 * all quote the same number.
 */
export const HANDLING_DAYS = 2;

/** The date a paid order should have left the seller, or null for an unparseable timestamp. */
export function shipByDate(createdAt: string | null | undefined): Date | null {
    const t = createdAt ? Date.parse(createdAt) : NaN;
    if (!Number.isFinite(t)) return null;
    return new Date(t + HANDLING_DAYS * 864e5);
}
