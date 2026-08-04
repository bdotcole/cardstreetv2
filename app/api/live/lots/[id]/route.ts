/**
 * PATCH  /api/live/lots/[id] — reorder / run / close a lot.
 * DELETE /api/live/lots/[id] — remove a lot that has sold nothing.
 *
 * Status machine served here: queued -> active (puts the lot on the block and
 * pins it as streams.current_item_id), active -> sold | unsold | cancelled.
 * break_opened_at is stamped once and never moved — it is the VOD dispute
 * anchor for "when was this product ripped on camera".
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireLotBroadcaster } from '@/lib/liveBreaks';

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { lot, stream } = ctx;

        const body = await req.json().catch(() => ({}));
        const admin = createAdminClient();

        const updates: Record<string, unknown> = {};

        // ─── Position (reordering the run-of-show) ───
        if (body?.position != null) {
            if (
                typeof body.position !== 'number' ||
                !Number.isInteger(body.position) ||
                body.position < 0
            ) {
                return NextResponse.json(
                    { error: 'position must be a non-negative integer' },
                    { status: 400 },
                );
            }
            if (lot.status !== 'queued' && lot.status !== 'active') {
                return NextResponse.json(
                    { error: 'Only queued or active lots can be repositioned' },
                    { status: 409 },
                );
            }
            updates.position = body.position;
        }

        // ─── break_opened_at (the on-camera rip moment) ───
        // First stamp wins: moving the anchor after the fact would defeat its
        // evidentiary purpose.
        if (body?.breakOpened === true && lot.break_opened_at == null) {
            updates.break_opened_at = new Date().toISOString();
        }

        // ─── Status transition ───
        const nextStatus = typeof body?.status === 'string' ? body.status : null;
        if (nextStatus !== null && nextStatus !== lot.status) {
            const activating = nextStatus === 'active' && lot.status === 'queued';
            const closing =
                lot.status === 'active' &&
                (nextStatus === 'sold' || nextStatus === 'unsold' || nextStatus === 'cancelled');

            if (!activating && !closing) {
                return NextResponse.json(
                    { error: `Cannot transition ${lot.status} -> ${nextStatus}` },
                    { status: 409 },
                );
            }
            if (activating && stream.status !== 'live') {
                return NextResponse.json(
                    { error: 'Stream must be live to run a lot' },
                    { status: 409 },
                );
            }
            updates.status = nextStatus;
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ success: true, lot });
        }

        // CAS on the current status so a stale console can't clobber a
        // transition that already happened.
        const { data: updated, error: updateErr } = await admin
            .from('stream_items')
            .update(updates)
            .eq('id', lot.id)
            .eq('status', lot.status)
            .select()
            .single();

        if (updateErr || !updated) {
            return NextResponse.json(
                { error: 'Lot state changed — reload and try again' },
                { status: 409 },
            );
        }

        // Keep the stream's on-the-block pointer in sync with the transition.
        if (updates.status === 'active') {
            await admin
                .from('streams')
                .update({ current_item_id: lot.id })
                .eq('id', stream.id);
        } else if (updates.status && stream.current_item_id === lot.id) {
            await admin
                .from('streams')
                .update({ current_item_id: null })
                .eq('id', stream.id)
                .eq('current_item_id', lot.id);
        }

        return NextResponse.json({ success: true, lot: updated });
    } catch (err: any) {
        console.error('[Live/Lot] PATCH error:', err);
        return NextResponse.json({ error: err.message || 'Failed to update lot' }, { status: 500 });
    }
}

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireLotBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { lot, stream } = ctx;

        const admin = createAdminClient();

        // A sold spot means a buyer's money is attached to this lot — the lot
        // is now a record, not a draft.
        const { count: soldCount } = await admin
            .from('break_spots')
            .select('id', { count: 'exact', head: true })
            .eq('stream_item_id', lot.id)
            .eq('status', 'sold');
        if ((soldCount ?? 0) > 0) {
            return NextResponse.json(
                { error: 'Cannot delete a lot with sold spots' },
                { status: 409 },
            );
        }

        // An unexpired hold is a buyer mid-checkout; deleting now would strand
        // their payment (orders.break_spot_id nulls out on cascade). Expired
        // holds don't block — they're stealable anyway.
        const { count: heldCount } = await admin
            .from('break_spots')
            .select('id', { count: 'exact', head: true })
            .eq('stream_item_id', lot.id)
            .eq('status', 'held')
            .gt('hold_expires_at', new Date().toISOString());
        if ((heldCount ?? 0) > 0) {
            return NextResponse.json(
                { error: 'A buyer is checking out a spot on this lot — try again shortly' },
                { status: 409 },
            );
        }

        if (stream.current_item_id === lot.id) {
            await admin
                .from('streams')
                .update({ current_item_id: null })
                .eq('id', stream.id)
                .eq('current_item_id', lot.id);
        }

        // break_spots cascade with the lot.
        const { error: deleteErr } = await admin
            .from('stream_items')
            .delete()
            .eq('id', lot.id);
        if (deleteErr) {
            console.error('[Live/Lot] delete failed:', deleteErr.message);
            return NextResponse.json({ error: 'Failed to delete lot' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Live/Lot] DELETE error:', err);
        return NextResponse.json({ error: err.message || 'Failed to delete lot' }, { status: 500 });
    }
}
