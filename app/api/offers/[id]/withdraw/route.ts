/**
 * OBO Best-Offer — withdraw your own pending offer.
 *
 * Only the ACTOR (the party who made the pending row) may withdraw. CAS
 * pending -> withdrawn, with an extra WHERE on the actor's column so the wrong
 * party can never withdraw. No notification.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { id } = await params;

    const cookieSupabase = await createServerClient();
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: offer } = await admin
        .from('offers')
        .select('id, buyer_id, seller_id, actor_role, status')
        .eq('id', id)
        .single();

    if (!offer || offer.status !== 'pending') {
        return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 409 });
    }

    const actorCol = offer.actor_role === 'buyer' ? 'buyer_id' : 'seller_id';
    const { data: won } = await admin
        .from('offers')
        .update({ status: 'withdrawn' })
        .eq('id', id)
        .eq('status', 'pending')
        .eq(actorCol, user.id)
        .select('id');
    if (!won || won.length !== 1) {
        // Either not pending anymore, or the caller isn't the actor.
        return NextResponse.json({ error: 'Offer cannot be withdrawn' }, { status: 409 });
    }

    return NextResponse.json({ id: offer.id, status: 'withdrawn' });
}
