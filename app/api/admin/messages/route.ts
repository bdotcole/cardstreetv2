/**
 * The support account's chats, admin only. The team messages users from the
 * "Cardstreet TCG Marketplace" shop (SUPPORT_CHAT_USER_ID) and users answer it
 * like any other shop, so these are ordinary chat_threads rows; the Support
 * inbox (/admin/inbox) reads and answers them so nobody signs in as that account.
 *
 * GET              → { threads: AdminChatThread[], unreadCount }, newest first
 * GET ?with=<user> → { thread: AdminChatThread | null, user }: the conversation
 *                    with one person, if there is one yet
 * POST { toUserId, body } → { threadId, message }: writes to a user, starting
 *                    the conversation when there is none (the first message
 *                    creates it, so a user never sees an empty chat)
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { requireAdmin, requireAdminUser } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CHAT_MAX_CHARS } from '@/lib/chat'
import {
    SUPPORT_CHAT_USER_ID, THREAD_COLUMNS, UUID_RE, findThreadBetween, isMissingSchema, notifyChatRecipient, type ThreadRow,
} from '@/lib/chat.server'
import { findOrCreateSupportThread, loadChatUsers, sendAsSupport, toAdminThread } from '@/lib/supportChat.server'

export const dynamic = 'force-dynamic'

const LIST_LIMIT = 200

export async function GET(request: NextRequest) {
    const gate = await requireAdmin()
    if (gate) return gate

    const admin = createAdminClient()
    const support = SUPPORT_CHAT_USER_ID

    const withUser = request.nextUrl.searchParams.get('with')
    if (withUser !== null) {
        if (!UUID_RE.test(withUser)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        const users = await loadChatUsers(admin, [withUser])
        const user = users.get(withUser)
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
        const found = await findThreadBetween(admin, support, withUser)
        if (found.error && !isMissingSchema(found.error)) {
            console.error('[admin/inbox] thread lookup failed:', found.error)
            return NextResponse.json({ error: 'Failed to look up the conversation' }, { status: 500 })
        }
        return NextResponse.json(
            { thread: found.data ? toAdminThread(found.data, users) : null, user },
            { headers: { 'Cache-Control': 'no-store' } },
        )
    }

    const { data, error } = await admin
        .from('chat_threads')
        .select(THREAD_COLUMNS)
        .or(`buyer_id.eq.${support},seller_id.eq.${support}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(LIST_LIMIT)
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json({ threads: [], unreadCount: 0 })
        console.error('[admin/inbox] list failed:', error)
        return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
    }

    const rows = (data ?? []) as ThreadRow[]
    const users = await loadChatUsers(admin, rows.map((t) => (t.buyer_id === support ? t.seller_id : t.buyer_id)))
    const threads = rows.map((t) => toAdminThread(t, users))
    return NextResponse.json(
        { threads, unreadCount: threads.filter((t) => t.unread).length },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}

export async function POST(request: NextRequest) {
    const gate = await requireAdminUser()
    if (gate instanceof NextResponse) return gate

    const payload = await request.json().catch(() => ({}))
    const toUserId = typeof payload?.toUserId === 'string' ? payload.toUserId : ''
    const body = typeof payload?.body === 'string' ? payload.body.replace(/\r\n/g, '\n').trim() : ''
    if (!UUID_RE.test(toUserId)) return NextResponse.json({ error: 'Pick who to message' }, { status: 400 })
    if (toUserId === SUPPORT_CHAT_USER_ID) return NextResponse.json({ error: 'That is the support account itself' }, { status: 400 })
    if (!body) return NextResponse.json({ error: 'Message is empty' }, { status: 400 })
    if (body.length > CHAT_MAX_CHARS) {
        return NextResponse.json({ error: `Message is too long (${body.length} of ${CHAT_MAX_CHARS} characters)` }, { status: 400 })
    }

    const admin = createAdminClient()
    const users = await loadChatUsers(admin, [toUserId])
    if (!users.has(toUserId)) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const thread = await findOrCreateSupportThread(admin, toUserId)
    if (!thread) return NextResponse.json({ error: 'Failed to start the conversation' }, { status: 500 })

    const message = await sendAsSupport(admin, thread, body, gate.user.id)
    if (!message) return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    after(() => notifyChatRecipient(thread.id, SUPPORT_CHAT_USER_ID, body))

    return NextResponse.json({ threadId: thread.id, message })
}
