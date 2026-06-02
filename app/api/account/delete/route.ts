import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// POST - Permanently delete the signed-in user's account and all associated data.
//
// Apple Guideline 5.1.1(v) requires account deletion to be initiable from inside
// the app. Deleting the auth.users row cascades to profiles and every table that
// references profiles(id)/auth.users(id) ON DELETE CASCADE, so a single admin
// deleteUser call removes collections, listings, orders, settings, rewards, etc.
export async function POST() {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    try {
        // Refuse while money is still in escrow in either direction: a buyer who
        // paid but hasn't received, or a seller owed an unreleased payout. Cascade
        // deletion would silently destroy those order rows along with the user.
        const { data: heldOrders, error: ordersError } = await admin
            .from('orders')
            .select('id')
            .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
            .eq('escrow_status', 'held')
            .not('status', 'in', '("cancelled","refunded")')
            .limit(1)

        if (ordersError) throw ordersError

        if (heldOrders && heldOrders.length > 0) {
            return NextResponse.json(
                {
                    error: 'You have orders with funds still in escrow. Please wait for those orders to complete or be refunded before deleting your account.',
                },
                { status: 409 }
            )
        }

        const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
        if (deleteError) throw deleteError

        // Clear the session cookies on this response now that the user is gone.
        await supabase.auth.signOut()

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
