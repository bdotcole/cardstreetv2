/**
 * POST /api/live/lots/[id]/hit — the breaker records the current turn's HIT
 * on a rip_till_hit lot. Body: { spotId, hit }.
 *
 * hit_at is the turn-complete flag (the current turn is the lowest sold spot
 * without one), so this write is what advances the show to the next turn.
 * Written once, CAS-guarded — a re-tap or a second console can't overwrite a
 * recorded hit. Announced in chat; the board updates through the break_spots
 * Realtime UPDATE every client already subscribes to.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { postSystemChat, requireLotBroadcaster } from '@/lib/liveBreaks';

const HIT_MAX = 200;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, lot, stream } = ctx;

        if (lot.item_type !== 'rip_till_hit') {
            return NextResponse.json({ error: 'Not a rip-til-you-hit lot' }, { status: 400 });
        }

        const body = await req.json().catch(() => ({}));
        const spotId = typeof body?.spotId === 'string' ? body.spotId : body?.spot_id;
        const hit = typeof body?.hit === 'string' ? body.hit.trim() : '';
        if (!spotId || !hit || hit.length > HIT_MAX) {
            return NextResponse.json(
                { error: `hit text is required (1-${HIT_MAX} characters)` },
                { status: 400 },
            );
        }

        const admin = createAdminClient();
        const { data: updated, error } = await admin
            .from('break_spots')
            .update({ hit_note: hit, hit_at: new Date().toISOString() })
            .eq('id', spotId)
            .eq('stream_item_id', lot.id)
            .eq('status', 'sold')
            .is('hit_at', null)
            .select('id, spot_number, buyer_id')
            .maybeSingle<{ id: string; spot_number: number; buyer_id: string | null }>();

        // Pre-migration tolerance: hit columns absent until 20260818 runs.
        if (error && (error.code === '42703' || error.code === 'PGRST204')) {
            console.warn('[Live/Hit] hit columns missing (run 20260818_rip_till_hit.sql)');
            return NextResponse.json(
                { error: 'Rip-til-you-hit is not available yet' },
                { status: 503 },
            );
        }
        if (error) {
            console.error('[Live/Hit] update failed:', error.message);
            return NextResponse.json({ error: 'Failed to record the hit' }, { status: 500 });
        }
        if (!updated) {
            // Wrong lot, unsold turn, or the hit is already on record.
            return NextResponse.json(
                { error: 'Turn not found, unpaid, or already recorded', code: 'NOT_RECORDABLE' },
                { status: 409 },
            );
        }

        let buyerName: string | null = null;
        if (updated.buyer_id) {
            const { data: p } = await admin
                .from('profiles')
                .select('display_name')
                .eq('id', updated.buyer_id)
                .maybeSingle<{ display_name: string | null }>();
            buyerName = p?.display_name ?? null;
        }
        await postSystemChat(
            stream.id,
            user.id,
            `HIT — Turn #${updated.spot_number}${buyerName ? ` (${buyerName})` : ''}: ${hit}`,
        );

        return NextResponse.json({ success: true, spotNumber: updated.spot_number });
    } catch (err: any) {
        console.error('[Live/Hit] error:', err);
        return NextResponse.json({ error: 'Failed to record the hit' }, { status: 500 });
    }
}
