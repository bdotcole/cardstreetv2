import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { embedArray } from '@/lib/utils/embed'
import { attachBreakContext } from '@/lib/breakOrderContext'

// How long a completed order keeps showing in the buyer's Track Orders panel.
// Matches the report window in app/api/orders/[id]/report.
const RECENT_COMPLETED_DAYS = 30

// GET - List user's orders with pagination
export async function GET(request: NextRequest) {
    const supabaseSession = await createClient()

    const { data: { user }, error: authError } = await supabaseSession.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Initialize Admin client to bypass RLS on joined 'sold' listings
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    try {
        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status') // 'active' | 'completed' | null (all)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)
        const offset = (page - 1) * limit

        let query = supabaseAdmin
            .from('orders')
            .select(`
                *,
                listing:listings(
                    card_data,
                    condition
                ),
                shipping_labels(
                    tracking_number,
                    carrier_name,
                    label_url,
                    courier_tracking_url,
                    estimated_delivery_date,
                    status
                ),
                reviews(rating, comment)
            `, { count: 'exact' })
            .eq('buyer_id', user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)

        // Filter by status. 'active' must cover every state the tracking
        // timeline can show: it was missing 'in_transit' and 'delivered', so
        // the moment a sync advanced an order mid-route (or to delivered,
        // where the confirm-delivery button lives) it vanished from the
        // buyer's Track Orders panel. Completed orders stay for
        // RECENT_COMPLETED_DAYS so the buyer can still review the seller or
        // report a problem from the same panel; disputed orders stay until
        // the report is closed.
        if (status === 'active') {
            const since = new Date(Date.now() - RECENT_COMPLETED_DAYS * 864e5).toISOString()
            query = query.or(
                `status.in.(pending,paid,label_generated,processing,shipped,in_transit,out_for_delivery,delivered,disputed),` +
                `and(status.eq.completed,completed_at.gte.${since})`
            )
        } else if (status === 'completed') {
            query = query.in('status', ['delivered', 'cancelled'])
        }

        const { data: orders, error, count } = await query

        if (error) throw error

        // PostgREST returns the to-one shipping_labels embed as an object;
        // clients (web, desktop) index it as an array. Normalize server-side
        // so every consumer keeps the historical array shape.
        const normalized = (orders || []).map((o: any) => {
            const { reviews, ...rest } = o
            return {
                ...rest,
                shipping_labels: embedArray(o.shipping_labels),
                // One review per order (reviews.order_id is UNIQUE); the embed
                // arrives as an object or a one-element array depending on how
                // PostgREST resolved the relationship, so normalize to one or null.
                review: embedArray(reviews)[0] ?? null,
            }
        })

        // Live-break spot orders have no listing snapshot — resolve their
        // stream/lot/spot context so panels can name them instead of falling
        // back to a blank "Card Order". One batched query; fails soft.
        const withBreakContext = await attachBreakContext(supabaseAdmin, normalized)

        return NextResponse.json({
            orders: withBreakContext,
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
