/**
 * GET /api/admin/users/[id]/overview: admin only. What is going on with one
 * person's account, for the support team reading their message: who they are
 * and how to reach them, their listings, their sales (orders as seller) and
 * purchases (orders as buyer) with status and attention flags, open tickets,
 * and the support shop's conversation with them (lib/adminAccount.ts).
 * Read-only.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SUPPORT_CHAT_USER_ID, findThreadBetween } from '@/lib/chat.server'
import { UUID_RE } from '@/lib/adminOrders'
import type { AdminAccountListing, AdminAccountOverview } from '@/lib/adminAccount'
import { ORDER_SELECT, loadCheckoutSizes, loadContact, loadPeople, num, toListItem, type OrderRow } from '@/lib/adminOrders.server'

export const dynamic = 'force-dynamic'

const ORDERS_SHOWN = 15
const LISTINGS_SHOWN = 24

interface ListingRow {
    id: string
    card_id: string | null
    card_data: { name?: string; images?: { small?: string }; imageUrl?: string } | null
    price: number | string | null
    status: string
    condition: string | null
    image_front_url: string | null
    created_at: string
    sold_at: string | null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const admin = createAdminClient()
    const contact = await loadContact(admin, id, true)
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const count = (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) =>
        q.then(r => { if (r.error) console.error('[admin/users/overview] count failed:', r.error.message); return r.count ?? 0 })

    const [sellerRes, buyerRes, listingsRes, ordersAsSeller, ordersAsBuyer, activeListings, soldListings, openTickets, thread] = await Promise.all([
        admin.from('orders').select(ORDER_SELECT).eq('seller_id', id).order('created_at', { ascending: false }).limit(ORDERS_SHOWN),
        admin.from('orders').select(ORDER_SELECT).eq('buyer_id', id).order('created_at', { ascending: false }).limit(ORDERS_SHOWN),
        admin.from('listings')
            .select('id, card_id, card_data, price, status, condition, image_front_url, created_at, sold_at')
            .eq('seller_id', id)
            .neq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(LISTINGS_SHOWN),
        count(admin.from('orders').select('id', { count: 'exact', head: true }).eq('seller_id', id)),
        count(admin.from('orders').select('id', { count: 'exact', head: true }).eq('buyer_id', id)),
        count(admin.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', id).eq('status', 'active')),
        count(admin.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', id).eq('status', 'sold')),
        count(admin.from('support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', id).neq('status', 'Resolved')),
        id === SUPPORT_CHAT_USER_ID ? Promise.resolve({ data: null }) : findThreadBetween(admin, SUPPORT_CHAT_USER_ID, id),
    ])
    for (const [label, res] of [['sales', sellerRes], ['purchases', buyerRes], ['listings', listingsRes]] as const) {
        if (res.error) console.error(`[admin/users/overview] ${label} read failed:`, res.error.message)
    }

    const sellerRows = (sellerRes.data ?? []) as OrderRow[]
    const buyerRows = (buyerRes.data ?? []) as OrderRow[]
    const allRows = [...sellerRows, ...buyerRows]
    const [people, sizes] = await Promise.all([loadPeople(admin, allRows), loadCheckoutSizes(admin, allRows)])
    const now = Date.now()
    const sellerOrders = sellerRows.map(r => toListItem(r, people, sizes, now))
    const buyerOrders = buyerRows.map(r => toListItem(r, people, sizes, now))

    const listings: AdminAccountListing[] = ((listingsRes.data ?? []) as ListingRow[]).map(l => ({
        id: l.id,
        cardId: l.card_id,
        name: l.card_data?.name ?? null,
        image: l.image_front_url ?? l.card_data?.images?.small ?? l.card_data?.imageUrl ?? null,
        price: num(l.price),
        status: l.status,
        condition: l.condition,
        createdAt: l.created_at,
        soldAt: l.sold_at,
    }))

    const overview: AdminAccountOverview = {
        contact,
        stats: {
            activeListings,
            soldListings,
            ordersAsSeller,
            ordersAsBuyer,
            openTickets,
            needsAttention: [...sellerOrders, ...buyerOrders].filter(o => o.flags.length > 0).length,
        },
        sellerOrders,
        buyerOrders,
        listings,
        supportThreadId: thread.data?.id ?? null,
    }

    return NextResponse.json({ overview }, { headers: { 'Cache-Control': 'no-store' } })
}
