/**
 * Monthly coin-expiry sweep (expire_reward_coins RPC): zeroes FIFO lots past
 * their expires_at, debits balances, and writes one 'expire' ledger row per
 * affected user. Coins carry a 12-month expiry, so this is a structural no-op
 * for the program's first year — scheduled from day one so it can't be
 * forgotten later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const admin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );
        const { data, error } = await admin.rpc('expire_reward_coins');
        if (error) {
            if (error.code !== 'PGRST202' && error.code !== '42883') {
                console.error('[Cron/RewardsExpiry] RPC failed:', error.message);
            }
            return NextResponse.json({ ok: false, usersSwept: 0 });
        }
        console.log(`[Cron/RewardsExpiry] swept expired coins for ${data ?? 0} users`);
        return NextResponse.json({ ok: true, usersSwept: data ?? 0 });
    } catch (err) {
        console.error('[Cron/RewardsExpiry] error:', err);
        return NextResponse.json({ ok: false, usersSwept: 0 });
    }
}
