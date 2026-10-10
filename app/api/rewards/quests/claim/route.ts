/**
 * POST /api/rewards/quests/claim { slot } — claim one of today's quests.
 *
 * Progress is derived from the user's OWN reward_ledger earn rows for today's
 * Bangkok day — never from a client-reported counter — so a quest can only be
 * claimed after the underlying server-awarded actions actually happened. The
 * quest schedule is fixed by weekday (admin-edited reward_config, defaults in
 * lib/rewardTiers.ts QUESTS_BY_WEEKDAY), identical for all users, deliberately
 * randomness-free.
 *
 * Idempotency: the quest award's ref_id is `${bangkokDate}:${slot}` and the
 * all-three bonus's ref_id is the date — both once-only via the ledger UNIQUE.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { awardEvent, bangkokDateString, bangkokDayStartIso, bangkokWeekday } from '@/lib/rewards';
import { getRewardConfig } from '@/lib/rewardConfig.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const body = await req.json().catch(() => ({}));
        const slot = Number(body?.slot);
        const admin = createAdminClient();
        const { quests: questConfig } = await getRewardConfig(admin);
        const quests = questConfig.byWeekday[bangkokWeekday()] ?? [];
        if (!Number.isInteger(slot) || slot < 0 || slot >= quests.length) {
            return NextResponse.json({ ok: false, error: 'Invalid quest' }, { status: 400 });
        }
        const quest = quests[slot];
        const today = bangkokDateString();

        const { data: rows, error } = await admin
            .from('reward_ledger')
            .select('rule_key, ref_id')
            .eq('user_id', user.id)
            .eq('entry_type', 'earn')
            .gte('created_at', bangkokDayStartIso())
            .limit(200);
        if (error) {
            return NextResponse.json({ ok: false, claimed: false, reason: 'unavailable' });
        }

        const progress = (rows ?? []).filter((r) => r.rule_key === quest.rule).length;
        if (progress < quest.target) {
            return NextResponse.json({ ok: true, claimed: false, reason: 'incomplete', progress, target: quest.target });
        }

        const award = await awardEvent(admin, {
            userId: user.id,
            rule: 'quest',
            ref: `${today}:${slot}`,
            xp: questConfig.xp,
            coins: questConfig.coins,
        });
        if (!award?.awarded) {
            return NextResponse.json({ ok: true, claimed: false, reason: award?.reason ?? 'unavailable' });
        }

        // Every one of today's challenges claimed (this one included) =>
        // once-only bonus. Only slots that exist today count: an admin can
        // shorten today's list after someone claimed a later slot.
        const claimedBefore = new Set(
            (rows ?? [])
                .filter((r) => r.rule_key === 'quest' && r.ref_id.startsWith(today))
                .map((r) => Number(r.ref_id.split(':')[1]))
                .filter((s) => Number.isInteger(s) && s < quests.length),
        );
        claimedBefore.add(slot);
        let bonus = 0;
        if (claimedBefore.size >= quests.length) {
            const bonusAward = await awardEvent(admin, {
                userId: user.id,
                rule: 'quest_bonus',
                ref: today,
                xp: 0,
                coins: questConfig.bonusCoins,
            });
            if (bonusAward?.awarded) bonus = questConfig.bonusCoins;
        }

        return NextResponse.json({
            ok: true,
            claimed: true,
            xp: questConfig.xp,
            coins: questConfig.coins,
            bonusCoins: bonus,
            leveledUp: award.leveledUp === true,
            level: award.level ?? 1,
            coinBalance: (award.coinBalance ?? 0) + bonus,
            xpTotal: award.xpTotal ?? 0,
        });
    } catch (err) {
        console.error('[Rewards/QuestClaim] error:', err);
        return NextResponse.json({ ok: false, claimed: false, reason: 'unavailable' });
    }
}
