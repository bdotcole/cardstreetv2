/**
 * PATCH /api/live/polls/[id] — broadcaster closes a poll. Final recount, then
 * an open -> closed CAS (already-closed returns 409); the result is announced
 * in system chat with the winning option.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    POLL_COLS,
    isMissingTableError,
    postSystemChat,
    recountPollTallies,
    requireBroadcaster,
    type PollRow,
} from '@/lib/liveBreaks';

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;

        const admin = createAdminClient();
        const { data: poll, error: pollErr } = await admin
            .from('stream_polls')
            .select(POLL_COLS)
            .eq('id', id)
            .maybeSingle<PollRow>();
        if (pollErr && !isMissingTableError(pollErr)) {
            console.error('[Live/Polls] lookup failed:', pollErr.message);
            return NextResponse.json({ error: 'Failed to update poll' }, { status: 500 });
        }
        if (!poll) {
            // Missing table and missing row both land here — same no-hint 404
            // a wrong-owner probe gets from the broadcaster gate below.
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        // Ownership + beta ride the stream guard (wrong owner -> the same 404).
        const ctx = await requireBroadcaster(poll.stream_id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        const body = await req.json().catch(() => ({}));
        const closing = body?.action === 'close' || body?.status === 'closed';
        if (!closing) {
            return NextResponse.json({ error: 'Unsupported poll update' }, { status: 400 });
        }
        if (poll.status !== 'open') {
            return NextResponse.json(
                { error: 'Poll is already closed', code: 'POLL_CLOSED' },
                { status: 409 },
            );
        }

        // Final recount BEFORE the flip so the announced winner matches the
        // frozen tallies even if a vote's recount was still in flight.
        const optionKeys = (poll.options ?? []).map((o) => o.key);
        const tallies = await recountPollTallies(poll.id, optionKeys);

        const { data: closed, error: closeErr } = await admin
            .from('stream_polls')
            .update({ status: 'closed', closed_at: new Date().toISOString(), tallies })
            .eq('id', poll.id)
            .eq('status', 'open')
            .select(POLL_COLS)
            .maybeSingle<PollRow>();
        if (closeErr) {
            console.error('[Live/Polls] close failed:', closeErr.message);
            return NextResponse.json({ error: 'Failed to close poll' }, { status: 500 });
        }
        if (!closed) {
            return NextResponse.json(
                { error: 'Poll is already closed', code: 'POLL_CLOSED' },
                { status: 409 },
            );
        }

        const totalVotes = optionKeys.reduce((sum, key) => sum + (tallies[key] ?? 0), 0);
        let announcement = `Poll closed: ${poll.question} — no votes`;
        if (totalVotes > 0) {
            const winnerKey = optionKeys.reduce((best, key) =>
                (tallies[key] ?? 0) > (tallies[best] ?? 0) ? key : best,
            );
            const winner = poll.options.find((o) => o.key === winnerKey);
            announcement = `Poll closed: ${poll.question} — ${winner?.label ?? winnerKey} (${tallies[winnerKey] ?? 0}/${totalVotes})`;
        }
        await postSystemChat(stream.id, user.id, announcement);

        return NextResponse.json({ success: true, poll: closed });
    } catch (err: any) {
        console.error('[Live/Polls] PATCH error:', err);
        return NextResponse.json({ error: 'Failed to update poll' }, { status: 500 });
    }
}
