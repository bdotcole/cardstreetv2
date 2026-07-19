import { createAdminClient } from '@/lib/supabase/admin'

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

const TIER_NAMES: Record<number, string> = {
    1: 'Bronze', 2: 'Silver', 3: 'Gold', 4: 'Platinum',
    5: 'Sapphire', 6: 'Ruby', 7: 'Emerald', 8: 'Diamond', 9: 'Black Opal',
}

const STATUS_COLORS: Record<string, string> = {
    'Open': 'bg-brand-red/20 text-brand-red',
    'In Progress': 'bg-yellow-500/20 text-yellow-400',
    'Resolved': 'bg-brand-green/20 text-brand-green',
}

export default async function AdminOverviewPage() {
    const [stats, recentTickets, topPartners] = await Promise.all([
        getOverviewStats(),
        getRecentTickets(),
        getTopPartners(),
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
            </div>
        </div>
    )
}
