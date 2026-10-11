/**
 * POST /api/rewards/redeem { itemKey } — spend coins on a catalog item.
 *
 * All economics live in the redeem_reward_item RPC (atomic: level gate,
 * once-ever gate, streak-freeze cap, monthly THB budget breaker for real-cost
 * SKUs, FIFO coin spend, item mint). This route resolves the catalog def,
 * builds item metadata, and applies the one effect that lives outside the DB:
 * the Pro trial's premium grant through the existing service-role comp rail.
 *
 * Vouchers additionally require the 'rewards_vouchers' kill switch — the
 * checkout-money rail is independently killable from the rest of rewards.
 */

import { NextResponse } from 'next/server';
import { requireBeta, isFeatureEnabled } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { CATALOG_BY_KEY } from '@/lib/rewardTiers';
import { EMOTE_PACKS } from '@/components/rewards/emotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const body = await req.json().catch(() => ({}));
        const itemKey = typeof body?.itemKey === 'string' ? body.itemKey : '';
        const def = CATALOG_BY_KEY[itemKey];
        if (!def || !def.redeemable) {
            return NextResponse.json({ ok: false, reason: 'unknown_item' }, { status: 400 });
        }
        if (def.kind === 'voucher' && !(await isFeatureEnabled('rewards_vouchers'))) {
            return NextResponse.json({ ok: false, reason: 'vouchers_disabled' }, { status: 403 });
        }

        const admin = createAdminClient();
        let meta: Record<string, unknown> = {};
        let expiresAt: string | null = null;

        if (def.voucher) {
            meta = {
                type: def.voucher.type,
                amountSatang: def.voucher.amountSatang,
                minOrderSatang: def.voucher.minOrderSatang,
            };
            expiresAt = new Date(Date.now() + def.voucher.validDays * 86400000).toISOString();
        }

        // Emote early unlock buys the LOWEST pack still locked by level and
        // not already owned; the top (legend) pack is never purchasable so the
        // highest band keeps its prestige.
        if (itemKey === 'emote_early_unlock') {
            const [{ data: rw }, { data: owned }] = await Promise.all([
                admin.from('rewards').select('level').eq('user_id', user.id).maybeSingle(),
                admin.from('reward_items').select('meta').eq('user_id', user.id)
                    .eq('item_key', 'emote_early_unlock').eq('status', 'active'),
            ]);
            const level = typeof rw?.level === 'number' ? rw.level : 1;
            const ownedPacks = new Set(
                ((owned ?? []) as { meta: { pack?: string } | null }[])
                    .map((r) => r.meta?.pack)
                    .filter((p): p is string => !!p),
            );
            const target = EMOTE_PACKS.find(
                (p) => p.key !== 'legend' && p.minLevel > level && !ownedPacks.has(p.key),
            );
            if (!target) {
                return NextResponse.json({ ok: false, reason: 'nothing_to_unlock' }, { status: 400 });
            }
            meta = { pack: target.key };
        }

        const { data, error } = await admin.rpc('redeem_reward_item', {
            p_user: user.id,
            p_item_key: itemKey,
            p_coins: def.coins,
            p_real_cost_satang: def.realCostSatang ?? 0,
            p_min_level: def.minLevel ?? 1,
            p_once: def.oncePerAccount === true,
            p_meta: meta,
            p_expires_at: expiresAt,
        });
        if (error) {
            if (error.code !== 'PGRST202' && error.code !== '42883') {
                console.error('[Rewards/Redeem] RPC failed:', error.message);
            }
            return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 503 });
        }
        const result = (data ?? {}) as Record<string, unknown>;
        if (result.ok !== true) {
            return NextResponse.json({ ok: false, reason: String(result.reason ?? 'failed') });
        }

        // Pro trial: extend premium through the established comp rail
        // (service-role premium_until write under the protect trigger + a
        // subscriptions audit row). If this half fails after coins were spent,
        // scream — the admin adjust tool makes the user whole.
        if (itemKey === 'pro_trial_7d') {
            try {
                const { data: prof } = await admin
                    .from('profiles')
                    .select('premium_until')
                    .eq('id', user.id)
                    .maybeSingle();
                const base = prof?.premium_until && Date.parse(prof.premium_until) > Date.now()
                    ? new Date(prof.premium_until)
                    : new Date();
                const until = new Date(base.getTime() + 7 * 86400000).toISOString();
                const { error: premErr } = await admin
                    .from('profiles')
                    .update({ premium_until: until })
                    .eq('id', user.id);
                if (premErr) throw premErr;
                await admin.from('subscriptions').insert({
                    user_id: user.id,
                    provider: 'manual',
                    platform: 'web',
                    product_id: 'pro_trial_7d_coins',
                    status: 'active',
                    current_period_end: until,
                });
            } catch (premiumErr) {
                console.error(
                    `[Rewards/Redeem] PRO TRIAL GRANT FAILED for ${user.id} after coin spend — fix via admin adjust:`,
                    (premiumErr as Error)?.message,
                );
            }
        }

        return NextResponse.json({
            ok: true,
            itemKey,
            itemId: result.item_id ?? null,
            coinBalance: Number(result.coin_balance ?? 0),
        });
    } catch (err) {
        console.error('[Rewards/Redeem] error:', err);
        return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 500 });
    }
}
