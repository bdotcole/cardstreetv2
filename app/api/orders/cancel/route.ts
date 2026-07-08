/**
 * POST /api/orders/cancel
 *
 * Releases an ABANDONED checkout. When the buyer clicks "Pay",
 * /api/orders/checkout creates the orders at `pending_payment` and flips their
 * listings `active → sold` (the reservation) BEFORE the Stripe charge. If the
 * payment then fails or the buyer closes the modal without paying, those orders
 * would sit at `pending_payment` forever and the listings would stay `sold`
 * (vanished from the marketplace) with nothing to clean them up. The client
 * calls this endpoint on payment failure / modal close to undo the reservation
 * immediately.
 *
 * Safety:
 *   - Buyer-scoped: only the authenticated buyer's own orders are touched.
 *   - CAS on `status='pending_payment'` AND `payment_id IS NULL`, so a payment
 *     that already succeeded (webhook/finalize flipped it to `paid` and stamped
 *     payment_id) is never cancelled — the update matches zero rows and no-ops.
 *   - Listings are reverted `sold → active` only while still `sold`, so a
 *     concurrent legitimate sale is never clobbered.
 *   - Idempotent: a second call finds nothing pending and returns cleanly.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const transferGroup: unknown = body?.transferGroup;
        if (typeof transferGroup !== 'string' || transferGroup.length === 0) {
            return NextResponse.json({ error: 'transferGroup is required' }, { status: 400 });
        }

        const admin = createAdminClient();

        // Cancel only THIS buyer's still-unpaid reservations in the group. The
        // CAS (pending_payment + payment_id IS NULL) fail-closes against any
        // order that already got paid, so we can never cancel a real purchase.
        const { data: cancelled, error: cancelErr } = await admin
            .from('orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('transfer_group', transferGroup)
            .eq('buyer_id', user.id)
            .eq('status', 'pending_payment')
            .is('payment_id', null)
            .select('id, listing_id');

        if (cancelErr) {
            console.error('[Orders/Cancel] Order cancel failed:', cancelErr);
            return NextResponse.json({ error: 'Failed to cancel orders' }, { status: 500 });
        }

        const listingIds = (cancelled ?? [])
            .map(o => o.listing_id)
            .filter((v): v is string => typeof v === 'string');

        // Free the reserved listings. Guard on status='sold' so we only undo the
        // reservation this checkout took, never a listing that's active/other.
        let releasedListings: string[] = [];
        if (listingIds.length > 0) {
            const { data: released, error: releaseErr } = await admin
                .from('listings')
                .update({ status: 'active' })
                .in('id', listingIds)
                .eq('status', 'sold')
                .select('id');
            if (releaseErr) {
                // Non-fatal: the order is cancelled; the sweep cron / support can
                // reconcile the listing. Report it so the client knows.
                console.error('[Orders/Cancel] Listing release failed:', releaseErr);
            } else {
                releasedListings = (released ?? []).map(r => r.id);
            }
        }

        return NextResponse.json({
            success: true,
            cancelledOrders: (cancelled ?? []).map(o => o.id),
            releasedListings,
        });
    } catch (err: any) {
        console.error('[Orders/Cancel] Error:', err);
        return NextResponse.json({ error: err.message || 'Cancel failed' }, { status: 500 });
    }
}
