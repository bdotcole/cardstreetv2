/**
 * The admin order lookup (/admin/orders): what the support team sees when a
 * buyer or seller writes in about an order. Shared by /api/admin/orders (list
 * and search), /api/admin/orders/[id] (one order with both parties' contact
 * details) and the page. Isomorphic: no server imports.
 *
 * "Needs attention" is computed, not stored: the same order row plus its
 * label row says whether a parcel is late, a courier never came, a buyer
 * reported a problem. The thresholds mirror the crons that act on them
 * (ship-reminders at 24/48/72h, reconcile-pickups for cancelled couriers) so
 * the list shows what those crons are emailing about.
 */

export type FlagTone = 'red' | 'amber' | 'slate'

export interface OrderFlag {
    code: string
    label: string
    tone: FlagTone
}

export interface AdminPerson {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
}

/** Contact details the support team may see (service-role read of profiles + auth). */
export interface AdminContact extends AdminPerson {
    email: string | null
    phone: string | null
    /** One line, the way lib/parcels prints it on a waybill. */
    address: string | null
    joinedAt: string | null
    bannedAt: string | null
    chatBannedUntil: string | null
    role: string | null
    /** Seller only. */
    stripe: { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; hasAccount: boolean } | null
}

export interface AdminParcel {
    trackingNumber: string | null
    carrier: string | null
    labelStatus: string | null
    pickupStatus: string | null
    pickupCancelledAt: string | null
    handedOffAt: string | null
    handoffCarrier: string | null
    handoffTrackingNumber: string | null
    labelUrl: string | null
    trackingUrl: string | null
    labelCreatedAt: string | null
}

export interface AdminOrderListItem {
    id: string
    shortId: string
    status: string
    createdAt: string
    updatedAt: string | null
    totalAmount: number
    transferGroup: string | null
    /** How many orders rows share the checkout (1 = a single-card purchase). */
    checkoutSize: number
    itemName: string | null
    itemImage: string | null
    isBreakOrder: boolean
    buyer: AdminPerson | null
    seller: AdminPerson | null
    parcel: AdminParcel | null
    flags: OrderFlag[]
}

export interface AdminOrderItem {
    orderId: string
    listingId: string | null
    cardId: string | null
    name: string | null
    image: string | null
    condition: string | null
    graded: string | null
    amount: number
    status: string
}

export interface AdminOrderTicket {
    id: string
    subject: string
    status: string
    createdAt: string
    userId: string
    /** The ticket names this order (a problem report, or the order id in its text). */
    aboutThisOrder: boolean
}

export interface AdminOrderThread {
    id: string
    personId: string
    lastMessageAt: string | null
    preview: string | null
    unread: boolean
}

export interface AdminOrderDetail extends AdminOrderListItem {
    items: AdminOrderItem[]
    amounts: { total: number; shipping: number; platformFee: number; discount: number }
    payment: { intentId: string | null; method: string | null; region: string | null }
    times: {
        created: string
        labelCreated: string | null
        handedOff: string | null
        delivered: string | null
        completed: string | null
        disputeOpened: string | null
        disputeResolved: string | null
        sellerCleared: string | null
        shipReminders: number
        lastShipReminder: string | null
    }
    dispute: { reason: string | null; details: string | null; outcome: string | null; statusBefore: string | null } | null
    refund: { note: string | null; at: string } | null
    review: { rating: number; comment: string | null } | null
    buyerContact: AdminContact | null
    sellerContact: AdminContact | null
    tickets: AdminOrderTicket[]
    threads: AdminOrderThread[]
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
    pending: 'Awaiting payment',
    pending_payment: 'Awaiting payment',
    paid: 'Paid, no label yet',
    processing: 'Processing',
    label_generated: 'Label created',
    shipped: 'Shipped',
    in_transit: 'In transit',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
    completed: 'Completed',
    cancelled: 'Cancelled',
    disputed: 'Disputed',
}

export const ORDER_STATUS_TONE: Record<string, string> = {
    pending: 'bg-slate-700/60 text-slate-300 border-slate-600',
    pending_payment: 'bg-slate-700/60 text-slate-300 border-slate-600',
    paid: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    processing: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    label_generated: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    shipped: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30',
    in_transit: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30',
    out_for_delivery: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30',
    delivered: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    completed: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    cancelled: 'bg-slate-700/60 text-slate-400 border-slate-600',
    disputed: 'bg-brand-red/10 text-rose-300 border-brand-red/30',
}

export const statusLabel = (status: string) => ORDER_STATUS_LABEL[status] ?? status.replace(/_/g, ' ')

/** Order statuses that can still need the team: anything paid and not finished. */
export const OPEN_ORDER_STATUSES = ['paid', 'processing', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'disputed']

const HOUR = 3600e3
const DAY = 24 * HOUR
/** A paid order should have its label within a day; the safety-net cron mints one at 24h. */
const NO_LABEL_AFTER_MS = 24 * HOUR
/** A label with no Flash scan after two days is the parcel the ship reminders chase. */
const UNSCANNED_AFTER_MS = 48 * HOUR
/** At 72h the seller has had both reminders and the inbox is paged. */
const UNSHIPPED_PAGE_MS = 72 * HOUR
/** Flash domestic delivery is 1-3 days; a week without a status change is stuck. */
const IN_TRANSIT_STUCK_MS = 7 * DAY

export const hoursAgo = (iso: string, now = Date.now()) => Math.max(0, Math.round((now - Date.parse(iso)) / HOUR))
export const daysAgo = (iso: string, now = Date.now()) => Math.max(0, Math.round((now - Date.parse(iso)) / DAY))

const isUnscanned = (p: AdminParcel | null) =>
    !p || (!p.handedOffAt && (!p.labelStatus || p.labelStatus === 'created' || p.labelStatus === 'awaiting_manual' || p.labelStatus === 'pending'))

/**
 * Why an order is in the "Needs attention" list, worst first. Empty means it
 * is moving normally. Age counts from the order row's creation, which is
 * payment time for a checkout (an auction win sits unpaid first, so its first
 * flag can be a little early).
 */
export function orderFlags(
    o: { status: string; createdAt: string; updatedAt: string | null; isBreakOrder: boolean },
    parcel: AdminParcel | null,
    now = Date.now(),
): OrderFlag[] {
    const flags: OrderFlag[] = []
    const age = now - Date.parse(o.createdAt)

    if (o.status === 'disputed') flags.push({ code: 'disputed', label: 'Problem reported', tone: 'red' })

    // Live-break spot orders ship when the stream settles, on their own clock.
    if (!o.isBreakOrder) {
        if ((o.status === 'paid' || o.status === 'processing') && age >= NO_LABEL_AFTER_MS) {
            flags.push({ code: 'no_label', label: `No label ${hoursAgo(o.createdAt, now)}h after payment`, tone: age >= UNSHIPPED_PAGE_MS ? 'red' : 'amber' })
        }
        if (o.status === 'label_generated' && isUnscanned(parcel) && age >= UNSCANNED_AFTER_MS) {
            flags.push({
                code: 'unshipped',
                label: age >= UNSHIPPED_PAGE_MS ? `Not shipped ${daysAgo(o.createdAt, now)}d after payment` : `Not shipped ${hoursAgo(o.createdAt, now)}h after payment`,
                tone: age >= UNSHIPPED_PAGE_MS ? 'red' : 'amber',
            })
        }
        if (o.status === 'label_generated' && parcel?.pickupStatus === 'cancelled' && !parcel.handedOffAt) {
            flags.push({ code: 'pickup_cancelled', label: 'Courier cancelled the pickup', tone: 'amber' })
        }
        if (o.status === 'label_generated' && parcel?.trackingNumber === 'MANUAL' && !parcel.handedOffAt) {
            flags.push({ code: 'manual_label', label: 'Flash could not make the label', tone: 'amber' })
        }
    }

    if (o.status === 'shipped' || o.status === 'in_transit' || o.status === 'out_for_delivery') {
        const since = Date.parse(o.updatedAt || o.createdAt)
        if (now - since >= IN_TRANSIT_STUCK_MS) {
            flags.push({ code: 'stuck_in_transit', label: `No movement for ${Math.round((now - since) / DAY)}d`, tone: now - since >= 2 * IN_TRANSIT_STUCK_MS ? 'red' : 'amber' })
        }
    }

    const rank: Record<FlagTone, number> = { red: 0, amber: 1, slate: 2 }
    return flags.sort((a, b) => rank[a.tone] - rank[b.tone])
}

export const worstTone = (flags: OrderFlag[]): FlagTone | null =>
    flags.some(f => f.tone === 'red') ? 'red' : flags.some(f => f.tone === 'amber') ? 'amber' : flags.length ? 'slate' : null

export const FLAG_TONE_CLASS: Record<FlagTone, string> = {
    red: 'bg-brand-red/15 text-rose-300 border-brand-red/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    slate: 'bg-white/5 text-slate-400 border-white/10',
}

// ─── Search ──────────────────────────────────────────────────────────────────

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ParsedOrderQuery {
    /** Trimmed, with a leading # removed. */
    text: string
    /** A full order id. */
    orderId: string | null
    /** The 8-char id prefix shown as #XXXXXXXX (lowercase hex; 6-8 chars accepted). */
    shortId: string | null
    /** A Stripe PaymentIntent id. */
    paymentIntentId: string | null
    /** Digits only, Thai national form, when the query reads as a phone number. */
    phone: string | null
    /** Lowercased, when the query contains an @. */
    email: string | null
    /** A waybill or other tracking number candidate (letters/digits, 8+ chars, no spaces). */
    tracking: string | null
    /** Free text for username / display name matching (2+ chars). */
    name: string | null
}

/**
 * What a support agent pastes in: "#7096EB9E", a full id, a Flash waybill
 * ("TH01449BC64B3A"), a phone, an email, a username or a display name. Legs
 * that could match are all tried; the API unions their results.
 */
export function parseOrderQuery(raw: string): ParsedOrderQuery {
    const text = raw.trim().replace(/^#/, '').trim()
    const q: ParsedOrderQuery = { text, orderId: null, shortId: null, paymentIntentId: null, phone: null, email: null, tracking: null, name: null }
    if (!text) return q
    const compact = text.replace(/\s+/g, '')

    if (UUID_RE.test(compact)) { q.orderId = compact.toLowerCase(); return q }
    if (/^pi_[A-Za-z0-9]+$/.test(compact)) { q.paymentIntentId = compact; return q }
    if (text.includes('@')) { q.email = text.toLowerCase(); return q }

    if (/^[0-9a-f]{6,8}$/i.test(compact)) q.shortId = compact.toLowerCase()

    const digits = compact.replace(/^\+66/, '0').replace(/^0066/, '0').replace(/[^\d]/g, '')
    if (/^[\d\s\-().+]+$/.test(text) && digits.length >= 6) q.phone = digits

    if (/^[A-Za-z0-9-]{8,}$/.test(compact) && /\d/.test(compact)) q.tracking = compact

    if (!q.phone && text.length >= 2) q.name = text
    return q
}

/**
 * The uuid range whose first hex digits are `prefix`. UUIDs compare bytewise
 * in Postgres, so `id >= low AND id <= high` finds every order shown as
 * #PREFIX without casting the column to text.
 */
export function shortIdRange(prefix: string): { low: string; high: string } {
    const hex = prefix.toLowerCase()
    const pad = (fill: string) => (hex + fill.repeat(8)).slice(0, 8)
    return {
        low: `${pad('0')}-0000-0000-0000-000000000000`,
        high: `${pad('f')}-ffff-ffff-ffff-ffffffffffff`,
    }
}

export const shortOrderId = (id: string) => id.slice(0, 8).toUpperCase()

export const personName = (p: AdminPerson | null | undefined) =>
    p?.display_name?.trim() || p?.username || 'Unknown user'

export const flashTrackingUrl = (trackingNumber: string) =>
    `https://www.flashexpress.com/fle/tracking?se=${encodeURIComponent(trackingNumber)}`
