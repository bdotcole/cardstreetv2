/**
 * POST /api/live/spots/[id]/release — back out of a held spot (buyer changed
 * their mind or checkout failed). The RPC only releases a hold owned by the
 * caller, so this can never free someone else's spot.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const admin = createAdminClient();
        const { data, error } = await admin.rpc('release_break_spot', {
            p_spot_id: id,
            p_buyer_id: user.id,
        });

        if (error) {
            console.error('[Live/Release] RPC failed:', error.message);
            return NextResponse.json({ error: 'Failed to release spot' }, { status: 500 });
        }

        return NextResponse.json(data ?? { released: false });
    } catch (err: any) {
        console.error('[Live/Release] error:', err);
        return NextResponse.json({ error: 'Failed to release spot' }, { status: 500 });
    }
}
