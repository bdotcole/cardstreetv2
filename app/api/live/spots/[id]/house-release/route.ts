/**
 * POST /api/live/spots/[id]/house-release — an ADMIN puts a house-reserved
 * spot back on the board (status='sold' + order_id NULL + admin buyer ->
 * 'open'). The inverse of house-reserve.
 *
 * The order_id IS NULL guard is LOAD-BEARING: finalize_break_spot stamps
 * order_id at the exact moment a real purchase flips a spot sold, so any
 * genuinely bought spot can never match this CAS — real purchases are
 * un-releasable here, no matter who calls. The buyer-role check is the second
 * belt: even an order_id-less sold row is only releasable when the recorded
 * buyer is an admin account (any admin can release any admin's house spot).
 */

import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';

const SPOT_COLS =
    'id, stream_item_id, spot_number, price, status, held_by, ' +
    'hold_expires_at, buyer_id, order_id, sold_at, assigned_packs';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const gate = await requireAdminUser();
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const admin = createAdminClient();

        const { data: spot, error: spotErr } = await admin
            .from('break_spots')
            .select('id, status, buyer_id, order_id')
            .eq('id', id)
            .maybeSingle<{
                id: string;
                status: string;
                buyer_id: string | null;
                order_id: string | null;
            }>();

        if (spotErr) {
            console.error('[Live/HouseRelease] spot fetch failed:', spotErr.message);
            return NextResponse.json({ error: 'Failed to release spot' }, { status: 500 });
        }
        if (!spot) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (spot.status !== 'sold' || spot.order_id !== null || !spot.buyer_id) {
            return NextResponse.json(
                { error: 'Spot is not house-held', code: 'NOT_HOUSE_HELD' },
                { status: 409 },
            );
        }

        // The recorded buyer must itself be an admin account. Fails closed on
        // any lookup miss — when in doubt, the spot stays sold.
        if (spot.buyer_id !== user.id) {
            const { data: buyerProfile } = await admin
                .from('profiles')
                .select('role')
                .eq('id', spot.buyer_id)
                .maybeSingle<{ role: string | null }>();
            if (buyerProfile?.role !== 'admin') {
                return NextResponse.json(
                    { error: 'Spot is not house-held', code: 'NOT_HOUSE_HELD' },
                    { status: 409 },
                );
            }
        }

        // CAS pinned to exactly what was verified above — if anything changed
        // between the read and this write (a finalize stamping order_id, a
        // concurrent release), zero rows match and nothing is clobbered.
        const { data: updated, error: updateErr } = await admin
            .from('break_spots')
            .update({
                status: 'open',
                buyer_id: null,
                sold_at: null,
                held_by: null,
                hold_expires_at: null,
            })
            .eq('id', id)
            .eq('status', 'sold')
            .is('order_id', null)
            .eq('buyer_id', spot.buyer_id)
            .select(SPOT_COLS)
            .maybeSingle();

        if (updateErr) {
            console.error('[Live/HouseRelease] update failed:', updateErr.message);
            return NextResponse.json({ error: 'Failed to release spot' }, { status: 500 });
        }
        if (!updated) {
            return NextResponse.json(
                { error: 'Spot is not house-held', code: 'NOT_HOUSE_HELD' },
                { status: 409 },
            );
        }

        return NextResponse.json({ success: true, spot: updated });
    } catch (err: any) {
        console.error('[Live/HouseRelease] error:', err);
        return NextResponse.json({ error: 'Failed to release spot' }, { status: 500 });
    }
}
