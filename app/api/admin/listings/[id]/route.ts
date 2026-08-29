import { requireAdmin } from '@/lib/adminAuth'
import { removeListingAsAdmin } from '@/lib/adminModeration'
import { NextResponse } from 'next/server'

// DELETE /api/admin/listings/[id] — take a listing off the marketplace.
// Sets status='removed' ('cancelled' until the moderation migration runs);
// the row is kept for audit/order history, never hard-deleted.
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const result = await removeListingAsAdmin(id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, newStatus: result.newStatus })
}
