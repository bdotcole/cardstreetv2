/**
 * POST /api/live/streams/[id]/chat — send a message (delivery to viewers is
 * Supabase Realtime on stream_chat_messages; there is deliberately NO client
 * INSERT policy, so this route is the only write path and owns the rate
 * limit + ban + freeze checks).
 * GET — last 100 visible messages, for the join-time backfill before the
 * Realtime subscription takes over.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { CHAT_BODY_MAX, requireViewerOrSeller, resolvePublicViewer } from '@/lib/liveBreaks';
import { awardEvent, awardFirst } from '@/lib/rewards';
import { EARN } from '@/lib/rewardTiers';
import { extractEmoteKeys, emoteMinLevel } from '@/components/rewards/emotes';

const CHAT_WINDOW_SECONDS = 30;
const CHAT_MAX_PER_WINDOW = 10;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireViewerOrSeller(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream, isSeller } = ctx;

        const body = await req.json().catch(() => ({}));
        const text = typeof body?.body === 'string' ? body.body.trim() : '';
        if (text.length === 0 || text.length > CHAT_BODY_MAX) {
            return NextResponse.json(
                { error: `Message must be 1-${CHAT_BODY_MAX} characters` },
                { status: 400 },
            );
        }

        if (stream.status !== 'scheduled' && stream.status !== 'live') {
            return NextResponse.json({ error: 'Chat is closed' }, { status: 409 });
        }

        // Fail-open limiter (same posture as /api/scan): a limiter outage must
        // not silence the room.
        const { allowed } = await checkRateLimit(`live-chat:${user.id}`, {
            windowSeconds: CHAT_WINDOW_SECONDS,
            max: CHAT_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json(
                { error: 'Sending too fast — slow down', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }

        const admin = createAdminClient();

        const { data: ban } = await admin
            .from('stream_chat_bans')
            .select('user_id')
            .eq('stream_id', stream.id)
            .eq('user_id', user.id)
            .maybeSingle();
        if (ban) {
            return NextResponse.json(
                { error: 'You are banned from this chat', code: 'BANNED' },
                { status: 403 },
            );
        }

        // Freeze silences viewers; the broadcaster keeps talking (that's how
        // they announce WHY chat is frozen).
        if (stream.chat_disabled && !isSeller) {
            return NextResponse.json(
                { error: 'Chat is disabled', code: 'CHAT_DISABLED' },
                { status: 403 },
            );
        }

        // Collector Pass emotes are level-gated: a body containing known
        // `:emote:` tokens is checked against the sender's level (unknown
        // tokens are plain text and skip this entirely). Pre-migration the
        // level lookup fails -> level 1 -> emotes read as locked, which is
        // the honest state; sellers bypass the gate in their own room.
        const emoteKeys = extractEmoteKeys(text);
        if (emoteKeys.length > 0 && !isSeller) {
            let level = 1;
            try {
                const { data: rw } = await admin
                    .from('rewards')
                    .select('level')
                    .eq('user_id', user.id)
                    .maybeSingle();
                if (typeof rw?.level === 'number') level = rw.level;
            } catch { /* fail toward locked */ }
            const locked = emoteKeys.find((k) => emoteMinLevel(k) > level);
            if (locked) {
                return NextResponse.json(
                    { error: 'Emote locked', code: 'EMOTE_LOCKED', emote: locked, minLevel: emoteMinLevel(locked) },
                    { status: 403 },
                );
            }
        }

        const { data: message, error: insertErr } = await admin
            .from('stream_chat_messages')
            .insert({ stream_id: stream.id, sender_id: user.id, body: text })
            .select('id, stream_id, sender_id, body, is_system, created_at')
            .single();

        if (insertErr || !message) {
            console.error('[Live/Chat] insert failed:', insertErr?.message);
            return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
        }

        // Collector Pass: XP for the FIRST message in each stream (ref_id =
        // stream id) with a daily stream cap — the 10/30s rate limit above
        // bounds raw spam, this bounds reward farming. XP only, never coins.
        await awardEvent(admin, {
            userId: user.id,
            rule: EARN.CHAT_STREAM.rule,
            ref: stream.id,
            xp: EARN.CHAT_STREAM.xp,
            coins: 0,
            dailyCap: EARN.CHAT_STREAM.dailyCap,
        });
        await awardFirst(admin, user.id, 'first_chat');

        return NextResponse.json({ success: true, message });
    } catch (err: any) {
        console.error('[Live/Chat] POST error:', err);
        return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        // Reading the room is public; SENDING (POST above) still needs an
        // account, so a guest sees the conversation but can't join it.
        const ctx = await resolvePublicViewer(id);
        if (ctx instanceof NextResponse) return ctx;

        const admin = createAdminClient();
        // Two FKs point at profiles (sender_id, deleted_by) — the embed must
        // name the constraint or PostgREST rejects it as ambiguous.
        const { data: messages, error } = await admin
            .from('stream_chat_messages')
            .select(
                'id, stream_id, sender_id, body, is_system, created_at, ' +
                'sender:profiles!stream_chat_messages_sender_id_fkey(display_name, avatar_url)',
            )
            .eq('stream_id', id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            console.error('[Live/Chat] fetch failed:', error.message);
            return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 });
        }

        // The multi-line embed select defeats supabase-js's row inference, so
        // the rows are treated as plain records here.
        const ordered = ((messages ?? []) as unknown as Record<string, unknown>[]).reverse();

        // Attach each sender's Collector Pass level (rank chips in both chat
        // renderers). Fail-soft: pre-migration the view lacks the column and
        // this whole block quietly no-ops.
        try {
            const senderIds = [...new Set(
                ordered
                    .filter((m) => m.is_system !== true && typeof m.sender_id === 'string')
                    .map((m) => m.sender_id as string),
            )];
            if (senderIds.length > 0) {
                const { data: levels } = await admin
                    .from('public_profiles')
                    .select('id, reward_level')
                    .in('id', senderIds);
                const levelById = new Map(
                    ((levels ?? []) as { id: string; reward_level: number | null }[])
                        .map((r) => [r.id, r.reward_level]),
                );
                for (const m of ordered) {
                    m.sender_level = levelById.get(m.sender_id as string) ?? null;
                }
            }
        } catch { /* chips just don't render */ }

        // Chronological for rendering; the query was newest-first to get the
        // LAST 100.
        return NextResponse.json({ messages: ordered });
    } catch (err: any) {
        console.error('[Live/Chat] GET error:', err);
        return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 });
    }
}
