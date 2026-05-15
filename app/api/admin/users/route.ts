import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

// GET /api/admin/users — fetch all users with profile data
export async function GET(request: Request) {
    const gate = await requireAdmin()
    if (gate) return gate

    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') ?? '1')
    const limit = 50
    const offset = (page - 1) * limit
    const search = searchParams.get('search') ?? ''
    const roleFilter = searchParams.get('role') // 'partner' | 'non-partner' | null

    let query = supabase
        .from('profiles')
        .select('id, display_name, avatar_url, role, total_downloads, partner_level, partner_fee, partner_joined_at, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

    if (roleFilter === 'partner') {
        query = query.eq('role', 'partner')
    } else if (roleFilter === 'non-partner') {
        query = query.neq('role', 'partner')
    }

    if (search) {
        query = query.ilike('display_name', `%${search}%`)
    }

    const { data, error, count } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Also get emails from auth.users via service role
    const userIds = (data ?? []).map((u) => u.id)
    const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const emailMap: Record<string, string> = {}
    for (const u of authUsers?.users ?? []) {
        emailMap[u.id] = u.email ?? ''
    }

    const users = (data ?? []).map((u) => ({ ...u, email: emailMap[u.id] ?? '' }))
    return NextResponse.json({ users, total: count ?? 0 })
}
