/**
 * Seller shop pause ("vacation mode") — Profile > Seller Account.
 *
 *   GET  → { available, paused, pausedAt, activeCount, pausedCount }
 *   POST { paused: boolean } → { paused, pausedAt, affected }
 *
 * The flip itself is the set_shop_paused() SQL function
 * (20260925_seller_shop_pause.sql): it stamps profiles.shop_paused_at and
 * moves every active listing to 'paused' (or back) in ONE transaction, running
 * as auth.uid() so there is no seller id in the body to spoof. This route is
 * therefore a thin auth + shape layer over the cookie client — no service role
 * needed.
 *
 * Fails soft before the migration runs: a missing column/function reports
 * `available: false` (GET) or 503 (POST) and the client hides the toggle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// PostgREST/Postgres codes for "the migration has not run yet".
const MISSING_SCHEMA_CODES = new Set(['42703', '42883', 'PGRST202', 'PGRST204']);
function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    if (error.code && MISSING_SCHEMA_CODES.has(error.code)) return true;
    return /shop_paused_at|set_shop_paused/i.test(error.message || '') &&
        /does not exist|could not find|schema cache/i.test(error.message || '');
}

export async function GET() {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('shop_paused_at')
        .eq('id', user.id)
        .maybeSingle<{ shop_paused_at: string | null }>();

    if (profileErr) {
        if (isMissingSchema(profileErr)) {
            return NextResponse.json({ available: false, paused: false, pausedAt: null, activeCount: 0, pausedCount: 0 });
        }
        console.error('[Profile/Shop] status read failed:', profileErr);
        return NextResponse.json({ error: 'Failed to load shop status' }, { status: 500 });
    }

    // Counts drive the confirm copy ("hide N listings") and the paused-state
    // summary. Owner-only via RLS, so the cookie client sees every status.
    const [{ count: activeCount }, { count: pausedCount }] = await Promise.all([
        supabase.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', user.id).eq('status', 'active'),
        supabase.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', user.id).eq('status', 'paused'),
    ]);

    return NextResponse.json({
        available: true,
        paused: !!profile?.shop_paused_at,
        pausedAt: profile?.shop_paused_at ?? null,
        activeCount: activeCount ?? 0,
        pausedCount: pausedCount ?? 0,
    });
}

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body?.paused !== 'boolean') {
        return NextResponse.json({ error: 'paused must be a boolean' }, { status: 400 });
    }
    const paused: boolean = body.paused;

    const { data: affected, error: rpcErr } = await supabase.rpc('set_shop_paused', { p_paused: paused });
    if (rpcErr) {
        if (isMissingSchema(rpcErr)) {
            return NextResponse.json(
                { error: 'Shop pause is not available yet', code: 'NOT_AVAILABLE' },
                { status: 503 },
            );
        }
        console.error('[Profile/Shop] set_shop_paused failed:', rpcErr);
        return NextResponse.json({ error: 'Failed to update shop status' }, { status: 500 });
    }

    // Read the stamp back rather than trusting the clock here: on pause the
    // function keeps an earlier timestamp if one was already set.
    const { data: profile } = await supabase
        .from('profiles')
        .select('shop_paused_at')
        .eq('id', user.id)
        .maybeSingle<{ shop_paused_at: string | null }>();

    return NextResponse.json({
        paused: !!profile?.shop_paused_at,
        pausedAt: profile?.shop_paused_at ?? null,
        affected: typeof affected === 'number' ? affected : 0,
    });
}
