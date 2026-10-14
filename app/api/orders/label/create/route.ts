/**
 * POST /api/orders/label/create
 *
 * The seller mints the Flash waybill for a set of their unlabelled orders
 * from one buyer (one checkout, or several combined into one parcel), or
 * adds those orders to a waybill of that buyer's that Flash has not scanned
 * yet. Labels are not created at payment any more; this is where they come
 * from. See lib/parcels.
 *
 * Body: { orderIds: string[], attachToTrackingNumber?: string, shipMethod?: 'pickup' | 'dropoff' }
 * Auth: cookie session; every order must belong to the caller.
 *
 * shipMethod is the seller's answer to "how will Flash get this parcel?".
 * A courier is booked only for 'pickup'. Anything else, including a client
 * that predates the question and sends nothing, means drop-off: an
 * unannounced courier is what the question exists to prevent. Adding to an
 * existing parcel ignores it (the parcel keeps its own arrangement).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mintParcel, attachToParcel } from '@/lib/parcels';
import type { ShipMethod } from '@/lib/orderGroups';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
        return NextResponse.json({ error: 'Pick at least one order' }, { status: 400 });
    }
    const attachTo: string | null =
        typeof body?.attachToTrackingNumber === 'string' && body.attachToTrackingNumber.length > 0
            ? body.attachToTrackingNumber
            : null;
    const shipMethod: ShipMethod = body?.shipMethod === 'pickup' ? 'pickup' : 'dropoff';

    try {
        const admin = createAdminClient();
        const result = attachTo
            ? await attachToParcel(admin, { sellerId: user.id, orderIds, trackingNumber: attachTo })
            : await mintParcel(admin, { sellerId: user.id, orderIds, shipMethod });
        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        }
        return NextResponse.json({
            success: true,
            trackingNumber: result.trackingNumber,
            orderIds: result.orderIds,
            manual: result.manual,
            pickupBooked: result.pickupBooked === true,
        });
    } catch (err: any) {
        console.error('[Orders/LabelCreate] Error:', err);
        return NextResponse.json({ error: err?.message || 'Could not create the label' }, { status: 500 });
    }
}
