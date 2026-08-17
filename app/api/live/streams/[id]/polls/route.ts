/**
 * POST /api/live/streams/[id]/polls — broadcaster opens a poll (2-4 options).
 * One open poll per stream (409 otherwise; the partial unique index backs the
 * check against races). Announced in system chat.
 *
 * GET — the stream's latest poll (any status) + the caller's own vote, for
 * the join-time backfill before the Realtime subscription takes over. The
 * viewer shows only an open poll; the console also renders the last closed
 * result.
 *
 * Both fail soft until 20260811_stream_polls.sql runs.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    POLL_COLS,
    POLL_OPTIONS_MAX,
    POLL_OPTIONS_MIN,
    POLL_OPTION_KEY_MAX,
    POLL_OPTION_LABEL_MAX,
    POLL_QUESTION_MAX,
    isMissingTableError,
    postSystemChat,
    requireBroadcaster,
    requireViewerOrSeller,
    resolvePublicViewer,
    type PollOptionRow,
    type PollRow,
} from '@/lib/liveBreaks';

/** Body options: [{key?, label}] or plain strings; keys default to a, b, c, d. */
function parseOptions(raw: unknown): PollOptionRow[] | null {
    if (!Array.isArray(raw) || raw.length < POLL_OPTIONS_MIN || raw.length > POLL_OPTIONS_MAX) {
        return null;
    }
    const fallbackKeys = ['a', 'b', 'c', 'd'];
    const options: PollOptionRow[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length; i++) {
        const entry = raw[i];
        let key: unknown;
        let label: unknown;
        if (typeof entry === 'string') {
            key = fallbackKeys[i];
            label = entry;
        } else if (entry && typeof entry === 'object') {
            key = (entry as Record<string, unknown>).key ?? fallbackKeys[i];
            label = (entry as Record<string, unknown>).label;
        }
        if (typeof key !== 'string' || typeof label !== 'string') return null;
        const trimmedLabel = label.trim();
        if (
            key.length === 0 ||
            key.length > POLL_OPTION_KEY_MAX ||
            trimmedLabel.length === 0 ||
            trimmedLabel.length > POLL_OPTION_LABEL_MAX ||
            seen.has(key)
        ) {
            return null;
        }
        seen.add(key);
        options.push({ key, label: trimmedLabel });
    }
    return options;
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        if (stream.status !== 'scheduled' && stream.status !== 'live') {
            return NextResponse.json(
                { error: `Cannot open a poll on a ${stream.status} stream` },
                { status: 409 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const question = typeof body?.question === 'string' ? body.question.trim() : '';
        if (question.length === 0 || question.length > POLL_QUESTION_MAX) {
            return NextResponse.json(
                { error: `Question must be 1-${POLL_QUESTION_MAX} characters` },
                { status: 400 },
            );
        }
        const options = parseOptions(body?.options);
        if (!options) {
            return NextResponse.json(
                {
                    error: `options must be ${POLL_OPTIONS_MIN}-${POLL_OPTIONS_MAX} entries with non-empty labels (max ${POLL_OPTION_LABEL_MAX} chars) and unique keys`,
                },
                { status: 400 },
            );
        }

        const admin = createAdminClient();

        const { data: openPoll, error: openErr } = await admin
            .from('stream_polls')
            .select('id')
            .eq('stream_id', stream.id)
            .eq('status', 'open')
            .maybeSingle();
        if (openErr && isMissingTableError(openErr)) {
            return NextResponse.json(
                { error: 'Polls are not available yet' },
                { status: 503 },
            );
        }
        if (openPoll) {
            return NextResponse.json(
                { error: 'A poll is already open', code: 'POLL_ALREADY_OPEN' },
                { status: 409 },
            );
        }

        const { data: poll, error: insertErr } = await admin
            .from('stream_polls')
            .insert({
                stream_id: stream.id,
                seller_id: user.id,
                question,
                options,
            })
            .select(POLL_COLS)
            .single<PollRow>();

        if (insertErr || !poll) {
            if (isMissingTableError(insertErr)) {
                return NextResponse.json(
                    { error: 'Polls are not available yet' },
                    { status: 503 },
                );
            }
            // The partial unique index catches a create race the pre-check missed.
            if (insertErr?.code === '23505') {
                return NextResponse.json(
                    { error: 'A poll is already open', code: 'POLL_ALREADY_OPEN' },
                    { status: 409 },
                );
            }
            console.error('[Live/Polls] insert failed:', insertErr?.message);
            return NextResponse.json({ error: 'Failed to create poll' }, { status: 500 });
        }

        await postSystemChat(stream.id, user.id, `Poll: ${question}`);

        return NextResponse.json({ success: true, poll });
    } catch (err: any) {
        console.error('[Live/Polls] POST error:', err);
        return NextResponse.json({ error: 'Failed to create poll' }, { status: 500 });
    }
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        // Public read: a guest sees the poll and its live tallies, but has no
        // ballot of their own (voting still requires an account).
        const ctx = await resolvePublicViewer(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user } = ctx;

        const admin = createAdminClient();
        const { data: poll, error } = await admin
            .from('stream_polls')
            .select(POLL_COLS)
            .eq('stream_id', id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle<PollRow>();

        if (error) {
            if (isMissingTableError(error)) {
                return NextResponse.json({ poll: null, myVote: null });
            }
            console.error('[Live/Polls] fetch failed:', error.message);
            return NextResponse.json({ error: 'Failed to load poll' }, { status: 500 });
        }

        // A guest has no ballot — they see the question and the live tallies
        // with nothing highlighted, and voting prompts sign-in.
        let myVote: string | null = null;
        if (poll && user) {
            const { data: vote } = await admin
                .from('stream_poll_votes')
                .select('option_key')
                .eq('poll_id', poll.id)
                .eq('user_id', user.id)
                .maybeSingle<{ option_key: string }>();
            myVote = vote?.option_key ?? null;
        }

        return NextResponse.json({ poll: poll ?? null, myVote });
    } catch (err: any) {
        console.error('[Live/Polls] GET error:', err);
        return NextResponse.json({ error: 'Failed to load poll' }, { status: 500 });
    }
}
