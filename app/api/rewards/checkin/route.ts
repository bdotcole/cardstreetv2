/**
 * POST /api/rewards/checkin — claim today's daily check-in (explicit tap,
 * Shopee-style). All logic lives in the claim_daily_checkin SECURITY DEFINER
 * RPC: Bangkok calendar day, CAS on last_checkin_date, streak math with one
 * free auto-repair then streak freezes, calendar coins, once-ever streak
 * milestones. The route is just auth + the service-role RPC call.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { awardFirst } from '@/lib/rewards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const admin = createAdminClient();

        // A first-ever check-in is also account activation for pre-ledger users.
        await awardFirst(admin, user.id, 'first_account');

        const { data, error } = await admin.rpc('claim_daily_checkin', { p_user: user.id });
        if (error) {
            // Missing RPC = migration not applied; anything else is logged.
            if (error.code !== 'PGRST202' && error.code !== '42883') {
                console.error('[Rewards/Checkin] RPC failed:', error.message);
            }
            return NextResponse.json({ ok: false, claimed: false, reason: 'unavailable' });
        }

        const row = (data ?? {}) as Record<string, unknown>;
        return NextResponse.json({
            ok: true,
            claimed: row.claimed === true,
            reason: typeof row.reason === 'string' ? row.reason : undefined,
            streak: Number(row.streak ?? 0),
            cycleDay: Number(row.cycle_day ?? 0),
            coins: Number(row.coins ?? 0),
            xp: Number(row.xp ?? 0),
            milestoneCoins: Number(row.milestone_coins ?? 0),
            freeRepairUsed: row.free_repair_used === true,
            freezeUsed: row.freeze_used === true,
            leveledUp: row.leveled_up === true,
            level: Number(row.level ?? 1),
            coinBalance: Number(row.coin_balance ?? 0),
            xpTotal: Number(row.xp_total ?? 0),
        });
    } catch (err) {
        console.error('[Rewards/Checkin] error:', err);
        return NextResponse.json({ ok: false, claimed: false, reason: 'unavailable' });
    }
}
