import { requireAdminUser } from '@/lib/adminAuth'
import { banUserAsAdmin, unbanUserAsAdmin } from '@/lib/adminModeration'
import { NextResponse } from 'next/server'

// POST /api/admin/users/[id]/ban — permanently ban an account.
// Body: { reason?: string, rejectStripe?: boolean }
// Bans at the auth layer (blocks sign-in + token refresh), flags the profile,
// takes down their active/draft listings, and optionally rejects their Stripe
// connected account (irreversible — Stripe support only).
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdminUser()
    if (gate instanceof NextResponse) return gate

    const { id } = await params
    if (id === gate.user.id) {
        return NextResponse.json({ error: 'You cannot ban your own account' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 500) : ''
    const rejectStripe = body?.rejectStripe === true

    const result = await banUserAsAdmin(id, reason, { rejectStripe })
    if (!result.ok) return NextResponse.json({ error: result.error, ...result }, { status: 400 })
    return NextResponse.json(result)
}

// DELETE /api/admin/users/[id]/ban — lift a ban. Does not restore removed
// listings, and a rejected Stripe account stays rejected.
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdminUser()
    if (gate instanceof NextResponse) return gate

    const { id } = await params
    const result = await unbanUserAsAdmin(id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true })
}
