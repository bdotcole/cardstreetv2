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
        // These live in notification_preferences instead — the table
        // lib/courier.ts consults before a live-show blast. Same endpoint so
        // both settings screens keep one save path.
        const blastFields = ['show_live_email', 'show_live_push']

        // Filter to only allowed fields
        const updateData: Record<string, boolean> = {}
        for (const field of allowedFields) {
            if (body[field] !== undefined) {
                updateData[field] = Boolean(body[field])
            }
        }
        const blastData: Record<string, boolean> = {}
        for (const field of blastFields) {
            if (body[field] !== undefined) {
                blastData[field] = Boolean(body[field])
            }
        }

        if (Object.keys(updateData).length === 0 && Object.keys(blastData).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
        }

        if (Object.keys(updateData).length > 0) {
            const { error } = await supabase
                .from('user_settings')
                .upsert({
                    user_id: user.id,
                    ...updateData
                }, { onConflict: 'user_id' })

            if (error) throw error
        }

        if (Object.keys(blastData).length > 0) {
            // Upsert, not update: an account that has never registered a push
            // token has no notification_preferences row, and an UPDATE would
            // silently affect zero rows — the user would see the toggle move
            // and keep receiving the mail. RLS allows a user to insert and
            // update their own row, so the session client is enough.
            const { error } = await supabase
                .from('notification_preferences')
                .upsert({
                    user_id: user.id,
                    ...blastData,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id' })

            if (error) {
                // 20260824_show_blast_preferences has not been run. Report it
                // rather than 500ing with a raw Postgres string.
                //
                // Measured, not guessed: PostgREST answers a WRITE naming an
                // unknown column with PGRST204, and a READ with 42703. This is
                // a write, so PGRST204 is the code that actually fires.
                if (error.code === 'PGRST204' || error.code === '42703') {
                    return NextResponse.json(
                        { error: 'Live show preferences are not available yet', code: 'SCHEMA_MISSING' },
                        { status: 503 }
                    )
                }
                throw error
            }
        }

        return NextResponse.json({ success: true, updated: { ...updateData, ...blastData } })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
