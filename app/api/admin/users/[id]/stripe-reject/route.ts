import { requireAdminUser } from '@/lib/adminAuth'
import { rejectStripeAsAdmin } from '@/lib/adminModeration'
import { NextResponse } from 'next/server'

// POST /api/admin/users/[id]/stripe-reject — permanently reject this seller's
// Stripe connected account (charges + payouts disabled for good).
//
// Separate from the ban route because the ban dialog's opt-in checkbox is only
// reachable for a not-yet-banned account; this covers rejecting after the ban.
// IRREVERSIBLE — Stripe provides no un-reject.
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdminUser()
    if (gate instanceof NextResponse) return gate

    const { id } = await params
    if (id === gate.user.id) {
        return NextResponse.json({ error: 'You cannot reject your own Stripe account' }, { status: 400 })
    }

    const result = await rejectStripeAsAdmin(id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
}
