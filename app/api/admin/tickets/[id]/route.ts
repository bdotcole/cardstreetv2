import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

// PATCH /api/admin/tickets/[id] — update status, add admin reply
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()
    const { status, admin_reply, replied_by } = body

    const updates: Record<string, unknown> = {}
    if (status) updates.status = status
    if (admin_reply !== undefined) {
        updates.admin_reply = admin_reply
        updates.replied_by = replied_by ?? null
        updates.replied_at = new Date().toISOString()
    }

    const { data, error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ticket: data })
}
