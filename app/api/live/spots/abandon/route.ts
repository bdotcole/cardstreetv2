/**
 * POST /api/live/spots/abandon — the buyer left checkout without paying.
 *
 * The payment sheet mints pending_payment orders and extends the hold the
 * moment it opens, so a buyer who closes it (or hits a failure Try Again
 * can't fix) used to leave BOTH behind: the board showed the spot reserved
 * until the hold lapsed, and a chargeable PaymentIntent outlived the session.
 * This tears down the whole payable group in one call.
 *
 * Order matters. Orders are cancelled BEFORE the holds are released: the
 * reverse leaves a window where the spot is open again while the buyer's
 * PaymentIntent is still confirmable, and a payment landing there would take
 * money for a spot finalize_break_spot's CAS then refuses to award.
 *
 * Both writes are CAS-guarded on the caller (release_break_spot needs
 * status='held' AND held_by=caller; the order cancel needs buyer + spot +
 * status='pending_payment'), so this can neither free someone else's spot nor
 * cancel an order that was actually paid. Idempotent — a repeat call is a
 * no-op, which is what the sheet's belt-and-braces close + unmount paths want.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { cancelPendingSpotOrders } from '@/lib/liveBreaks';

const MAX_SPOTS_PER_ABANDON = 10;

export async function POST(req: Request) {
    try {
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const buyerId = gate.user.id;

        const body = await req.json().catch(() => ({}));
        const rawIds: string[] = Array.isArray(body?.spotIds)
            ? body.spotIds.filter((x: unknown): x is string => typeof x === 'string')
            : [];
        const spotIds = [...new Set(rawIds)].slice(0, MAX_SPOTS_PER_ABANDON);

        if (spotIds.length === 0) {
            return NextResponse.json({ error: 'No spots provided' }, { status: 400 });
        }

        const cancelled = await cancelPendingSpotOrders(buyerId, spotIds);

        const admin = createAdminClient();
        const results = await Promise.all(
            spotIds.map(async id => {
                const { data, error } = await admin.rpc('release_break_spot', {
                    p_spot_id: id,
                    p_buyer_id: buyerId,
                });
                if (error) {
                    console.error('[Live/Abandon] release RPC failed:', error.message);
                    return false;
                }
                return (data as { released?: boolean } | null)?.released === true;
            }),
        );

        return NextResponse.json({
            success: true,
            cancelled,
            released: results.filter(Boolean).length,
        });
    } catch (err: any) {
        console.error('[Live/Abandon] error:', err);
        return NextResponse.json({ error: 'Failed to abandon checkout' }, { status: 500 });
    }
}
