/**
 * POST /api/rewards/equip — set displayed cosmetics: { frame?, chatColor?,
 * badges? }. null clears; every value is validated against actual ownership
 * (reward_items for frames/colors, ledger 'badge' rows for badges) before the
 * service-role write, so nothing display-side is client-grantable.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { CHAT_COLORS, FRAME_STYLES } from '@/lib/rewardTiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const gate = await requireBeta('rewards');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const body = await req.json().catch(() => ({}));
        const admin = createAdminClient();
        const update: Record<string, unknown> = {};

        if ('frame' in body) {
            const frame = body.frame;
            if (frame === null) {
                update.equipped_frame = null;
            } else if (typeof frame === 'string' && frame in FRAME_STYLES) {
                const { data } = await admin
                    .from('reward_items')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('item_key', frame)
                    .eq('status', 'active')
                    .limit(1);
                if (!data || data.length === 0) {
                    return NextResponse.json({ ok: false, reason: 'not_owned' }, { status: 403 });
                }
                update.equipped_frame = frame;
            } else {
                return NextResponse.json({ ok: false, reason: 'bad_frame' }, { status: 400 });
            }
        }

        if ('chatColor' in body) {
            const color = body.chatColor;
            if (color === null) {
                update.equipped_chat_color = null;
            } else if (typeof color === 'string' && color in CHAT_COLORS) {
                // Either the all-colours bundle or the single-colour SKU for
                // this exact colour. 'rainbow' has no single-colour SKU, so it
                // stays bundle-only by construction.
                const { data } = await admin
                    .from('reward_items')
                    .select('id')
                    .eq('user_id', user.id)
                    .in('item_key', ['chat_name_color', `chat_color_${color}`])
                    .eq('status', 'active')
                    .limit(1);
                if (!data || data.length === 0) {
                    return NextResponse.json({ ok: false, reason: 'not_owned' }, { status: 403 });
                }
                update.equipped_chat_color = color;
            } else {
                return NextResponse.json({ ok: false, reason: 'bad_color' }, { status: 400 });
            }
        }

        if ('badges' in body) {
            const badges = body.badges;
            if (!Array.isArray(badges) || badges.length > 3 || badges.some((b) => typeof b !== 'string')) {
                return NextResponse.json({ ok: false, reason: 'bad_badges' }, { status: 400 });
            }
            if (badges.length > 0) {
                const { data } = await admin
                    .from('reward_ledger')
                    .select('ref_id')
                    .eq('user_id', user.id)
                    .eq('rule_key', 'badge')
                    .in('ref_id', badges as string[]);
                const earned = new Set(((data ?? []) as { ref_id: string }[]).map((r) => r.ref_id));
                if ((badges as string[]).some((b) => !earned.has(b))) {
                    return NextResponse.json({ ok: false, reason: 'not_earned' }, { status: 403 });
                }
            }
            update.displayed_badges = badges;
        }

        if (Object.keys(update).length === 0) {
            return NextResponse.json({ ok: false, reason: 'nothing_to_do' }, { status: 400 });
        }

        const { error } = await admin
            .from('rewards')
            .update({ ...update, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        if (error) {
            return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 503 });
        }
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[Rewards/Equip] error:', err);
        return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 500 });
    }
}
