/**
 * Admin rewards console API.
 *
 * GET  — economy metrics (admin_rewards_metrics RPC: outstanding balances,
 *        unexpired lots, 30d mint/spend, current month budget, top earners).
 * POST — { action: 'set_budget' | 'adjust' | 'clawback_order' }
 *        set_budget: { budgetSatang, month? }   founder-only budget raises
 *        adjust:     { userId, xp, coins, note } audited manual correction
 *        clawback_order: { orderId, note }      reverse every XP/coin earn
 *          keyed to that order and record the refund (refunds are manual in
 *          Stripe with no DB signal — this is the compensating rail).
 */

import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { bangkokDateString } from '@/lib/rewards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const gate = await requireAdminUser();
    if (gate instanceof NextResponse) return gate;

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('admin_rewards_metrics');
    if (error) {
        return NextResponse.json({ error: 'Metrics unavailable (migration applied?)' }, { status: 503 });
    }
    return NextResponse.json({ metrics: data ?? {} }, { headers: { 'Cache-Control': 'no-store' } });
}

const ORDER_RULES = ['order_paid_buyer', 'order_paid_seller', 'order_settled_buyer', 'order_settled_seller'];

export async function POST(req: Request) {
    const gate = await requireAdminUser();
    if (gate instanceof NextResponse) return gate;
    const { user: adminUser } = gate;

    try {
        const body = await req.json().catch(() => ({}));
        const admin = createAdminClient();

        if (body?.action === 'set_budget') {
            const budgetSatang = Math.round(Number(body?.budgetSatang));
            if (!Number.isFinite(budgetSatang) || budgetSatang < 0 || budgetSatang > 100_000_000) {
                return NextResponse.json({ error: 'Invalid budget' }, { status: 400 });
            }
            const month = typeof body?.month === 'string' && /^\d{4}-\d{2}$/.test(body.month)
                ? body.month
                : bangkokDateString().slice(0, 7);
            const { error } = await admin
                .from('reward_budget')
                .upsert({ month, budget_satang: budgetSatang, updated_at: new Date().toISOString() }, { onConflict: 'month' });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ ok: true, month, budgetSatang });
        }

        if (body?.action === 'adjust') {
            const userId = typeof body?.userId === 'string' ? body.userId : '';
            const xp = Math.round(Number(body?.xp) || 0);
            const coins = Math.round(Number(body?.coins) || 0);
            const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : '';
            if (!userId || (xp === 0 && coins === 0)) {
                return NextResponse.json({ error: 'userId and a non-zero xp or coins required' }, { status: 400 });
            }
            const { data, error } = await admin.rpc('admin_adjust_rewards', {
                p_user: userId, p_xp: xp, p_coins: coins,
                p_note: `[admin ${adminUser.id}] ${note}`,
            });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ ok: true, result: data });
        }

        if (body?.action === 'clawback_order') {
            const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
            const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : '';
            if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

            const { data: rows, error } = await admin
                .from('reward_ledger')
                .select('user_id, rule_key, xp, coins')
                .eq('ref_id', orderId)
                .eq('entry_type', 'earn')
                .in('rule_key', ORDER_RULES);
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            const byUser = new Map<string, { xp: number; coins: number }>();
            for (const r of (rows ?? []) as { user_id: string; xp: number; coins: number }[]) {
                const agg = byUser.get(r.user_id) ?? { xp: 0, coins: 0 };
                agg.xp += r.xp;
                agg.coins += r.coins;
                byUser.set(r.user_id, agg);
            }
            const reversed: { userId: string; xp: number; coins: number }[] = [];
            for (const [userId, agg] of byUser) {
                if (agg.xp === 0 && agg.coins === 0) continue;
                const { error: adjErr } = await admin.rpc('admin_adjust_rewards', {
                    p_user: userId, p_xp: -agg.xp, p_coins: -agg.coins,
                    p_note: `[clawback order ${orderId} by ${adminUser.id}] ${note}`,
                });
                if (!adjErr) reversed.push({ userId, xp: -agg.xp, coins: -agg.coins });
            }
            await admin.from('order_refunds').upsert(
                { order_id: orderId, note, refunded_by: adminUser.id },
                { onConflict: 'order_id' },
            );
            return NextResponse.json({ ok: true, reversed, ledgerRowsFound: rows?.length ?? 0 });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
        console.error('[Admin/Rewards] error:', err);
        return NextResponse.json({ error: 'Request failed' }, { status: 500 });
    }
}
