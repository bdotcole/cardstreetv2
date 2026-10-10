/**
 * POST /api/orders/ship-together
 *
 * Seller action: combine two or more of one buyer's unshipped parcels into a
 * single Flash waybill so the cards go out in one envelope under one label.
 * Body: { orderIds: string[] } — any orders from the parcels to combine; the
 * server expands to every order under each touched waybill. The oldest
 * waybill survives, the others are cancelled at Flash. See lib/shipTogether.
 *
 * Auth: cookie session; every touched order must belong to the caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { mergeParcels } from '@/lib/shipTogether';

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
    if (orderIds.length < 2 || orderIds.length > 100) {
        return NextResponse.json({ error: 'Pick at least two orders to ship together' }, { status: 400 });
    }

    try {
        const result = await mergeParcels(createAdminClient(), { sellerId: user.id, orderIds });
        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        }
        return NextResponse.json({
            success: true,
            trackingNumber: result.keptTrackingNumber,
            cancelledTrackingNumbers: result.cancelledTrackingNumbers,
            flashCancelFailures: result.flashCancelFailures,
            orderIds: result.orderIds,
        });
    } catch (err: any) {
        console.error('[Orders/ShipTogether] Error:', err);
        return NextResponse.json({ error: err?.message || 'Could not combine parcels' }, { status: 500 });
    }
}
