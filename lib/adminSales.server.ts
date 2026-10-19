import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// An order counts as a sale once payment lands; pending_payment carts and
// cancellations are excluded (see the abandoned-checkout phantom-sale fix).
export const PAID_ORDER_STATUSES = ['paid', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed']

export const SOLD_LISTINGS_PAGE_SIZE = 20

export interface SoldListingRow {
    id: string
    cardName: string | null
    cardNumber: string | null
    image: string | null
    seller: string | null
    buyer: string | null
    totalAmount: number
    status: string
    createdAt: string
}

export interface SoldListingsPage {
    rows: SoldListingRow[]
    total: number
    page: number
    pageSize: number
}

/**
 * One page of the admin dashboard's Sold Listings table: paid orders, newest
 * first. Shared by the dashboard's first render and /api/admin/sales so both
 * read the same rows.
 *
 * No seller filter: a real shop run by an admin is still a real sale, and
 * dropping those left this list all but empty.
 */
export async function getSoldListingsPage(page: number): Promise<SoldListingsPage | { error: string }> {
    const supabase = createAdminClient()
    const from = (page - 1) * SOLD_LISTINGS_PAGE_SIZE

    // Narrow JSON paths instead of the whole card_data blob. The id tiebreak
    // keeps paging stable: one checkout's orders share a created_at, and
    // without it a row could repeat on two pages or fall between them.
    const { data, error, count } = await supabase
        .from('orders')
        .select(`
            id, total_amount, status, created_at,
            listing:listings(cardName:card_data->>name, cardNumber:card_data->>number, image:card_data->images->>small, imageUrl:card_data->>imageUrl),
            buyer:profiles!orders_buyer_id_fkey(display_name),
            seller:profiles!orders_seller_id_fkey(display_name)
        `, { count: 'exact' })
        .in('status', PAID_ORDER_STATUSES)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + SOLD_LISTINGS_PAGE_SIZE - 1)

    if (error) return { error: error.message }

    const rows: SoldListingRow[] = (data ?? []).map((o: any) => ({
        id: o.id,
        cardName: o.listing?.cardName ?? null,
        cardNumber: o.listing?.cardNumber ?? null,
        image: o.listing?.image ?? o.listing?.imageUrl ?? null,
        seller: o.seller?.display_name ?? null,
        buyer: o.buyer?.display_name ?? null,
        totalAmount: Number(o.total_amount) || 0,
        status: String(o.status),
        createdAt: o.created_at,
    }))

    return { rows, total: count ?? 0, page, pageSize: SOLD_LISTINGS_PAGE_SIZE }
}
