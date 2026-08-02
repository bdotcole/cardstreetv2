import { createAdminClient } from '@/lib/supabase/admin'
import { mapSupabaseCardToInternal } from '@/lib/cardMapper'
import WishlistBoard, { type WishlistBoardRow } from './_WishlistBoard'

// The admin dashboard queries Supabase at render time via the service-role
// client. Prerendering it at build would require Supabase env vars to be
// present at build time — but Vercel only injects them at runtime for server
// components. Force dynamic so this page is only ever rendered per request.
export const dynamic = 'force-dynamic'

interface StatCard {
    label: string
    value: string | number
    icon: string
    color: string
    sub?: string
}

// An order counts as a sale once payment lands; pending_payment carts and
// cancellations are excluded (see the abandoned-checkout phantom-sale fix).
const PAID_ORDER_STATUSES = ['paid', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed']

async function getOverviewStats() {
    const supabase = createAdminClient()

    const [usersRes, collectionsRes, listingsRes, ticketsRes, reportsRes, requestsRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('collection_items').select('id', { count: 'exact', head: true }),
        supabase.from('listings').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('support_tickets').select('id, status', { count: 'exact' }).neq('status', 'Resolved'),
        supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'Open'),
        supabase.from('card_requests').select('id', { count: 'exact', head: true }).eq('status', 'Open'),
    ])

    // Paid-order count + GMV. total_amount is the item value in baht (shipping
    // fee is a separate column). Paged because a single select caps at 1000 rows.
    const PAGE = 1000
    let paidOrders = 0
    let gmvBaht = 0
    for (let from = 0; ; from += PAGE) {
        const { data, count } = await supabase
            .from('orders')
            .select('total_amount', { count: 'exact' })
            .in('status', PAID_ORDER_STATUSES)
            .range(from, from + PAGE - 1)
        if (count != null) paidOrders = count
        for (const row of data ?? []) gmvBaht += Number(row.total_amount) || 0
        if (!data || data.length < PAGE) break
    }

    return {
        totalUsers: usersRes.count ?? 0,
        collectionItems: collectionsRes.count ?? 0,
        activeListings: listingsRes.count ?? 0,
        paidOrders,
        gmvBaht,
        openTickets: ticketsRes.count ?? 0,
        openReports: reportsRes.count ?? 0,
        openCardRequests: requestsRes.count ?? 0,
    }
}

async function getRecentTickets() {
    const supabase = createAdminClient()
    const { data } = await supabase
        .from('support_tickets')
        .select('id, subject, category, status, created_at, profiles!support_tickets_user_id_fkey(display_name)')
        .order('created_at', { ascending: false })
        .limit(5)
    return data ?? []
}

async function getTopPartners() {
    const supabase = createAdminClient()
    const { data } = await supabase
        .from('profiles')
        .select('id, display_name, total_downloads, partner_level')
        .not('partner_joined_at', 'is', null)
        .order('total_downloads', { ascending: false })
        .limit(5)
    return data ?? []
}

async function getRecentSales() {
    const supabase = createAdminClient()
    const { data } = await supabase
        .from('orders')
        .select(`
            id, total_amount, status, created_at,
            listing:listings(card_data),
            buyer:profiles!orders_buyer_id_fkey(display_name),
            seller:profiles!orders_seller_id_fkey(display_name)
        `)
        .in('status', PAID_ORDER_STATUSES)
        .order('created_at', { ascending: false })
        .limit(10)
    return data ?? []
}

async function getRecentOffers() {
    const supabase = createAdminClient()
    const { data } = await supabase
        .from('offers')
        .select(`
            id, amount, status, created_at,
            listing:listings(price, card_data),
            buyer:profiles!offers_buyer_id_fkey(display_name),
            seller:profiles!offers_seller_id_fkey(display_name)
        `)
        .order('created_at', { ascending: false })
        .limit(5)
    return data ?? []
}

// Cap on how many cards are shipped to the client for filtering. The whole
// board filters in the browser (instant, no round-trips), which is only sound
// while the payload stays small; the UI says so when the tail is cut.
const WISHLIST_BOARD_LIMIT = 400

// Feeds the weekly "Buy List" post: which cards do buyers want, and do any
// active listings exist to satisfy them? PostgREST has no GROUP BY, so page
// narrow JSON-path projections (never the full card_data blob) and count here.
// Facets (rarity, type, price) come from the live catalog rather than the
// wishlist's frozen card_data snapshot, so a card repriced since it was
// wishlisted sorts on today's number.
async function getWishlistBoard() {
    const supabase = createAdminClient()
    const PAGE = 1000
    const CHUNK = 100

    const agg = new Map<string, { wishers: number; lastAdded: string; snap: any }>()
    let totalWants = 0
    for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
            .from('wishlists')
            .select('card_id, added_at, snapName:card_data->>name, snapSet:card_data->>set, snapNumber:card_data->>number, snapImage:card_data->images->>small, snapImageUrl:card_data->>imageUrl, snapPrice:card_data->>marketPrice, snapRarity:card_data->>rarity, snapLang:card_data->>language')
            .order('added_at', { ascending: false })
            .order('id')
            .range(from, from + PAGE - 1)
        for (const row of (data ?? []) as any[]) {
            totalWants++
            const hit = agg.get(row.card_id)
            // Rows arrive newest-first, so the first row seen per card is its
            // most recent add.
            if (hit) hit.wishers++
            else agg.set(row.card_id, { wishers: 1, lastAdded: row.added_at, snap: row })
        }
        if (!data || data.length < PAGE) break
    }

    const ranked = [...agg.entries()]
        .sort((a, b) => b[1].wishers - a[1].wishers || (a[1].lastAdded < b[1].lastAdded ? 1 : -1))
    const ids = ranked.slice(0, WISHLIST_BOARD_LIMIT).map(([id]) => id)

    const catalog = new Map<string, any>()
    const listingCount = new Map<string, number>()
    for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK)
        const { data: cards } = await supabase
            .from('pokemon_cards')
            .select('id, name, english_name, set_id, number, rarity, language, game, image_small, image_large, tcgplayer:raw_data->tcgplayer, types:raw_data->types, pokemon_sets(name, printed_total, total), market_values(condition, market_avg, currency, last_updated)')
            .in('id', slice)
        for (const r of (cards ?? []) as any[]) catalog.set(r.id, r)

        // Paged: a chunk's active listings can exceed the 1000-row default.
        for (let from = 0; ; from += PAGE) {
            const { data } = await supabase
                .from('listings')
                .select('card_id')
                .eq('status', 'active')
                .in('card_id', slice)
                .order('id')
                .range(from, from + PAGE - 1)
            for (const l of (data ?? []) as any[]) {
                listingCount.set(l.card_id, (listingCount.get(l.card_id) ?? 0) + 1)
            }
            if (!data || data.length < PAGE) break
        }
    }

    const rows: WishlistBoardRow[] = ids.map((id) => {
        const { wishers, lastAdded, snap } = agg.get(id)!
        const cat = catalog.get(id)
        // Sealed products and delisted cards have no pokemon_cards row; fall
        // back to the snapshot so they still appear instead of vanishing.
        const mapped = cat ? mapSupabaseCardToInternal(cat) : null
        return {
            cardId: id,
            name: mapped?.name ?? snap.snapName ?? 'Unknown card',
            setName: mapped?.set ?? snap.snapSet ?? '—',
            number: mapped?.number ?? snap.snapNumber ?? '',
            image: mapped?.images?.small ?? snap.snapImage ?? snap.snapImageUrl ?? null,
            rarity: mapped?.rarity ?? snap.snapRarity ?? null,
            types: Array.isArray(cat?.types) ? cat.types.filter((t: any) => typeof t === 'string') : [],
            game: cat?.game ?? 'pokemon',
            language: cat?.language ?? snap.snapLang ?? 'en',
            priceThb: Math.round(mapped?.marketPrice || Number(snap.snapPrice) || 0),
            wishers,
            lastAdded,
            activeListings: listingCount.get(id) ?? 0,
        }
    })

    return {
        rows,
        totalWants,
        uniqueCards: agg.size,
        truncated: agg.size > WISHLIST_BOARD_LIMIT,
    }
}

const TIER_NAMES: Record<number, string> = {
    1: 'Bronze', 2: 'Silver', 3: 'Gold', 4: 'Platinum',
    5: 'Sapphire', 6: 'Ruby', 7: 'Emerald', 8: 'Diamond', 9: 'Black Opal',
}

const STATUS_COLORS: Record<string, string> = {
    'Open': 'bg-brand-red/20 text-brand-red',
    'In Progress': 'bg-yellow-500/20 text-yellow-400',
    'Resolved': 'bg-brand-green/20 text-brand-green',
}

// Order fulfillment stages: yellow = awaiting shipment, cyan = moving, green = done.
const ORDER_STAGE_COLORS: Record<string, string> = {
    paid: 'bg-yellow-500/20 text-yellow-400',
    label_generated: 'bg-yellow-500/20 text-yellow-400',
    shipped: 'bg-brand-cyan/20 text-brand-cyan',
    in_transit: 'bg-brand-cyan/20 text-brand-cyan',
    out_for_delivery: 'bg-brand-cyan/20 text-brand-cyan',
    delivered: 'bg-brand-green/20 text-brand-green',
    completed: 'bg-brand-green/20 text-brand-green',
}

const OFFER_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    accepted: 'bg-brand-green/20 text-brand-green',
    countered: 'bg-brand-cyan/20 text-brand-cyan',
    rejected: 'bg-brand-red/20 text-brand-red',
    expired: 'bg-white/10 text-slate-400',
    withdrawn: 'bg-white/10 text-slate-400',
}

const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default async function AdminOverviewPage() {
    const [stats, recentTickets, topPartners, recentSales, recentOffers, wishlist] = await Promise.all([
        getOverviewStats(),
        getRecentTickets(),
        getTopPartners(),
        getRecentSales(),
        getRecentOffers(),
        getWishlistBoard(),
    ])

    const statCards: StatCard[] = [
        { label: 'Total Users', value: stats.totalUsers.toLocaleString(), icon: 'fa-solid fa-users', color: 'text-brand-cyan', sub: 'Registered accounts' },
        { label: 'Collections', value: stats.collectionItems.toLocaleString(), icon: 'fa-solid fa-layer-group', color: 'text-brand-purple', sub: 'Cards in collections' },
        { label: 'Listings', value: stats.activeListings.toLocaleString(), icon: 'fa-solid fa-tags', color: 'text-brand-green', sub: 'Active on marketplace' },
        { label: 'Orders', value: stats.paidOrders.toLocaleString(), icon: 'fa-solid fa-cart-shopping', color: 'text-yellow-400', sub: 'Paid and later' },
        { label: 'GMV', value: `฿${Math.round(stats.gmvBaht).toLocaleString()}`, icon: 'fa-solid fa-baht-sign', color: 'text-brand-green', sub: 'Paid order value, excl. shipping' },
        { label: 'Open Tickets', value: stats.openTickets.toLocaleString(), icon: 'fa-solid fa-ticket', color: 'text-brand-red', sub: 'Needs attention' },
        { label: 'Open Reports', value: stats.openReports.toLocaleString(), icon: 'fa-solid fa-flag', color: 'text-brand-purple', sub: 'Needs review' },
        { label: 'Card Requests', value: stats.openCardRequests.toLocaleString(), icon: 'fa-solid fa-inbox', color: 'text-brand-cyan', sub: 'Open requests' },
    ]

    return (
        <div className="space-y-8 animate-fadeIn">
            <div>
                <h1 className="text-2xl font-black text-white italic skew-x-[-3deg]">Admin Overview</h1>
                <p className="text-slate-500 text-sm mt-1">Welcome to the CardStreet Admin Console</p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {statCards.map((card) => (
                    <div key={card.label} className="glass rounded-2xl p-5 border border-white/10 relative overflow-hidden group hover:border-white/20 transition-all">
                        <div className="absolute top-3 right-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <i className={`${card.icon} text-3xl ${card.color}`} />
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">{card.label}</p>
                        <p className={`text-3xl font-black ${card.color}`}>{card.value}</p>
                        {card.sub && <p className="text-[10px] text-slate-600 mt-1 font-semibold">{card.sub}</p>}
                    </div>
                ))}
            </div>

            {/* Sold Listings */}
            <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/5">
                    <h2 className="font-black text-white text-sm uppercase tracking-wide italic">Sold Listings</h2>
                </div>
                {recentSales.length === 0 ? (
                    <p className="px-6 py-8 text-center text-slate-500 text-sm">No sales yet</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-white/5">
                                    <th className="px-6 py-3">Card</th>
                                    <th className="px-4 py-3">Seller</th>
                                    <th className="px-4 py-3">Buyer</th>
                                    <th className="px-4 py-3 text-right">Sold Price</th>
                                    <th className="px-4 py-3">Order Stage</th>
                                    <th className="px-6 py-3 text-right">Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {recentSales.map((o: any) => {
                                    const card = (o.listing as any)?.card_data
                                    return (
                                        <tr key={o.id} className="hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-3">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    {card?.images?.small && (
                                                        <img src={card.images.small} alt="" className="w-8 h-11 object-contain rounded shrink-0" />
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-slate-200 truncate max-w-[220px]">{card?.name ?? 'Unknown card'}</p>
                                                        {card?.number && <p className="text-[10px] text-slate-500">#{card.number}</p>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{(o.seller as any)?.display_name ?? 'Unknown'}</td>
                                            <td className="px-4 py-3 text-sm text-slate-300 whitespace-nowrap">{(o.buyer as any)?.display_name ?? 'Unknown'}</td>
                                            <td className="px-4 py-3 text-sm font-black text-brand-green text-right whitespace-nowrap">฿{Number(o.total_amount).toLocaleString()}</td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-block text-[9px] font-black uppercase px-2 py-1 rounded-full whitespace-nowrap ${ORDER_STAGE_COLORS[o.status] ?? 'bg-white/10 text-slate-400'}`}>
                                                    {String(o.status).replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td className="px-6 py-3 text-[11px] text-slate-500 text-right whitespace-nowrap">{shortDate(o.created_at)}</td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Tickets */}
                <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                        <h2 className="font-black text-white text-sm uppercase tracking-wide italic">Recent Tickets</h2>
                        <a href="/admin/tickets" className="text-[10px] text-brand-cyan font-bold uppercase hover:underline">View all →</a>
                    </div>
                    <div className="divide-y divide-white/5">
                        {recentTickets.length === 0 && (
                            <p className="px-6 py-8 text-center text-slate-500 text-sm">No tickets yet</p>
                        )}
                        {recentTickets.map((t: any) => (
                            <div key={t.id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-200 truncate">{t.subject}</p>
                                    <p className="text-[10px] text-slate-500">
                                        {(t.profiles as any)?.display_name ?? 'Unknown'} · {t.category}
                                    </p>
                                </div>
                                <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-1 rounded-full ${STATUS_COLORS[t.status] ?? ''}`}>{t.status}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Top Partners */}
                <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                        <h2 className="font-black text-white text-sm uppercase tracking-wide italic">Top Partners</h2>
                        <a href="/admin/downloads" className="text-[10px] text-brand-cyan font-bold uppercase hover:underline">Full leaderboard →</a>
                    </div>
                    <div className="divide-y divide-white/5">
                        {topPartners.length === 0 && (
                            <p className="px-6 py-8 text-center text-slate-500 text-sm">No partners yet</p>
                        )}
                        {topPartners.map((p: any, i: number) => (
                            <div key={p.id} className="px-6 py-3 flex items-center gap-4 hover:bg-white/5 transition-colors">
                                <span className="text-sm font-black text-slate-600 w-5 text-right">#{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-200 truncate">{p.display_name ?? 'Unnamed'}</p>
                                    <p className="text-[10px] text-slate-500">{TIER_NAMES[p.partner_level ?? 1] ?? 'Bronze'} Rare</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="text-sm font-black text-brand-green">{(p.total_downloads ?? 0).toLocaleString()}</p>
                                    <p className="text-[9px] text-slate-500">downloads</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Recent Offers */}
                <div className="glass rounded-2xl border border-white/10 overflow-hidden">
                    <div className="px-6 py-4 border-b border-white/5">
                        <h2 className="font-black text-white text-sm uppercase tracking-wide italic">Recent Offers</h2>
                    </div>
                    <div className="divide-y divide-white/5">
                        {recentOffers.length === 0 && (
                            <p className="px-6 py-8 text-center text-slate-500 text-sm">No offers yet</p>
                        )}
                        {recentOffers.map((o: any) => {
                            const listing = o.listing as any
                            const card = listing?.card_data
                            return (
                                <div key={o.id} className="px-6 py-3 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors">
                                    {card?.images?.small && (
                                        <img src={card.images.small} alt="" className="w-8 h-11 object-contain rounded shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-slate-200 truncate">{card?.name ?? 'Unknown card'}</p>
                                        <p className="text-[10px] text-slate-500 truncate">
                                            {(o.buyer as any)?.display_name ?? 'Unknown'} → {(o.seller as any)?.display_name ?? 'Unknown'}
                                        </p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-sm font-black text-brand-green">฿{Number(o.amount).toLocaleString()}</p>
                                        <p className="text-[10px] text-slate-500">list ฿{Number(listing?.price ?? 0).toLocaleString()}</p>
                                    </div>
                                    <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-1 rounded-full ${OFFER_STATUS_COLORS[o.status] ?? 'bg-white/10 text-slate-400'}`}>{o.status}</span>
                                </div>
                            )
                        })}
                    </div>
                </div>

            </div>

            {/* Most Wishlisted — source list for the weekly Buy List post. Full
                width rather than a grid cell: the filter bar and per-card facets
                need the room. */}
            <WishlistBoard
                rows={wishlist.rows}
                totalWants={wishlist.totalWants}
                uniqueCards={wishlist.uniqueCards}
                truncated={wishlist.truncated}
            />
        </div>
    )
}
