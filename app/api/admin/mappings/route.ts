import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    const supabase = createAdminClient()
    try {
        const body = await request.json()
        const { action, card_id_th, card_id_en } = body

        if (!action || !card_id_th) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
        }

        if (action === 'verify') {
            const isVerified = body.verified !== undefined ? body.verified : true
            const { error } = await supabase.from('card_mappings').update({
                verified: isVerified
            }).eq('card_id_th', card_id_th)

            if (error) throw error
            return NextResponse.json({ success: true })
        }

        if (action === 'remap') {
            if (!card_id_en) {
                return NextResponse.json({ error: 'Missing English card target' }, { status: 400 })
            }

            const { error } = await supabase.from('card_mappings').upsert({
                card_id_th: card_id_th,
                card_id_en: card_id_en,
                match_method: 'manual_qc',
                confidence_score: 1.0,
                verified: true
            }, { onConflict: 'card_id_th' }) // Assuming unique constraint on card_id_th exists

            if (error) throw error
            return NextResponse.json({ success: true })
        }

        return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 })

    } catch (error: any) {
        console.error('Admin Mapping Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
