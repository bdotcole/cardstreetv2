/**
 * POST /api/rewards/quests/claim { slot } — claim one of today's three quests.
 *
 * Progress is derived from the user's OWN reward_ledger earn rows for today's
 * Bangkok day — never from a client-reported counter — so a quest can only be
 * claimed after the underlying server-awarded actions actually happened. The
 * quest schedule is fixed by weekday (lib/rewardTiers.ts QUESTS_BY_WEEKDAY),
 * identical for all users, deliberately randomness-free.
 *
 * Idempotency: the quest award's ref_id is `${bangkokDate}:${slot}` and the
 * all-three bonus's ref_id is the date — both once-only via the ledger UNIQUE.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { awardEvent, bangkokDateString, bangkokDayStartIso, bangkokWeekday } from '@/lib/rewards';
import { QUESTS_BY_WEEKDAY, QUEST_XP, QUEST_COINS, QUEST_BONUS_COINS } from '@/lib/rewardTiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const body = await req.json().catch(() => ({}));
        const slot = Number(body?.slot);
        const quests = QUESTS_BY_WEEKDAY[bangkokWeekday()] ?? [];
        if (!Number.isInteger(slot) || slot < 0 || slot >= quests.length) {
            return NextResponse.json({ ok: false, error: 'Invalid quest' }, { status: 400 });
        }
        const quest = quests[slot];
        const today = bangkokDateString();
        const admin = createAdminClient();

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
            xp: QUEST_XP,
            coins: QUEST_COINS,
        });
        if (!award?.awarded) {
            return NextResponse.json({ ok: true, claimed: false, reason: award?.reason ?? 'unavailable' });
        }

        // All three claimed today (this one included) => once-only bonus.
        const claimedBefore = new Set(
            (rows ?? [])
                .filter((r) => r.rule_key === 'quest' && r.ref_id.startsWith(today))
                .map((r) => r.ref_id.split(':')[1]),
        );
        claimedBefore.add(String(slot));
        let bonus = 0;
        if (claimedBefore.size >= quests.length) {
            const bonusAward = await awardEvent(admin, {
                userId: user.id,
                rule: 'quest_bonus',
                ref: today,
                xp: 0,
                coins: QUEST_BONUS_COINS,
            });
            if (bonusAward?.awarded) bonus = QUEST_BONUS_COINS;
        }

        return NextResponse.json({
            ok: true,
            claimed: true,
            xp: QUEST_XP,
            coins: QUEST_COINS,
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
