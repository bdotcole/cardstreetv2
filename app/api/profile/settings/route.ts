import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// PATCH - Update notification preferences and 2FA status
export async function PATCH(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const allowedFields = [
            'two_factor_enabled',
            'notify_price_drops',
            'notify_order_updates',
            'notify_marketing'
        ]

        // Filter to only allowed fields
        const updateData: Record<string, boolean> = {}
        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                updateData[field] = Boolean(body[field])
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
        }

        const { error } = await supabase
            .from('user_settings')
            .upsert({
                user_id: user.id,
                ...updateData
            }, { onConflict: 'user_id' })

        if (error) throw error

        return NextResponse.json({ success: true, updated: updateData })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
