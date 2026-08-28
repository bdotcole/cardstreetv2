/**
 * Nightly milestone sweep: grants badge ledger rows (+ their coin bonuses)
 * from server-side counters via the grant_reward_milestones() RPC — the whole
 * aggregation runs in SQL (PostgREST can't GROUP and row reads cap at 1000).
 * Idempotent: every badge is a one-shot award through the ledger UNIQUE.
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
        const { data, error } = await admin.rpc('grant_reward_milestones');
        if (error) {
            // Missing RPC = migration not applied; quiet no-op by design.
            if (error.code !== 'PGRST202' && error.code !== '42883') {
                console.error('[Cron/RewardsMilestones] RPC failed:', error.message);
            }
            return NextResponse.json({ ok: false, granted: 0 });
        }
        console.log(`[Cron/RewardsMilestones] granted ${data ?? 0} badge awards`);
        return NextResponse.json({ ok: true, granted: data ?? 0 });
    } catch (err) {
        console.error('[Cron/RewardsMilestones] error:', err);
        return NextResponse.json({ ok: false, granted: 0 });
    }
}
