/**
 * POST /api/live/spots/[id]/house-reserve — an ADMIN takes a break spot for
 * the house so the board reads fuller. Reuses the honest sold state: the spot
 * becomes status='sold' with buyer_id = the admin's own account and
 * order_id NULL — no fake buyer, no fake order, no fake payment. Everything
 * downstream already does the right thing with that shape:
 *
 *   - settle groups PAID orders only (spots with order_id NULL are skipped),
 *     so a house spot never mints a shipment or a shipping-fee order;
 *   - the randomizer treats sold spots normally, so house spots receive
 *     packs/hits like any buyer's — intended, the house keeps its pulls;
 *   - claim + checkout both reject sold spots, so nobody can buy it out from
 *     under the house;
 *   - lot "X left / N sold" counts include it — that IS the point.
 *
 * Admin role only (profiles.role='admin', server-verified, independent of
 * stream ownership — an admin can house-reserve on any stream). Deliberately
 * quiet: no system chat announcement.
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
        const nowIso = new Date().toISOString();

        // Auction spots settle only through the hammer — house-reserving one
        // would sever the winner's payment vehicle mid-bidding.
        const { data: lotCheck } = await admin
            .from('break_spots')
            .select('stream_items(item_type)')
            .eq('id', id)
            .maybeSingle<{ stream_items: { item_type: string } | null }>();
        if (lotCheck?.stream_items?.item_type === 'auction') {
            return NextResponse.json(
                { error: 'Auction lots cannot be house-reserved', code: 'AUCTION_LOT' },
                { status: 409 },
            );
        }

        // CAS: only an open spot — or a held one whose hold already lapsed
        // (same expired-hold stealing rule as the claim RPC) — can become a
        // house spot. A live hold, a real sale, or a cancelled spot all fail
        // the filter and return zero rows. order_id is NOT set: its absence
        // is what marks the spot as house-held (and what keeps it out of
        // settle's paid-order grouping).
        const { data: updated, error } = await admin
            .from('break_spots')
            .update({
                status: 'sold',
                buyer_id: user.id,
                sold_at: nowIso,
                held_by: null,
                hold_expires_at: null,
            })
            .eq('id', id)
            .or(`status.eq.open,and(status.eq.held,hold_expires_at.lte.${nowIso})`)
            .select(SPOT_COLS)
            .maybeSingle();

        if (error) {
            console.error('[Live/HouseReserve] update failed:', error.message);
            return NextResponse.json({ error: 'Failed to reserve spot' }, { status: 500 });
        }

        if (!updated) {
            // Zero rows: missing spot vs. one that simply isn't reservable.
            const { data: existing } = await admin
                .from('break_spots')
                .select('id, status')
                .eq('id', id)
                .maybeSingle<{ id: string; status: string }>();
            if (!existing) {
                return NextResponse.json({ error: 'Not found' }, { status: 404 });
            }
            return NextResponse.json(
                { error: 'Spot is not open', code: 'NOT_OPEN', status: existing.status },
                { status: 409 },
            );
        }

        return NextResponse.json({ success: true, spot: updated });
    } catch (err: any) {
        console.error('[Live/HouseReserve] error:', err);
        return NextResponse.json({ error: 'Failed to reserve spot' }, { status: 500 });
    }
}
