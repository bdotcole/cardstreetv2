import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { ensurePartnerSlug } from '@/lib/referrals'
import { NextResponse } from 'next/server'

// PATCH /api/admin/users/[id] — update role, partner status, etc.
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const allowedFields = ['role', 'total_downloads', 'partner_level', 'partner_fee', 'partner_joined_at']
    const updates: Record<string, unknown> = {}
    for (const key of allowedFields) {
        if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Promoting to partner generates the referral slug right away, so the
    // QR/link is printable before the partner ever opens their portal.
    if (data?.partner_joined_at && !data.partner_qr_slug) {
        try {
            data.partner_qr_slug = await ensurePartnerSlug(supabase, id, null, data.display_name)
        } catch (slugErr) {
            // Non-fatal: the portal regenerates lazily on first open.
            console.error('[Admin/Users] slug generation on promotion failed:', slugErr)
        }
    }

    return NextResponse.json({ user: data })
}
