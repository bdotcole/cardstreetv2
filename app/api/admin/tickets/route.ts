import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

// GET /api/admin/tickets — admin only
export async function GET(request: Request) {
    const gate = await requireAdmin()
    if (gate) return gate

    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const category = searchParams.get('category')

    let query = supabase
        .from('support_tickets')
        .select(`
      id, subject, description, category, status,
      admin_reply, replied_at, created_at, updated_at,
      user_id,
      profiles!support_tickets_user_id_fkey (display_name, avatar_url)
    `, { count: 'exact' })
        .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)
    if (category) query = query.eq('category', category)

    const { data, error, count } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ tickets: data ?? [], total: count ?? 0 })
}

// POST /api/admin/tickets — user-facing "open a ticket" entry point.
// Any authenticated user can open a ticket, but only for themselves —
// `user_id` is taken from the session, not the body.
export async function POST(request: Request) {
    const cookieSupabase = await createServerClient()
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser()
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { subject, description, category } = body || {}

    if (typeof subject !== 'string' || typeof description !== 'string' || !subject.trim() || !description.trim()) {
        return NextResponse.json({ error: 'subject and description are required' }, { status: 400 })
    }
    if (subject.length > 200 || description.length > 5000) {
        return NextResponse.json({ error: 'subject or description too long' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('support_tickets')
        .insert({
            user_id: user.id,
            subject: subject.trim(),
            description: description.trim(),
            category: typeof category === 'string' && category.trim() ? category.trim() : 'General',
        })
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ticket: data }, { status: 201 })
}
