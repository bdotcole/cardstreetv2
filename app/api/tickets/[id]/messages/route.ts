import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/tickets/[id]/messages — user replies on their own ticket.
// Ownership is checked server-side (the writes go through the service-role
// client so we can also reopen a Resolved ticket, which RLS doesn't allow
// the user to do directly).
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const cookieSupabase = await createServerClient()
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser()
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) {
        return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }
    if (message.length > 5000) {
        return NextResponse.json({ error: 'message too long' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data: ticket, error: ticketErr } = await supabase
        .from('support_tickets')
        .select('id, user_id, status')
        .eq('id', id)
        .single()

    if (ticketErr || !ticket) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
    if (ticket.user_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: inserted, error: insertErr } = await supabase
        .from('support_ticket_messages')
        .insert({
            ticket_id: ticket.id,
            sender_id: user.id,
            sender_role: 'user',
            body: message,
        })
        .select('id, ticket_id, sender_role, body, created_at')
        .single()

    if (insertErr) {
        return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // A reply on a Resolved ticket reopens it so it lands back in the
    // admin's Open queue instead of being silently appended to a closed one.
    let status = ticket.status
    if (ticket.status === 'Resolved') {
        const { error: statusErr } = await supabase
            .from('support_tickets')
            .update({ status: 'Open' })
            .eq('id', ticket.id)
        if (!statusErr) status = 'Open'
    }

    return NextResponse.json({ message: inserted, status }, { status: 201 })
}
