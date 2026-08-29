import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/adminAuth'
import { NextResponse } from 'next/server'

const VALID_STATUSES = ['Open', 'Reviewed', 'Resolved', 'Dismissed']

// PATCH /api/admin/reports/[id] — update a report's status
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const status = body?.status as string | undefined
    if (!status || !VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
        .from('reports')
        .update({ status })
        .eq('id', id)
        .select('id, status')
        .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    return NextResponse.json({ report: data })
}
