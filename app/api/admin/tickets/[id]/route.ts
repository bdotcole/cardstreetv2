import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

// GET /api/admin/tickets/[id] — ticket + full message thread
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const supabase = createAdminClient()

    const { data: ticket, error } = await supabase
        .from('support_tickets')
        .select(`
      id, subject, description, category, status,
      admin_reply, replied_at, created_at, updated_at,
      user_id,
      profiles!support_tickets_user_id_fkey (display_name, avatar_url)
    `)
        .eq('id', id)
        .single()

    if (error || !ticket) {
        return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })
    }

    // Fails soft to an empty thread if the 20260724 migration isn't applied
    // yet — the pane then just shows the legacy description + admin_reply.
    const { data: messages } = await supabase
        .from('support_ticket_messages')
        .select('id, ticket_id, sender_id, sender_role, body, created_at')
        .eq('ticket_id', id)
        .order('created_at', { ascending: true })

    return NextResponse.json({ ticket, messages: messages ?? [] })
}

// PATCH /api/admin/tickets/[id] — update status and/or send an admin reply.
// A reply appends a thread message; the legacy admin_reply/replied_at columns
// are kept mirrored to the latest reply for older app builds.
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json()
    const { status } = body
    const reply = typeof body.admin_reply === 'string' ? body.admin_reply.trim() : ''

    // requireAdmin verified the session is an admin; reuse it for replied_by
    // instead of trusting a body field.
    const cookieSupabase = await createServerClient()
    const { data: { user: adminUser } } = await cookieSupabase.auth.getUser()

    const updates: Record<string, unknown> = {}
    if (status) updates.status = status
    if (reply) {
        updates.admin_reply = reply
        updates.replied_by = adminUser?.id ?? null
        updates.replied_at = new Date().toISOString()
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('support_tickets')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Append the reply to the thread. Fails soft pre-migration — the legacy
    // columns above already carry the reply, so nothing is lost.
    let message: Record<string, unknown> | null = null
    if (reply) {
        const { data: inserted } = await supabase
            .from('support_ticket_messages')
            .insert({
                ticket_id: id,
                sender_id: adminUser?.id ?? null,
                sender_role: 'admin',
                body: reply,
            })
            .select('id, ticket_id, sender_id, sender_role, body, created_at')
            .single()
        message = inserted ?? null
    }

    return NextResponse.json({ ticket: data, message })
}
