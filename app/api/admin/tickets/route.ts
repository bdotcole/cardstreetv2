import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// GET /api/admin/tickets
export async function GET(request: Request) {
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

// POST /api/admin/tickets — create a support ticket (for the user-facing app too)
export async function POST(request: Request) {
    const supabase = createAdminClient()
    const body = await request.json()
    const { user_id, subject, description, category } = body

    if (!user_id || !subject || !description) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await supabase
        .from('support_tickets')
        .insert({ user_id, subject, description, category: category ?? 'General' })
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ticket: data }, { status: 201 })
}
