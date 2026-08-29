/**
 * Weekly XP leaderboard (Collector Pass).
 *
 * GET  — this Bangkok ISO week's top opted-in earners + the caller's own
 *        rank/xp and opt-in state. XP only — never GMV or order counts
 *        (PDPA posture), and prizes are badges/pride only, never coins.
 * POST { optIn } — toggle the caller's opt-in. Opting out drops them from
 *        the board immediately (it is computed live from the flag).
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const admin = createAdminClient();
        const [{ data: rw }, { data: board, error }] = await Promise.all([
            admin.from('rewards').select('leaderboard_opt_in').eq('user_id', user.id).maybeSingle(),
            admin.rpc('reward_leaderboard', { p_user: user.id, p_limit: 20 }),
        ]);
        if (error) {
            // Missing RPC/column = 20260830 migration pending — board stays hidden.
            return NextResponse.json({ available: false, optedIn: false, entrants: 0, rows: [] });
        }
        const b = (board ?? {}) as Record<string, unknown>;
        return NextResponse.json({
            available: true,
            optedIn: rw?.leaderboard_opt_in === true,
            entrants: Number(b.entrants ?? 0),
            weekStart: typeof b.week_start === 'string' ? b.week_start : null,
            rows: Array.isArray(b.rows) ? b.rows : [],
            myRank: typeof b.my_rank === 'number' ? b.my_rank : null,
            myXp: typeof b.my_xp === 'number' ? b.my_xp : null,
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[Rewards/Leaderboard] error:', err);
        return NextResponse.json({ available: false, optedIn: false, entrants: 0, rows: [] });
    }
}

export async function POST(req: Request) {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const body = await req.json().catch(() => ({}));
        const optIn = body?.optIn === true;
        const admin = createAdminClient();
        const { error } = await admin
            .from('rewards')
            .update({ leaderboard_opt_in: optIn, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        if (error) {
            return NextResponse.json({ ok: false }, { status: 503 });
        }
        return NextResponse.json({ ok: true, optedIn: optIn });
    } catch (err) {
        console.error('[Rewards/Leaderboard] POST error:', err);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
