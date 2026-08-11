/**
 * POST /api/live/polls/[id]/vote — viewer votes (or changes their vote) on an
 * open poll of a live stream. One row per (poll, user) — the upsert moves the
 * vote. After the upsert the route recounts ALL votes into
 * stream_polls.tallies with the service role, so Realtime pushes live results
 * to everyone; the last-write recount is self-correcting under concurrency.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import {
    POLL_COLS,
    isMissingTableError,
    recountPollTallies,
    type PollRow,
} from '@/lib/liveBreaks';

const VOTE_WINDOW_SECONDS = 30;
const VOTE_MAX_PER_WINDOW = 6;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const admin = createAdminClient();
        const { data: poll, error: pollErr } = await admin
            .from('stream_polls')
            .select(POLL_COLS)
            .eq('id', id)
            .maybeSingle<PollRow>();
        if (pollErr && !isMissingTableError(pollErr)) {
            console.error('[Live/PollVote] lookup failed:', pollErr.message);
            return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 });
        }
        if (!poll) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (poll.status !== 'open') {
            return NextResponse.json(
                { error: 'Poll is closed', code: 'POLL_CLOSED' },
                { status: 409 },
            );
        }

        const { data: stream } = await admin
            .from('streams')
            .select('id, status')
            .eq('id', poll.stream_id)
            .maybeSingle<{ id: string; status: string }>();
        if (!stream || stream.status !== 'live') {
            return NextResponse.json(
                { error: 'Stream is not live', code: 'STREAM_NOT_LIVE' },
                { status: 409 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const optionKey =
            typeof body?.option === 'string' ? body.option
            : typeof body?.optionKey === 'string' ? body.optionKey : '';
        const optionKeys = (poll.options ?? []).map((o) => o.key);
        if (!optionKeys.includes(optionKey)) {
            return NextResponse.json({ error: 'Invalid option' }, { status: 400 });
        }

        // Generous enough to change your mind a few times, tight enough that
        // scripted flip-flopping can't spam recounts. Fail-open like chat.
        const { allowed } = await checkRateLimit(`live-poll:${user.id}`, {
            windowSeconds: VOTE_WINDOW_SECONDS,
            max: VOTE_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json(
                { error: 'Voting too fast — slow down', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }

        const { error: voteErr } = await admin
            .from('stream_poll_votes')
            .upsert(
                { poll_id: poll.id, user_id: user.id, option_key: optionKey },
                { onConflict: 'poll_id,user_id' },
            );
        if (voteErr) {
            console.error('[Live/PollVote] upsert failed:', voteErr.message);
            return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 });
        }

        const tallies = await recountPollTallies(poll.id, optionKeys);
        // Unconditional write: even if the poll closed a beat ago, folding in
        // a vote that raced the close keeps the stored numbers honest.
        const { error: tallyErr } = await admin
            .from('stream_polls')
            .update({ tallies })
            .eq('id', poll.id);
        if (tallyErr) {
            // The vote itself landed; the next vote's recount repairs tallies.
            console.error('[Live/PollVote] tally write failed:', tallyErr.message);
        }

        return NextResponse.json({ success: true, myVote: optionKey, tallies });
    } catch (err: any) {
        console.error('[Live/PollVote] error:', err);
        return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 });
    }
}
