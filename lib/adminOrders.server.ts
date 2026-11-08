import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import { embedArray } from '@/lib/utils/embed'
import { loadChatUsers } from '@/lib/supportChat.server'
import { formatPickupAddress } from '@/lib/parcels'
import {
    OPEN_ORDER_STATUSES, UUID_RE, orderFlags, shortIdRange, shortOrderId,
    type AdminContact, type AdminOrderItem, type AdminOrderListItem, type AdminParcel, type AdminPerson, type ParsedOrderQuery,
} from '@/lib/adminOrders'

// Server side of the admin order lookup: the orders query, the search legs
// and the row-to-list-item mapping shared by /api/admin/orders and
// /api/admin/orders/[id].

type Admin = ReturnType<typeof createAdminClient>

export const ORDER_SELECT = `
    *,
    listing:listings(id, card_id, card_data, condition, price, is_graded, grading_company, grade, image_front_url, status),
    shipping_labels(*)
`

export interface ListingRow {
    id: string
    card_id: string | null
    card_data: { name?: string; images?: { small?: string }; imageUrl?: string } | null
    condition: string | null
    price: number | null
    is_graded: boolean | null
    grading_company: string | null
    grade: string | null
    image_front_url: string | null
    status: string | null
}

export interface LabelRow {
    tracking_number: string | null
    carrier_name: string | null
    status: string | null
    pickup_status: string | null
    pickup_cancelled_at: string | null
    handed_off_at: string | null
    handoff_carrier: string | null
    handoff_tracking_number: string | null
    label_url: string | null
    courier_tracking_url: string | null
    created_at: string | null
}

/** `*` from orders plus the two embeds; the columns this code reads are typed. */
export interface OrderRow {
    id: string
    buyer_id: string | null
    seller_id: string | null
    status: string
    total_amount: number | string | null
    platform_fee: number | string | null
    shipping_fee?: number | string | null
    shipping_amount?: number | string | null
    discount_amount?: number | string | null
    payment_method: string | null
    stripe_payment_intent_id?: string | null
    stripe_region?: string | null
    transfer_group: string | null
    break_spot_id?: string | null
    listing_id: string | null
    created_at: string
    updated_at: string | null
    delivered_at?: string | null
    completed_at?: string | null
    seller_cleared_at?: string | null
    ship_reminder_count?: number | null
    ship_reminder_sent_at?: string | null
    dispute_reason?: string | null
    dispute_details?: string | null
    dispute_opened_at?: string | null
    dispute_resolved_at?: string | null
    dispute_outcome?: string | null
    dispute_ticket_id?: string | null
    status_before_dispute?: string | null
    listing: ListingRow | ListingRow[] | null
    shipping_labels: LabelRow | LabelRow[] | null
}

export const num = (v: number | string | null | undefined) => Number(v) || 0

export function listingOf(row: OrderRow): ListingRow | null {
    return embedArray(row.listing)[0] ?? null
}

export function parcelOf(row: OrderRow): AdminParcel | null {
    const l = embedArray(row.shipping_labels)[0]
    if (!l) return null
    const real = l.tracking_number && l.tracking_number !== 'MANUAL' && l.tracking_number !== 'PENDING' && l.tracking_number !== 'N/A'
    return {
        trackingNumber: l.tracking_number,
        carrier: l.handoff_carrier || l.carrier_name || (real ? 'Flash Express' : null),
        labelStatus: l.status,
        pickupStatus: l.pickup_status,
        pickupCancelledAt: l.pickup_cancelled_at ?? null,
        handedOffAt: l.handed_off_at ?? null,
        handoffCarrier: l.handoff_carrier ?? null,
        handoffTrackingNumber: l.handoff_tracking_number ?? null,
        labelUrl: l.label_url,
        trackingUrl: l.courier_tracking_url ?? null,
        labelCreatedAt: l.created_at,
    }
}

export function itemOf(row: OrderRow): AdminOrderItem {
    const l = listingOf(row)
    const card = l?.card_data ?? null
    return {
        orderId: row.id,
        listingId: l?.id ?? row.listing_id,
        cardId: l?.card_id ?? null,
        name: card?.name ?? (row.break_spot_id ? 'Live break spot' : null),
        image: l?.image_front_url ?? card?.images?.small ?? card?.imageUrl ?? null,
        condition: l?.condition ?? null,
        graded: l?.is_graded ? [l.grading_company, l.grade].filter(Boolean).join(' ') || 'Graded' : null,
        amount: num(row.total_amount),
        status: row.status,
    }
}

export function toListItem(
    row: OrderRow,
    people: Map<string, AdminPerson>,
    checkoutSizes: Map<string, number>,
    now = Date.now(),
): AdminOrderListItem {
    const parcel = parcelOf(row)
    const item = itemOf(row)
    const isBreakOrder = !!row.break_spot_id
    return {
        id: row.id,
        shortId: shortOrderId(row.id),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        totalAmount: num(row.total_amount),
        transferGroup: row.transfer_group,
        checkoutSize: (row.transfer_group && checkoutSizes.get(row.transfer_group)) || 1,
        itemName: item.name,
        itemImage: item.image,
        isBreakOrder,
        buyer: row.buyer_id ? people.get(row.buyer_id) ?? { id: row.buyer_id, username: null, display_name: null, avatar_url: null } : null,
        seller: row.seller_id ? people.get(row.seller_id) ?? { id: row.seller_id, username: null, display_name: null, avatar_url: null } : null,
        parcel,
        flags: orderFlags({ status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, isBreakOrder }, parcel, now),
    }
}

export async function loadPeople(admin: Admin, rows: OrderRow[]): Promise<Map<string, AdminPerson>> {
    const ids = rows.flatMap(r => [r.buyer_id, r.seller_id]).filter((x): x is string => !!x)
    return loadChatUsers(admin, ids)
}

/** How many orders rows each checkout (transfer_group) holds, for the "1 of N" hint. */
export async function loadCheckoutSizes(admin: Admin, rows: OrderRow[]): Promise<Map<string, number>> {
    const sizes = new Map<string, number>()
    const groups = [...new Set(rows.map(r => r.transfer_group).filter((x): x is string => !!x))]
    for (let i = 0; i < groups.length; i += 100) {
        const { data } = await admin.from('orders').select('transfer_group').in('transfer_group', groups.slice(i, i + 100))
        for (const r of (data ?? []) as { transfer_group: string }[]) sizes.set(r.transfer_group, (sizes.get(r.transfer_group) ?? 0) + 1)
    }
    return sizes
}

const LIKE_STRIP = /[,()%\\]/g
const like = (s: string) => `%${s.replace(LIKE_STRIP, '')}%`

/** Users whose email contains `needle`. auth.users has no search API, so page through it (bounded). */
async function userIdsByEmail(admin: Admin, needle: string): Promise<string[]> {
    const ids: string[] = []
    for (let page = 1; page <= 5; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) { console.error('[admin/orders] listUsers failed:', error.message); break }
        for (const u of data.users) if (u.email?.toLowerCase().includes(needle)) ids.push(u.id)
        if (data.users.length < 1000) break
    }
    return ids
}

async function userIdsByProfile(admin: Admin, q: ParsedOrderQuery): Promise<string[]> {
    const legs: PromiseLike<{ data: { id: string }[] | null }>[] = []
    if (q.name) {
        legs.push(admin.from('profiles').select('id').ilike('username', like(q.name)).limit(25))
        legs.push(admin.from('profiles').select('id').ilike('display_name', like(q.name)).limit(25))
    }
    if (q.phone) {
        legs.push(admin.from('profiles').select('id').ilike('phone_number', like(q.phone)).limit(25))
        // Stored with dashes or spaces: try the text as typed too.
        if (q.text.replace(/\s+/g, '') !== q.phone) legs.push(admin.from('profiles').select('id').ilike('phone_number', like(q.text)).limit(25))
    }
    const results = await Promise.all(legs)
    return [...new Set(results.flatMap(r => (r.data ?? []).map(x => x.id)))]
}

/**
 * Every order the query could mean, newest first, capped. Direct legs (id,
 * short id, payment intent, waybill) and people legs (email, phone, username,
 * display name, then that person's orders as buyer or seller) are unioned.
 */
export async function searchOrders(admin: Admin, q: ParsedOrderQuery, limit = 100): Promise<OrderRow[]> {
    const byId = new Map<string, OrderRow>()
    const take = (rows: OrderRow[] | null | undefined) => { for (const r of rows ?? []) byId.set(r.id, r) }

    const direct: PromiseLike<{ data: OrderRow[] | null; error: { message: string } | null }>[] = []
    if (q.orderId) direct.push(admin.from('orders').select(ORDER_SELECT).eq('id', q.orderId))
    if (q.shortId) {
        const { low, high } = shortIdRange(q.shortId)
        direct.push(admin.from('orders').select(ORDER_SELECT).gte('id', low).lte('id', high).order('created_at', { ascending: false }).limit(limit))
    }
    if (q.paymentIntentId) direct.push(admin.from('orders').select(ORDER_SELECT).eq('stripe_payment_intent_id', q.paymentIntentId).limit(limit))
    if (q.text && !q.orderId && !q.paymentIntentId) {
        direct.push(admin.from('orders').select(ORDER_SELECT).eq('transfer_group', q.text).limit(limit))
    }
    if (q.tracking) {
        const labels = await admin
            .from('shipping_labels')
            .select('order_id')
            .or(`tracking_number.ilike.${like(q.tracking)},handoff_tracking_number.ilike.${like(q.tracking)}`)
            .limit(limit)
        const orderIds = (labels.data ?? []).map((l: { order_id: string }) => l.order_id)
        if (orderIds.length) direct.push(admin.from('orders').select(ORDER_SELECT).in('id', orderIds))
    }
    for (const res of await Promise.all(direct)) {
        if (res.error) console.error('[admin/orders] search leg failed:', res.error.message)
        take(res.data)
    }

    const userIds = [
        ...(q.email ? await userIdsByEmail(admin, q.email) : []),
        ...(q.name || q.phone ? await userIdsByProfile(admin, q) : []),
    ].filter(id => UUID_RE.test(id))
    if (userIds.length) {
        const list = [...new Set(userIds)].slice(0, 50).join(',')
        const { data, error } = await admin
            .from('orders')
            .select(ORDER_SELECT)
            .or(`buyer_id.in.(${list}),seller_id.in.(${list})`)
            .order('created_at', { ascending: false })
            .limit(limit)
        if (error) console.error('[admin/orders] people leg failed:', error.message)
        take(data as OrderRow[] | null)
    }

    return [...byId.values()]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, limit)
}

/** Open orders from the last 90 days that carry at least one flag, worst and oldest first. */
export async function attentionOrders(admin: Admin, now = Date.now()): Promise<OrderRow[]> {
    const since = new Date(now - 90 * 864e5).toISOString()
    const { data, error } = await admin
        .from('orders')
        .select(ORDER_SELECT)
        .in('status', OPEN_ORDER_STATUSES)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(500)
    if (error) throw new Error(error.message)
    return (data ?? []) as OrderRow[]
}

export async function recentOrders(admin: Admin, limit = 60): Promise<OrderRow[]> {
    const { data, error } = await admin
        .from('orders')
        .select(ORDER_SELECT)
        .order('created_at', { ascending: false })
        .limit(limit)
    if (error) throw new Error(error.message)
    return (data ?? []) as OrderRow[]
}

// ─── Contact details ─────────────────────────────────────────────────────────

const CONTACT_COLUMNS =
    'id, username, display_name, avatar_url, role, phone_number, address, sub_district, district, state, province, postcode, created_at, banned_at, chat_banned_until, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted'

interface ContactRow {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
    role?: string | null
    phone_number?: string | null
    address?: string | null
    sub_district?: string | null
    district?: string | null
    state?: string | null
    province?: string | null
    postcode?: string | null
    created_at?: string | null
    banned_at?: string | null
    chat_banned_until?: string | null
    stripe_account_id?: string | null
    stripe_charges_enabled?: boolean | null
    stripe_payouts_enabled?: boolean | null
    stripe_details_submitted?: boolean | null
}

/**
 * Who a person is and how to reach them: profile (service role, so phone and
 * address are visible) plus the sign-in email from auth. `seller` adds the
 * Stripe state. Never throws; a profile that cannot be read still returns the id.
 */
export async function loadContact(admin: Admin, id: string | null, seller: boolean): Promise<AdminContact | null> {
    if (!id) return null
    const first = await admin.from('profiles').select(CONTACT_COLUMNS).eq('id', id).maybeSingle<ContactRow>()
    let data = first.data
    if (first.error) {
        // A column from a later migration is missing: show who they are at least.
        console.error('[admin/orders] contact read failed:', first.error.message)
        data = (await admin.from('profiles').select('id, username, display_name, avatar_url').eq('id', id).maybeSingle<ContactRow>()).data
    }
    const auth = await admin.auth.admin.getUserById(id)
    const p = data ?? { id, username: null, display_name: null, avatar_url: null }
    return {
        id,
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        email: auth.data?.user?.email ?? null,
        phone: p.phone_number ?? null,
        address: formatPickupAddress(p),
        joinedAt: p.created_at ?? auth.data?.user?.created_at ?? null,
        bannedAt: p.banned_at ?? null,
        chatBannedUntil: p.chat_banned_until ?? null,
        role: p.role ?? null,
        stripe: seller
            ? {
                hasAccount: !!p.stripe_account_id,
                chargesEnabled: !!p.stripe_charges_enabled,
                payoutsEnabled: !!p.stripe_payouts_enabled,
                detailsSubmitted: !!p.stripe_details_submitted,
            }
            : null,
    }
}
