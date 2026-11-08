/**
 * GET /api/admin/orders: admin only. The order lookup list (lib/adminOrders.ts).
 *
 *   ?q=<text>        every order the text could mean: order id or #short id,
 *                    Stripe PaymentIntent, Flash waybill or handoff tracking
 *                    number, buyer/seller email, phone, username or display
 *                    name (their orders as either side)
 *   ?view=attention  (default without q) open orders that carry a flag: a
 *                    problem report, no label a day after payment, no Flash
 *                    scan after two days, a cancelled courier pickup, a
 *                    parcel with no movement for a week
 *   ?view=recent     the latest orders of any status
 *
 *   → { view, query, items: AdminOrderListItem[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseOrderQuery, worstTone, type AdminOrderListItem } from '@/lib/adminOrders'
import { attentionOrders, loadCheckoutSizes, loadPeople, recentOrders, searchOrders, toListItem } from '@/lib/adminOrders.server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    const gate = await requireAdmin()
    if (gate) return gate

    const admin = createAdminClient()
    const params = request.nextUrl.searchParams
    const parsed = parseOrderQuery(params.get('q') ?? '')
    const view = parsed.text ? 'search' : params.get('view') === 'recent' ? 'recent' : 'attention'
    const now = Date.now()

    try {
        const rows = view === 'search'
            ? await searchOrders(admin, parsed)
            : view === 'recent'
                ? await recentOrders(admin)
                : await attentionOrders(admin, now)

        const [people, sizes] = await Promise.all([loadPeople(admin, rows), loadCheckoutSizes(admin, rows)])
        let items: AdminOrderListItem[] = rows.map(r => toListItem(r, people, sizes, now))

        if (view === 'attention') {
            const rank = { red: 0, amber: 1, slate: 2 }
            items = items
                .filter(i => i.flags.length > 0)
                .sort((a, b) => {
                    const ta = worstTone(a.flags)!, tb = worstTone(b.flags)!
                    return rank[ta] - rank[tb] || Date.parse(a.createdAt) - Date.parse(b.createdAt)
                })
        }

        return NextResponse.json({ view, query: parsed.text, items }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (e) {
        console.error('[admin/orders] list failed:', e)
        return NextResponse.json({ error: 'Could not load orders' }, { status: 500 })
    }
}
