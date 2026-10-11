import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { embedArray } from '@/lib/utils/embed'
import { createAdminClient } from '@/lib/supabase/admin'
import { attachBreakContext } from '@/lib/breakOrderContext'

// GET - List user's active sales/shipments
export async function GET(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
        const offset = (page - 1) * limit

        const { data: shipments, error, count } = await supabase
            .from('orders')
            .select(`
                *,
                listing:listings(
                    card_data,
                    condition,
                    price
                ),
                shipping_labels(*)
            `, { count: 'exact' })
            .eq('seller_id', user.id)
            // Includes 'delivered' and 'completed' so the seller sees the
            // parcel arrive even without push/email — finished orders stay in
            // the panel (marked delivered) until the seller dismisses them,
            // which stamps seller_cleared_at via /api/profile/shipments/clear.
            // 'in_transit' was previously missing, which made shipments
            // vanish mid-route.
            .in('status', ['paid', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed'])
            .is('seller_cleared_at', null)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        if (error) throw error

        // Same to-one embed normalization as /api/profile/orders: the seller
        // panel reads shipping_labels[0] for tracking/label actions.
        const normalized = (shipments || []).map((s: any) => ({
            ...s,
            shipping_labels: embedArray(s.shipping_labels),
        }))

        // Live-break spot orders have no listing snapshot — resolve their
        // stream/lot/spot context (service-role: streams RLS is per-role and
        // this join spans buyer-visible + seller-visible rows) so the panel
        // names them and hides the per-order label actions.
        const admin = createAdminClient()
        const withBreakContext = await attachBreakContext(admin, normalized)

        // The buyer's display name, so a seller with several parcels can see
        // at a glance which ones go to the same person (and label them together via
        // /api/orders/label/create). Name only; fails soft to no name.
        const buyerIds = [...new Set(withBreakContext.map((s: any) => s.buyer_id).filter(Boolean))] as string[]
        const buyerNames = new Map<string, string | null>()
        if (buyerIds.length > 0) {
            const { data: buyers } = await admin
                .from('profiles')
                .select('id, display_name')
                .in('id', buyerIds)
            for (const b of buyers || []) buyerNames.set(b.id, b.display_name ?? null)
        }
        const withBuyer = withBreakContext.map((s: any) => ({
            ...s,
            buyer: { display_name: buyerNames.get(s.buyer_id) ?? null },
        }))

        return NextResponse.json({
            shipments: withBuyer,
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit)
            }
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
