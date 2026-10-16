/**
 * POST /api/orders/label/handoff
 *
 * The seller says a labelled parcel left outside our Flash waybill: handed
 * to Flash staff who keyed it in themselves, sent with another courier, or
 * delivered by hand. Flash will never scan the waybill, so this is the only
 * way such an order moves on from label_generated. See lib/parcels
 * handOffParcel for the rules; the buyer is told the parcel is on its way
 * and can confirm receipt from the order.
 *
 * Body: { orderIds: string[], carrier: string, trackingNumber?: string }
 * Auth: cookie session; every order must belong to the caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { handOffParcel, HANDOFF_CARRIER_MAX, HANDOFF_TRACKING_MAX } from '@/lib/parcels';

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
        const result = await handOffParcel(createAdminClient(), {
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
            recorded: result.recorded,
        });
    } catch (err: any) {
        console.error('[Orders/LabelHandoff] Error:', err);
        return NextResponse.json({ error: err?.message || 'Could not mark the parcel as shipped' }, { status: 500 });
    }
}
