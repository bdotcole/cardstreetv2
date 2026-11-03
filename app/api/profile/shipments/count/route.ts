import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { embedArray } from '@/lib/utils/embed'
import { isAwaitingLabel, groupByTransferGroup } from '@/lib/orderGroups'

// GET - how many parcels the caller still has to label, for the seller's
// badges (Profile tab, Seller Dashboard row, its To ship segment). A "sold"
// push used to be the only signal: nothing in the app pointed at the order
// once the notification was dismissed (2026-11-03). Counts checkouts, not
// order rows, so a three-card sale reads as one parcel to pack; the rule is
// the client's own isAwaitingLabel, so the badge and the Create label
// button always agree. Clears by itself when the label is created.
export async function GET() {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { data, error } = await supabase
            .from('orders')
            .select('id, status, transfer_group, break_spot_id, shipping_labels(tracking_number)')
            .eq('seller_id', user.id)
            .in('status', ['paid', 'processing'])
            .is('seller_cleared_at', null)
            .limit(200)

        if (error) throw error

        const awaiting = (data || [])
            .map((row: any) => ({ ...row, shipping_labels: embedArray(row.shipping_labels) }))
            .filter(isAwaitingLabel)

        return NextResponse.json(
            { toShip: groupByTransferGroup(awaiting).length },
            { headers: { 'Cache-Control': 'no-store' } },
        )
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
