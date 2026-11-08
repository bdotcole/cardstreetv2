/**
 * The admin account overview: who a person is and what is going on with their
 * account, opened from any support conversation (inbox) or from an order.
 * Shared by /api/admin/users/[id]/overview and app/admin/_AccountDrawer.tsx.
 * Isomorphic: no server imports.
 */
import type { AdminContact, AdminOrderListItem } from './adminOrders'

export interface AdminAccountListing {
    id: string
    cardId: string | null
    name: string | null
    image: string | null
    price: number
    status: string
    condition: string | null
    createdAt: string
    soldAt: string | null
}

export interface AdminAccountOverview {
    contact: AdminContact
    stats: {
        activeListings: number
        soldListings: number
        ordersAsSeller: number
        ordersAsBuyer: number
        openTickets: number
        /** Among the recent orders shown: the ones carrying a flag. */
        needsAttention: number
    }
    /** Newest first, capped. */
    sellerOrders: AdminOrderListItem[]
    buyerOrders: AdminOrderListItem[]
    listings: AdminAccountListing[]
    /** The support shop's conversation with them, if one exists. */
    supportThreadId: string | null
}

export const LISTING_STATUS_TONE: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    sold: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30',
    draft: 'bg-white/5 text-slate-400 border-white/10',
    paused: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    cancelled: 'bg-slate-700/60 text-slate-400 border-slate-600',
    removed: 'bg-brand-red/10 text-rose-300 border-brand-red/30',
}
