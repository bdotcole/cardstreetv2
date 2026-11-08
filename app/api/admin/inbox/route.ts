/**
 * GET /api/admin/inbox: admin only. Everything users send the team, in one
 * list, newest activity first (lib/supportInbox.ts):
 *   - DMs with the "Cardstreet TCG Marketplace" support shop (chat_threads)
 *   - support tickets, incl. buyer problem reports on an order (support_tickets)
 *   - listing and seller reports (reports)
 *   → { items: InboxItem[], counts: { needsReply, unread } }
 *
 * Each source fails soft: a missing table or a failed read drops that source
 * from the list (and logs) instead of blanking the whole inbox.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SUPPORT_CHAT_USER_ID, THREAD_COLUMNS, UUID_RE, isUnread, otherOf, type ThreadRow } from '@/lib/chat.server'
import { loadChatUsers } from '@/lib/supportChat.server'
import { inboxKey, type InboxItem, type InboxPerson } from '@/lib/supportInbox'

export const dynamic = 'force-dynamic'

const LIMIT = 300
const PREVIEW_CHARS = 200
type Admin = ReturnType<typeof createAdminClient>

interface TicketRow {
    id: string
    subject: string
    description: string
    category: string | null
    status: string
    admin_reply: string | null
    replied_at: string | null
    created_at: string
    user_id: string
}
interface TicketMessageRow { ticket_id: string; sender_role: 'user' | 'admin'; body: string; created_at: string }
interface ReportRow {
    id: string
    created_at: string
    status: string
    reason: string
    description: string | null
    entity_type: string
    entity_id: string
    entity_name: string | null
    reporter_id: string
}
interface ListingRow {
    id: string
    seller_id: string
    card_id: string | null
    status: string | null
    price: number | null
    image_front_url: string | null
    card_data: { name?: string; images?: { small?: string }; imageUrl?: string } | null
}

const clip = (text: string | null | undefined) => {
    const flat = (text ?? '').replace(/\s+/g, ' ').trim()
    return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}
const latest = (...isos: (string | null | undefined)[]) =>
    isos.filter((x): x is string => !!x).sort((a, b) => Date.parse(b) - Date.parse(a))[0]

function logFailure(source: string, error: { message?: string } | null) {
    if (error) console.error(`[admin/inbox] ${source} read failed:`, error.message ?? error)
}

async function loadListings(admin: Admin, ids: string[]): Promise<Map<string, ListingRow>> {
    const map = new Map<string, ListingRow>()
    for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await admin
            .from('listings')
            .select('id, seller_id, card_id, status, price, image_front_url, card_data')
            .in('id', ids.slice(i, i + 100))
        logFailure('listings', error)
        for (const l of (data ?? []) as ListingRow[]) map.set(l.id, l)
    }
    return map
}

export async function GET() {
    const gate = await requireAdmin()
    if (gate) return gate

    const admin = createAdminClient()
    const support = SUPPORT_CHAT_USER_ID

    const [threadsRes, ticketsRes, ticketMsgsRes, disputesRes, reportsRes] = await Promise.all([
        admin
            .from('chat_threads')
            .select(THREAD_COLUMNS)
            .or(`buyer_id.eq.${support},seller_id.eq.${support}`)
            .not('last_message_at', 'is', null)
            .order('last_message_at', { ascending: false })
            .limit(LIMIT),
        admin
            .from('support_tickets')
            .select('id, subject, description, category, status, admin_reply, replied_at, created_at, user_id')
            .order('created_at', { ascending: false })
            .limit(LIMIT),
        // Newest first, so each ticket's first row here is its latest message.
        admin
            .from('support_ticket_messages')
            .select('ticket_id, sender_role, body, created_at')
            .order('created_at', { ascending: false })
            .limit(1000),
        admin
            .from('orders')
            .select('id, dispute_ticket_id')
            .not('dispute_ticket_id', 'is', null)
            .limit(1000),
        admin
            .from('reports')
            .select('id, created_at, status, reason, description, entity_type, entity_id, entity_name, reporter_id')
            .order('created_at', { ascending: false })
            .limit(LIMIT),
    ])
    logFailure('chat_threads', threadsRes.error)
    logFailure('support_tickets', ticketsRes.error)
    logFailure('support_ticket_messages', ticketMsgsRes.error)
    logFailure('orders', disputesRes.error)
    logFailure('reports', reportsRes.error)

    const threads = (threadsRes.data ?? []) as ThreadRow[]
    const tickets = (ticketsRes.data ?? []) as TicketRow[]
    const reports = (reportsRes.data ?? []) as ReportRow[]

    const lastTicketMsg = new Map<string, TicketMessageRow>()
    for (const m of (ticketMsgsRes.data ?? []) as TicketMessageRow[]) {
        if (!lastTicketMsg.has(m.ticket_id)) lastTicketMsg.set(m.ticket_id, m)
    }
    const disputeOrder = new Map<string, string>()
    for (const o of (disputesRes.data ?? []) as { id: string; dispute_ticket_id: string }[]) {
        disputeOrder.set(o.dispute_ticket_id, o.id)
    }

    const listingIds = [...new Set(reports
        .filter(r => r.entity_type === 'listing' && UUID_RE.test(r.entity_id))
        .map(r => r.entity_id))]
    const listings = await loadListings(admin, listingIds)

    const personIds: string[] = [
        ...threads.map(t => otherOf(t, support)),
        ...tickets.map(t => t.user_id),
        ...reports.map(r => r.reporter_id).filter(id => UUID_RE.test(id ?? '')),
        ...reports.filter(r => r.entity_type === 'seller' && UUID_RE.test(r.entity_id)).map(r => r.entity_id),
        ...[...listings.values()].map(l => l.seller_id),
    ]
    const people = await loadChatUsers(admin, personIds)
    const person = (id: string | null | undefined): InboxPerson | null =>
        id ? (people.get(id) ?? { id, username: null, display_name: null, avatar_url: null }) : null

    const items: InboxItem[] = []

    for (const t of threads) {
        const fromTeam = t.last_sender_id === support
        items.push({
            key: inboxKey('dm', t.id),
            kind: 'dm',
            id: t.id,
            person: person(otherOf(t, support)),
            title: null,
            preview: clip(t.last_message_preview),
            previewFromTeam: fromTeam,
            lastAt: t.last_message_at!,
            status: '',
            needsReply: !fromTeam,
            unread: isUnread(t, support),
            category: null,
            orderId: null,
            report: null,
        })
    }

    for (const t of tickets) {
        const last = lastTicketMsg.get(t.id)
        let preview: string
        let fromTeam: boolean
        if (last) {
            preview = last.body
            fromTeam = last.sender_role === 'admin'
        } else if (t.admin_reply) {
            // Pre-thread tickets carry their one answer on the ticket row.
            preview = t.admin_reply
            fromTeam = true
        } else {
            preview = t.description
            fromTeam = false
        }
        items.push({
            key: inboxKey('ticket', t.id),
            kind: 'ticket',
            id: t.id,
            person: person(t.user_id),
            title: t.subject,
            preview: clip(preview),
            previewFromTeam: fromTeam,
            lastAt: latest(t.created_at, last?.created_at, t.replied_at)!,
            status: t.status,
            needsReply: t.status !== 'Resolved' && !fromTeam,
            unread: false,
            category: t.category,
            orderId: disputeOrder.get(t.id) ?? null,
            report: null,
        })
    }

    for (const r of reports) {
        const listing = r.entity_type === 'listing' ? listings.get(r.entity_id) : undefined
        const targetId = listing?.seller_id ?? (r.entity_type === 'seller' ? r.entity_id : null)
        items.push({
            key: inboxKey('report', r.id),
            kind: 'report',
            id: r.id,
            person: UUID_RE.test(r.reporter_id ?? '') ? person(r.reporter_id) : null,
            title: r.reason,
            preview: clip(r.description) || (r.entity_name ? `Reported ${r.entity_type}: ${r.entity_name}` : null),
            previewFromTeam: false,
            lastAt: r.created_at,
            status: r.status,
            needsReply: r.status === 'Open',
            unread: false,
            category: null,
            orderId: null,
            report: {
                reason: r.reason,
                description: r.description,
                entityType: r.entity_type,
                entityId: r.entity_id,
                entityName: r.entity_name,
                listing: listing ? {
                    id: listing.id,
                    cardId: listing.card_id,
                    cardName: listing.card_data?.name ?? r.entity_name ?? null,
                    photo: listing.image_front_url ?? listing.card_data?.images?.small ?? listing.card_data?.imageUrl ?? null,
                    price: listing.price,
                    status: listing.status,
                } : null,
                target: targetId && UUID_RE.test(targetId) ? person(targetId) : null,
            },
        })
    }

    items.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))

    return NextResponse.json(
        {
            items,
            counts: {
                needsReply: items.filter(i => i.needsReply).length,
                unread: items.filter(i => i.unread).length,
            },
        },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}
