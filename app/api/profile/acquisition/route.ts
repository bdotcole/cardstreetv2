/**
 * POST /api/profile/acquisition — record which link first brought the
 * signed-in user to Cardstreet (lib/social/acquisitionClient.ts).
 *
 * Write-once and new-accounts-only: a profile that already has an
 * acquisition keeps it (first touch wins), and an account older than
 * ACQUISITION_WINDOW_DAYS is never back-filled from a later visit's tag —
 * the same discipline the partner attribution route applies. Values are
 * sanitised to short lowercase slugs so nothing untrusted lands in the
 * column verbatim.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const ACQUISITION_WINDOW_DAYS = 30;

function clean(v: unknown): string | null {
    const s = typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40) : '';
    return s || null;
}

export async function POST(request: NextRequest) {
    const cookieSupabase = await createServerClient();
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const source = clean(body?.source);
    if (!source) return NextResponse.json({ recorded: false, reason: 'no_source' });
    const landedAt = typeof body?.landedAt === 'string' && !Number.isNaN(Date.parse(body.landedAt))
        ? new Date(body.landedAt).toISOString()
        : null;

    const admin = createAdminClient();
    const { data: me, error } = await admin
        .from('profiles')
        .select('id, created_at, acquisition_source')
        .eq('id', user.id)
        .single();
    if (error || !me) return NextResponse.json({ recorded: false, reason: 'no_profile' });
    if (me.acquisition_source) return NextResponse.json({ recorded: false, reason: 'already_set' });

    const ageDays = (Date.now() - new Date(me.created_at).getTime()) / 86_400_000;
    if (ageDays > ACQUISITION_WINDOW_DAYS) return NextResponse.json({ recorded: false, reason: 'outside_window' });

    const { error: updErr } = await admin
        .from('profiles')
        .update({
            acquisition_source: source,
            acquisition_medium: clean(body?.medium),
            acquisition_campaign: clean(body?.campaign),
            acquisition_landed_at: landedAt,
        })
        .eq('id', user.id)
        .is('acquisition_source', null);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ recorded: true });
}
