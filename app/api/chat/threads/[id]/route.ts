/**
 * One chat thread's messages. GET → { thread, messages }, oldest first.
 *   ?after=<iso>  only messages newer than that (the open conversation polls this)
 *
 * Reading marks the thread read for the caller. The open (no ?after) also
 * returns `ban`, the caller's chat suspension if one is in force, so the
 * composer can say so before they type. Participants only: anyone
 * else gets the same 404 as a thread that does not exist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPublicSellers } from '@/lib/publicProfiles';
import { THREAD_COLUMNS, UUID_RE, isMissingSchema, isParticipant, otherOf, roleOf, summarize, type ThreadRow } from '@/lib/chat.server';
import { maskOffPlatform } from '@/lib/chatPolicy';
import { CHAT_BAN_COLUMNS, chatBanState, type ChatBanRow } from '@/lib/chatModeration.server';
import type { ChatBanState } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// The newest messages on open; older history is not paged in v1.
const OPEN_LIMIT = 200;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const me = user.id;
    const admin = createAdminClient();

    const { data: thread, error } = await admin.from('chat_threads').select(THREAD_COLUMNS).eq('id', id).maybeSingle<ThreadRow>();
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json({ error: 'Chat is not available yet', code: 'NOT_AVAILABLE' }, { status: 503 });
        console.error('[chat] thread read failed:', error);
        return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 });
    }
    if (!thread || !isParticipant(thread, me)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const after = request.nextUrl.searchParams.get('after');
    const afterMs = after ? Date.parse(after) : NaN;
    let query = admin.from('chat_messages').select('id, sender_id, body, created_at').eq('thread_id', id);
    // The raw timestamp, not a re-serialized one: Date keeps milliseconds and
    // created_at has microseconds, so a rounded cursor would re-send the
    // newest message on every poll.
    query = Number.isFinite(afterMs) && after
        ? query.gt('created_at', after).order('created_at', { ascending: true }).limit(OPEN_LIMIT)
        : query.order('created_at', { ascending: false }).limit(OPEN_LIMIT);
    const { data: rows, error: msgErr } = await query;
    if (msgErr) {
        console.error('[chat] messages read failed:', msgErr);
        return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
    }
    const ordered = (rows ?? []) as { id: string; sender_id: string; body: string; created_at: string }[];
    if (!Number.isFinite(afterMs)) ordered.reverse();

    // Mark read up to the newest message. Only when there is something unread,
    // so a 5-second poll on a quiet thread does not write every time.
    const readCol = roleOf(thread, me) === 'buyer' ? 'buyer_last_read_at' : 'seller_last_read_at';
    const readAt = thread[readCol];
    if (thread.last_message_at && (!readAt || Date.parse(readAt) < Date.parse(thread.last_message_at))) {
        const now = new Date().toISOString();
        await admin.from('chat_threads').update({ [readCol]: now }).eq('id', id);
        thread[readCol] = now;
    }

    const profiles = await fetchPublicSellers(admin, [otherOf(thread, me)]);
    // Only on open, not on every 5-second poll. A missing column (migration
    // not run) reads as not suspended.
    let ban: ChatBanState | null = null;
    if (!Number.isFinite(afterMs)) {
        const { data: meRow } = await admin.from('profiles').select(CHAT_BAN_COLUMNS).eq('id', me).maybeSingle<ChatBanRow>();
        ban = chatBanState(meRow);
    }
    return NextResponse.json(
        {
            thread: summarize(thread, me, profiles),
            ban,
            // Masked: messages from before contact details were refused at send.
            messages: ordered.map((m) => ({ id: m.id, senderId: m.sender_id, body: maskOffPlatform(m.body), createdAt: m.created_at })),
        },
        { headers: { 'Cache-Control': 'no-store' } },
    );
}
