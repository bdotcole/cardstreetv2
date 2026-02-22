import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET - Fetch current user's profile with settings and rewards
export async function GET() {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        // Fetch profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()

        if (profileError) throw profileError

        // Fetch settings
        const { data: settings } = await supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', user.id)
            .single()

        // Fetch rewards
        const { data: rewards } = await supabase
            .from('rewards')
            .select('*')
            .eq('user_id', user.id)
            .single()

        return NextResponse.json({
            profile,
            settings: settings || {
                phone_number: null,
                shipping_address: {},
                two_factor_enabled: false,
                notify_price_drops: true,
                notify_order_updates: true,
                notify_marketing: false
            },
            rewards: rewards || {
                points_balance: 0,
                tier: 'bronze',
                lifetime_points: 0,
                tier_progress: 0
            }
        })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

// PATCH - Update profile info (name, phone, address fields)
export async function PATCH(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const { display_name, phone_number, address, district, state, province, postcode } = body

        // Prepare profile update
        const profileUpdate: any = {}
        if (display_name !== undefined) profileUpdate.display_name = display_name
        if (phone_number !== undefined) profileUpdate.phone_number = phone_number
        if (address !== undefined) profileUpdate.address = address
        if (district !== undefined) profileUpdate.district = district
        if (state !== undefined) profileUpdate.state = state
        if (province !== undefined) profileUpdate.province = province
        if (postcode !== undefined) profileUpdate.postcode = postcode

        if (Object.keys(profileUpdate).length > 0) {
            const { error: profileError } = await supabase
                .from('profiles')
                .update(profileUpdate)
                .eq('id', user.id)

            if (profileError) throw profileError
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
