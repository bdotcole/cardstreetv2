/**
 * POST /api/orders/label/self-ship
 *
 * The seller shipped the parcel themselves, straight from 'paid': they took
 * the cards to whatever counter is nearest, paid there, and here they name the
 * carrier and the number it gave them. No Flash waybill is minted; the order
 * moves to shipped, the buyer is told, and 17TRACK follows the number so
 * delivery is detected on its own (lib/parcels shipSelf, lib/externalTracking).
 *
 * Body: { orderIds: string[], carrier: string, trackingNumber?: string }
 * Auth: cookie session; every order must belong to the caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { shipSelf, HANDOFF_CARRIER_MAX, HANDOFF_TRACKING_MAX } from '@/lib/parcels';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const orderIds: string[] = Array.isArray(body?.orderIds)
        ? body.orderIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
    if (orderIds.length === 0 || orderIds.length > 100) {
        return NextResponse.json({ error: 'Pick at least one order', code: 'NO_ORDERS' }, { status: 400 });
    }
    const carrier = typeof body?.carrier === 'string' ? body.carrier.trim() : '';
    if (!carrier || carrier.length > HANDOFF_CARRIER_MAX) {
        return NextResponse.json({ error: 'carrier is required', code: 'BAD_CARRIER' }, { status: 400 });
    }
    const trackingNumber = typeof body?.trackingNumber === 'string' ? body.trackingNumber.trim() : '';
    if (trackingNumber.length > HANDOFF_TRACKING_MAX) {
        return NextResponse.json({ error: 'trackingNumber is too long', code: 'BAD_TRACKING' }, { status: 400 });
    }

    try {
        const result = await shipSelf(createAdminClient(), {
            sellerId: user.id,
            orderIds,
            carrier,
            trackingNumber: trackingNumber || null,
        });
        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        }
        return NextResponse.json({
            success: true,
            orderIds: result.orderIds,
            carrier: result.carrier,
            trackingNumber: result.trackingNumber,
            tracked: result.tracked,
            recorded: result.recorded,
        });
    } catch (err: any) {
        console.error('[Orders/SelfShip] Error:', err);
        return NextResponse.json({ error: err?.message || 'Could not mark the parcel as shipped' }, { status: 500 });
    }
}
