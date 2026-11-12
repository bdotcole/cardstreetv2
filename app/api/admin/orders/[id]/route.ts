/**
 * GET /api/admin/orders/[id]: admin only. One order with everything the
 * support team needs to act on it (lib/adminOrders.ts AdminOrderDetail): the
 * cards in the checkout, amounts, the parcel, the timeline, the buyer's and
 * seller's contact details (email from auth, phone and address from profiles,
 * the seller's Stripe state), the tickets that mention the order or come from
 * either party, and their support-shop conversations. Read-only: actions stay
 * where they are (dispute close on the ticket, bans on User Reports).
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SUPPORT_CHAT_USER_ID, findThreadBetween, isUnread } from '@/lib/chat.server'
import { UUID_RE, shortOrderId, type AdminOrderDetail, type AdminOrderThread, type AdminOrderTicket } from '@/lib/adminOrders'
import { ORDER_SELECT, itemOf, loadCheckoutSizes, loadContact, loadPeople, num, toListItem, type OrderRow } from '@/lib/adminOrders.server'

export const dynamic = 'force-dynamic'

type Admin = ReturnType<typeof createAdminClient>

async function loadThread(admin: Admin, personId: string | null): Promise<AdminOrderThread | null> {
    if (!personId || personId === SUPPORT_CHAT_USER_ID) return null
    const { data } = await findThreadBetween(admin, SUPPORT_CHAT_USER_ID, personId)
    if (!data) return null
    return {
        id: data.id,
        personId,
        lastMessageAt: data.last_message_at,
        preview: data.last_message_preview,
        unread: isUnread(data, SUPPORT_CHAT_USER_ID),
    }
}

interface TicketRow { id: string; subject: string; status: string; created_at: string; user_id: string }

async function loadTickets(admin: Admin, order: OrderRow): Promise<AdminOrderTicket[]> {
    const short = shortOrderId(order.id)
    const parties = [order.buyer_id, order.seller_id].filter((x): x is string => !!x)
    const [about, fromParties, linked] = await Promise.all([
        // A problem report writes "Order: <id>" into its description; a person
        // writing in by hand usually quotes the #short id in the subject.
        admin.from('support_tickets').select('id, subject, status, created_at, user_id')
            .or(`description.ilike.%${order.id}%,subject.ilike.%${short}%`)
            .order('created_at', { ascending: false }).limit(10),
        parties.length
            ? admin.from('support_tickets').select('id, subject, status, created_at, user_id')
                .in('user_id', parties).order('created_at', { ascending: false }).limit(10)
            : Promise.resolve({ data: [] as TicketRow[], error: null }),
        order.dispute_ticket_id
            ? admin.from('support_tickets').select('id, subject, status, created_at, user_id').eq('id', order.dispute_ticket_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ])
    const aboutIds = new Set<string>([
        ...((about.data ?? []) as TicketRow[]).map(t => t.id),
        ...(linked.data ? [(linked.data as TicketRow).id] : []),
    ])
    const rows = new Map<string, TicketRow>()
    for (const t of [...(linked.data ? [linked.data as TicketRow] : []), ...((about.data ?? []) as TicketRow[]), ...((fromParties.data ?? []) as TicketRow[])]) rows.set(t.id, t)
    return [...rows.values()]
        .map(t => ({ id: t.id, subject: t.subject, status: t.status, createdAt: t.created_at, userId: t.user_id, aboutThisOrder: aboutIds.has(t.id) }))
        .sort((a, b) => Number(b.aboutThisOrder) - Number(a.aboutThisOrder) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const admin = createAdminClient()
    const { data: row, error } = await admin.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle<OrderRow>()
    if (error) {
        console.error('[admin/orders] order read failed:', error.message)
        return NextResponse.json({ error: 'Could not load the order' }, { status: 500 })
    }
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // The whole checkout: every order row under the same payment.
    const siblings = row.transfer_group
        ? ((await admin.from('orders').select(ORDER_SELECT).eq('transfer_group', row.transfer_group).order('created_at', { ascending: true })).data ?? []) as OrderRow[]
        : [row]
    const rows = siblings.some(s => s.id === row.id) ? siblings : [row, ...siblings]

    const [people, sizes, buyerContact, sellerContact, buyerThread, sellerThread, tickets, refund, review] = await Promise.all([
        loadPeople(admin, rows),
        loadCheckoutSizes(admin, [row]),
        loadContact(admin, row.buyer_id, false),
        loadContact(admin, row.seller_id, true),
        loadThread(admin, row.buyer_id),
        loadThread(admin, row.seller_id),
        loadTickets(admin, row),
        admin.from('order_refunds').select('note, created_at').eq('order_id', id).maybeSingle<{ note: string | null; created_at: string }>(),
        admin.from('reviews').select('rating, comment').eq('order_id', id).maybeSingle<{ rating: number; comment: string | null }>(),
    ])

    const base = toListItem(row, people, sizes)
    const label = parcelLabelRow(row)
    const detail: AdminOrderDetail = {
        ...base,
        items: rows.map(itemOf),
        amounts: {
            total: rows.reduce((s, r) => s + num(r.total_amount), 0),
            shipping: rows.reduce((s, r) => s + num(r.shipping_fee ?? r.shipping_amount), 0),
            platformFee: rows.reduce((s, r) => s + num(r.platform_fee), 0),
            discount: rows.reduce((s, r) => s + num(r.discount_amount), 0),
        },
        payment: {
            intentId: row.stripe_payment_intent_id ?? null,
            method: row.payment_method,
            region: row.stripe_region ?? null,
            // An order past pending_payment was paid even if the id write was lost.
            paid: !!row.payment_id || !['cancelled', 'pending', 'pending_payment'].includes(row.status),
        },
        cancelReason: row.cancel_reason ?? null,
        times: {
            created: row.created_at,
            labelCreated: label?.created_at ?? null,
            handedOff: label?.handed_off_at ?? null,
            delivered: row.delivered_at ?? null,
            completed: row.completed_at ?? null,
            disputeOpened: row.dispute_opened_at ?? null,
            disputeResolved: row.dispute_resolved_at ?? null,
            sellerCleared: row.seller_cleared_at ?? null,
            shipReminders: Number(row.ship_reminder_count) || 0,
            lastShipReminder: row.ship_reminder_sent_at ?? null,
        },
        dispute: row.dispute_reason || row.dispute_opened_at || row.status === 'disputed'
            ? {
                reason: row.dispute_reason ?? null,
                details: row.dispute_details ?? null,
                outcome: row.dispute_outcome ?? null,
                statusBefore: row.status_before_dispute ?? null,
            }
            : null,
        refund: refund.data ? { note: refund.data.note, at: refund.data.created_at } : null,
        review: review.data ? { rating: review.data.rating, comment: review.data.comment } : null,
        buyerContact,
        sellerContact,
        tickets,
        threads: [buyerThread, sellerThread].filter((t): t is AdminOrderThread => !!t),
    }

    return NextResponse.json({ order: detail }, { headers: { 'Cache-Control': 'no-store' } })
}

function parcelLabelRow(row: OrderRow) {
    const l = row.shipping_labels
    return Array.isArray(l) ? l[0] ?? null : l
}
