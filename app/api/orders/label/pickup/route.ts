/**
 * POST /api/orders/label/pickup
 *
 * The seller books a Flash courier pickup for a parcel that already has its
 * label and that Flash has not scanned: they chose drop-off and changed their
 * mind, or a booked courier never came (Flash cancels those without telling
 * us). See lib/parcels bookPickup for the rebook window and double-tap guard.
 *
 * Body: { trackingNumber: string }
 * Auth: cookie session; every order on the waybill must belong to the caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { bookPickup } from '@/lib/parcels';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const trackingNumber = typeof body?.trackingNumber === 'string' ? body.trackingNumber.trim() : '';
    if (!trackingNumber) {
        return NextResponse.json({ error: 'trackingNumber is required' }, { status: 400 });
    }

    try {
        const result = await bookPickup(createAdminClient(), { sellerId: user.id, trackingNumber });
        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        }
        return NextResponse.json({ success: true, trackingNumber: result.trackingNumber, pickupId: result.pickupId });
    } catch (err: any) {
        console.error('[Orders/LabelPickup] Error:', err);
        return NextResponse.json({ error: err?.message || 'Could not book the pickup' }, { status: 500 });
    }
}
