/**
 * Buyer problem reports and post-delivery reviews: the rules shared by the API
 * routes and the three Track Order surfaces (mobile Profile, desktop Orders, the
 * /orders/[id] page). Isomorphic on purpose: no server imports.
 *
 * The Cardstreet Guarantee is a policy (identity-verified sellers, fast bans, the
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

/**
 * Statuses from payment onward. lib/fulfillOrder puts the card in the buyer's
 * collection when the order is paid, not on delivery, so every one of these
 * can tell the buyer it is there. Disputed and cancelled orders are left out:
 * their card may be on its way back out.
 */
const PAID_ONWARD_STATUSES = ['paid', 'label_generated', 'processing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed'];

/** A live-break spot has no card of its own, so fulfilment adds nothing for it. */
export function cardAddedToCollection(status: string, isBreakOrder: boolean): boolean {
    return !isBreakOrder && PAID_ONWARD_STATUSES.includes(status);
}

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

/**
 * Seller non-performance ladder (the seller-ships-we-track model, 2026-11).
 * Reminders go out at 24/48/72h (app/api/cron/ship-reminders). From
 * BUYER_CANCEL_AFTER_DAYS the buyer may ask to cancel (a support ticket via
 * /api/orders/cancel-unshipped; the team refunds from the admin order page); at AUTO_CANCEL_AFTER_DAYS the
 * cancel-unshipped-orders cron refunds on its own. Both run through
 * lib/orderRefunds. A parcel the seller shipped themselves with no tracking
 * signal auto-completes AUTO_COMPLETE_AFTER_DAYS after it was marked shipped
 * (reconcile-shipments), unless the buyer reported it first.
 */
// Seven, not four (founder, 2026-11-12): four days asked for a refund while
// slow but honest sellers were still getting to a branch. The automatic
// cancel stays one day behind the request, as it was.
export const BUYER_CANCEL_AFTER_DAYS = 7;
export const AUTO_CANCEL_AFTER_DAYS = 8;
export const AUTO_COMPLETE_AFTER_DAYS = 14;

/** Order statuses in which nothing has left the seller yet. */
export const UNSHIPPED_STATUSES = ['paid', 'processing', 'label_generated'];

/** Label statuses that mean no carrier has scanned the parcel. */
const UNSCANNED_LABEL_STATUSES = ['created', 'awaiting_manual'];

export interface UnshippedCheckLabel {
    tracking_number?: string | null;
    status?: string | null;
    handed_off_at?: string | null;
}

/**
 * Paid, and the parcel has not left: no Flash scan of any label the seller
 * minted, and the seller has not said it shipped another way. A label row by
 * itself is not shipping; most label_generated parcels are still on the
 * seller's desk.
 */
export function isUnshippedOrder(
    order: { status: string; break_spot_id?: string | null },
    label: UnshippedCheckLabel | null | undefined,
): boolean {
    if (order.break_spot_id) return false;
    if (!UNSHIPPED_STATUSES.includes(order.status)) return false;
    if (!label) return true;
    if (label.handed_off_at) return false;
    return !label.status || UNSCANNED_LABEL_STATUSES.includes(label.status);
}

/** The moment a buyer may cancel an unshipped order themselves, or null for an unparseable timestamp. */
export function buyerCancelDate(createdAt: string | null | undefined): Date | null {
    const t = createdAt ? Date.parse(createdAt) : NaN;
    if (!Number.isFinite(t)) return null;
    return new Date(t + BUYER_CANCEL_AFTER_DAYS * 864e5);
}

export function canBuyerCancelUnshipped(
    order: { status: string; created_at: string | null | undefined; break_spot_id?: string | null },
    label: UnshippedCheckLabel | null | undefined,
    now: number = Date.now(),
): boolean {
    if (!isUnshippedOrder(order, label)) return false;
    const due = buyerCancelDate(order.created_at);
    return !!due && due.getTime() <= now;
}
