/**
 * GET /api/rewards/summary — everything the Rewards Hub renders in one call:
 * balances, level, streak/check-in state, today's quests with progress, the
 * Collector's Journey checklist, and recent ledger activity.
 *
 * Beta-gated (requireBeta('rewards') — global kill switch + per-user grant),
 * and fail-soft against the unapplied 20260828 migration: missing columns or
 * tables return { enabled: false } instead of erroring, so the client simply
 * hides the rewards UI.
 *
 * Also the lazy hook for two one-shot awards with no clean server event:
 * first_account (signup predates the ledger for existing users) and
 * first_profile_complete (avatar uploads and username saves land through
 * different paths) — both idempotent via the ledger UNIQUE.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { awardFirst } from '@/lib/rewards';
import { bangkokDateString, bangkokDayStartIso, bangkokWeekday } from '@/lib/rewards';
import { FIRST_AWARDS, QUESTS_BY_WEEKDAY } from '@/lib/rewardTiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LedgerRow {
    rule_key: string;
    ref_id: string;
    xp: number;
    coins: number;
    created_at: string;
}

export async function GET() {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const admin = createAdminClient();
        const today = bangkokDateString();
        const dayStart = bangkokDayStartIso();
        const weekday = bangkokWeekday();
        const quests = QUESTS_BY_WEEKDAY[weekday] ?? [];

        // Lazy one-shot awards (idempotent; run before reading balances so the
        // very first open already shows them).
        await awardFirst(admin, user.id, 'first_account');
        const { data: prof } = await admin
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', user.id)
            .maybeSingle();
        if (prof?.username && prof?.avatar_url) {
            await awardFirst(admin, user.id, 'first_profile_complete');
        }

        const { data: rw, error: rwErr } = await admin
            .from('rewards')
            .select('xp_total, level, coin_balance, streak_days, streak_best, last_checkin_date, streak_freezes, free_repair_used')
            .eq('user_id', user.id)
            .maybeSingle();

        if (rwErr) {
            // 42703 / PGRST204: migration not applied yet — rewards UI stays dark.
            return NextResponse.json({ signedIn: true, enabled: false });
        }

        const streak = rw?.streak_days ?? 0;
        const lastCheckin: string | null = rw?.last_checkin_date ?? null;
        const claimedToday = lastCheckin === today;

        // The calendar cell today's claim did (or would) land on. Mirrors
        // claim_daily_checkin's gap logic without consuming anything.
        let prospectiveStreak = 1;
        if (claimedToday) {
            prospectiveStreak = streak;
        } else if (lastCheckin) {
            const gapDays = Math.round(
                (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastCheckin}T00:00:00Z`)) / 86400000,
            );
            if (gapDays === 1) prospectiveStreak = streak + 1;
            else if (gapDays === 2 && (!rw?.free_repair_used || (rw?.streak_freezes ?? 0) > 0)) prospectiveStreak = streak + 1;
        }
        const cycleDay = ((Math.max(1, prospectiveStreak) - 1) % 7) + 1;

        const [todayRows, journeyRows, recentRows] = await Promise.all([
            admin
                .from('reward_ledger')
                .select('rule_key, ref_id, xp, coins, created_at')
                .eq('user_id', user.id)
                .eq('entry_type', 'earn')
                .gte('created_at', dayStart)
                .limit(200)
                .then((r) => (r.data ?? []) as LedgerRow[]),
            admin
                .from('reward_ledger')
                .select('rule_key')
                .eq('user_id', user.id)
                .eq('entry_type', 'earn')
                .in('rule_key', FIRST_AWARDS.map((a) => a.key))
                .limit(FIRST_AWARDS.length)
                .then((r) => (r.data ?? []) as Pick<LedgerRow, 'rule_key'>[]),
            admin
                .from('reward_ledger')
                .select('rule_key, ref_id, xp, coins, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(10)
                .then((r) => (r.data ?? []) as LedgerRow[]),
        ]);

        const countByRule = new Map<string, number>();
        for (const row of todayRows) {
            countByRule.set(row.rule_key, (countByRule.get(row.rule_key) ?? 0) + 1);
        }
        const claimedSlots = new Set(
            todayRows
                .filter((r) => r.rule_key === 'quest' && r.ref_id.startsWith(today))
                .map((r) => r.ref_id.split(':')[1]),
        );

        const done = new Set(journeyRows.map((r) => r.rule_key));

        return NextResponse.json({
            signedIn: true,
            enabled: true,
            coins: Number(rw?.coin_balance ?? 0),
            xp: Number(rw?.xp_total ?? 0),
            level: rw?.level ?? 1,
            streak,
            streakBest: rw?.streak_best ?? 0,
            freezes: rw?.streak_freezes ?? 0,
            freeRepairUsed: rw?.free_repair_used ?? false,
            checkinClaimedToday: claimedToday,
            cycleDay,
            quests: quests.map((q, slot) => ({
                slot,
                rule: q.rule,
                target: q.target,
                progress: Math.min(q.target, countByRule.get(q.rule) ?? 0),
                claimed: claimedSlots.has(String(slot)),
            })),
            questBonusClaimed: todayRows.some((r) => r.rule_key === 'quest_bonus' && r.ref_id === today),
            journey: FIRST_AWARDS.map((a) => ({ key: a.key, xp: a.xp, coins: a.coins, done: done.has(a.key) })),
            recent: recentRows.map((r) => ({
                rule: r.rule_key,
                xp: r.xp,
                coins: r.coins,
                at: r.created_at,
            })),
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
        console.error('[Rewards/Summary] error:', err);
        return NextResponse.json({ signedIn: true, enabled: false });
    }
}
