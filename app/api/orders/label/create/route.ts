/**
 * POST /api/orders/label/create
 *
 * The seller mints the Flash waybill for a set of their unlabelled orders
 * from one buyer (one checkout, or several combined into one parcel), or
 * adds those orders to a waybill of that buyer's that Flash has not scanned
 * yet. Labels are not created at payment any more; this is where they come
 * from. See lib/parcels.
 *
 * Body: { orderIds: string[], attachToTrackingNumber?: string }
 * Auth: cookie session; every order must belong to the caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mintParcel, attachToParcel } from '@/lib/parcels';

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

    try {
        const admin = createAdminClient();
        const result = attachTo
            ? await attachToParcel(admin, { sellerId: user.id, orderIds, trackingNumber: attachTo })
            : await mintParcel(admin, { sellerId: user.id, orderIds });
        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        }
        return NextResponse.json({
            success: true,
            trackingNumber: result.trackingNumber,
            orderIds: result.orderIds,
            manual: result.manual,
        });
    } catch (err: any) {
        console.error('[Orders/LabelCreate] Error:', err);
        return NextResponse.json({ error: err?.message || 'Could not create the label' }, { status: 500 });
    }
}
