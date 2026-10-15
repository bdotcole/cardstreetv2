/**
 * Send a chat message. POST { thread_id } or { to_user_id }, plus { body }.
 *   → { thread_id, message }
 *
 * With to_user_id the conversation with that person is found or started (one
 * per pair, whoever wrote first). Banned accounts cannot send; sending is
 * rate-limited per user, and starting new conversations more tightly, so the
 * inbox cannot be used to spam every shop. The recipient is notified after
 * the response is sent (push every message, email throttled).
 *
 * A message carrying contact details, an outside link or an off-app deal is
 * refused with 422 OFF_PLATFORM (lib/chatPolicy) and never stored. Each
 * refusal is a strike; the third within a week pages the team in Sentry so a
 * repeat offender can be reviewed and banned (banned accounts cannot send).
 */

import { NextRequest, NextResponse, after } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { CHAT_MAX_CHARS } from '@/lib/chat';
import { findOffPlatform } from '@/lib/chatPolicy';
import { THREAD_COLUMNS, UUID_RE, findThreadBetween, isMissingSchema, isParticipant, notifyChatRecipient, roleOf, type ThreadRow } from '@/lib/chat.server';

export const dynamic = 'force-dynamic';

const PREVIEW_CHARS = 140;

export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const me = user.id;

    const payload = await request.json().catch(() => ({}));
    const body = typeof payload?.body === 'string' ? payload.body.replace(/\r\n/g, '\n').trim() : '';
    if (!body) return NextResponse.json({ error: 'Message is empty' }, { status: 400 });
    if (body.length > CHAT_MAX_CHARS) return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
    const threadId = typeof payload?.thread_id === 'string' ? payload.thread_id : '';
    const toUserId = typeof payload?.to_user_id === 'string' ? payload.to_user_id : '';
    if (!UUID_RE.test(threadId) && !UUID_RE.test(toUserId)) {
        return NextResponse.json({ error: 'thread_id or to_user_id is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: senderRow } = await admin.from('profiles').select('banned_at').eq('id', me).maybeSingle<{ banned_at: string | null }>();
    if (senderRow?.banned_at) {
        return NextResponse.json({ error: 'This account cannot send messages', code: 'BANNED' }, { status: 403 });
    }

    const offPlatform = findOffPlatform(body);
    if (offPlatform) {
        const strikes = await checkRateLimit(`chat_offplatform:${me}`, { windowSeconds: 7 * 86400, max: 2 });
        // Kind and user only: the refused text is someone's phone number or account.
        console.warn(`[chat] refused ${offPlatform} message from ${me} (strike ${strikes.count} this week)`);
        if (!strikes.allowed) {
            Sentry.captureMessage('Chat user keeps trying to take deals off Cardstreet', {
                level: 'warning',
                tags: { area: 'chat', kind: offPlatform },
                fingerprint: ['chat-offplatform', me],
                extra: { userId: me, strikesThisWeek: strikes.count },
            });
        }
        return NextResponse.json(
            { error: 'Contact details, links and deals outside Cardstreet are not allowed in chat', code: 'OFF_PLATFORM', kind: offPlatform },
            { status: 422 },
        );
    }

    const sendLimit = await checkRateLimit(`chat_send:${me}`, { windowSeconds: 600, max: 40 });
    if (!sendLimit.allowed) {
        return NextResponse.json({ error: 'Too many messages, try again shortly', code: 'RATE_LIMITED' }, { status: 429 });
    }

    let thread: ThreadRow | null = null;
    if (UUID_RE.test(threadId)) {
        const { data, error } = await admin.from('chat_threads').select(THREAD_COLUMNS).eq('id', threadId).maybeSingle<ThreadRow>();
        if (error) return failure(error, 'thread read');
        if (!data || !isParticipant(data, me)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        thread = data;
    } else {
        if (toUserId === me) return NextResponse.json({ error: 'You cannot message yourself' }, { status: 400 });
        const { data: recipient } = await admin.from('public_profiles').select('id').eq('id', toUserId).maybeSingle();
        if (!recipient) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const found = await findThreadBetween(admin, me, toUserId);
        if (found.error) return failure(found.error, 'thread lookup');
        thread = found.data;
        if (!thread) {
            const newLimit = await checkRateLimit(`chat_new:${me}`, { windowSeconds: 86400, max: 20 });
            if (!newLimit.allowed) {
                return NextResponse.json({ error: 'Too many new conversations today', code: 'RATE_LIMITED' }, { status: 429 });
            }
            const created = await admin
                .from('chat_threads')
                .insert({ buyer_id: me, seller_id: toUserId })
                .select(THREAD_COLUMNS)
                .single<ThreadRow>();
            if (created.error?.code === '23505') {
                // The other person started the same conversation a moment ago.
                const again = await findThreadBetween(admin, me, toUserId);
                thread = again.data;
            } else if (created.error) {
                return failure(created.error, 'thread create');
            } else {
                thread = created.data;
            }
            if (!thread) return NextResponse.json({ error: 'Failed to start chat' }, { status: 500 });
        }
    }

    const { data: message, error: msgErr } = await admin
        .from('chat_messages')
        .insert({ thread_id: thread.id, sender_id: me, body })
        .select('id, sender_id, body, created_at')
        .single<{ id: string; sender_id: string; body: string; created_at: string }>();
    if (msgErr || !message) return failure(msgErr, 'message insert');

    const flat = body.replace(/\s+/g, ' ');
    await admin
        .from('chat_threads')
        .update({
            last_message_at: message.created_at,
            last_message_preview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 3)}...` : flat,
            last_sender_id: me,
            // Your own message is read by definition.
            [roleOf(thread, me) === 'buyer' ? 'buyer_last_read_at' : 'seller_last_read_at']: message.created_at,
        })
        .eq('id', thread.id);

    const sentThreadId = thread.id;
    after(() => notifyChatRecipient(sentThreadId, me, body));

    return NextResponse.json({
        thread_id: thread.id,
        message: { id: message.id, senderId: message.sender_id, body: message.body, createdAt: message.created_at },
    });
}

function failure(error: { code?: string; message?: string } | null, what: string) {
    if (isMissingSchema(error)) {
        return NextResponse.json({ error: 'Chat is not available yet', code: 'NOT_AVAILABLE' }, { status: 503 });
    }
    console.error(`[chat] ${what} failed:`, error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
}
