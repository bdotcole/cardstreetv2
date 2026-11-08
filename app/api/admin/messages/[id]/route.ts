/**
 * One support-account conversation, admin only.
 *
 * GET  → { thread, messages }, oldest first. ?after=<iso> returns only newer
 *        messages (the open conversation polls this). Reading marks it read for
 *        the support account, which is also what re-arms the chat email to
 *        the support inbox (lib/chat.server notifyChatRecipient).
 * POST { body } → { message }: sends as the support account. The user gets the
 *        usual chat push and email, from "Cardstreet TCG Marketplace".
 *
 * Admin replies skip the off-platform filter and its strikes (lib/chatPolicy):
 * the filter keeps users from taking deals outside Cardstreet, and the team
 * has to be able to write "bank account" or info@cardstreet.app.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { requireAdmin, requireAdminUser } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { CHAT_MAX_CHARS } from '@/lib/chat'
import {
    SUPPORT_CHAT_USER_ID, THREAD_COLUMNS, UUID_RE, isMissingSchema, isParticipant, notifyChatRecipient, otherOf, roleOf, type ThreadRow,
} from '@/lib/chat.server'
import { loadChatUsers, sendAsSupport, toAdminMessage, toAdminThread, type SupportMessageRow } from '@/lib/supportChat.server'

export const dynamic = 'force-dynamic'

const OPEN_LIMIT = 300

type Admin = ReturnType<typeof createAdminClient>

/** The thread, only when the support account is in it; anything else reads as 404. */
async function loadThread(admin: Admin, id: string): Promise<ThreadRow | NextResponse> {
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { data, error } = await admin.from('chat_threads').select(THREAD_COLUMNS).eq('id', id).maybeSingle<ThreadRow>()
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json({ error: 'Chat is not available yet' }, { status: 503 })
        console.error('[admin/inbox] thread read failed:', error)
        return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!data || !isParticipant(data, SUPPORT_CHAT_USER_ID)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return data
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { id } = await params
    const admin = createAdminClient()
    const thread = await loadThread(admin, id)
    if (thread instanceof NextResponse) return thread

    const afterParam = request.nextUrl.searchParams.get('after')
    const polling = !!afterParam && Number.isFinite(Date.parse(afterParam))
    let query = admin.from('chat_messages').select('id, sender_id, body, created_at').eq('thread_id', id)
    // The raw timestamp as the cursor: created_at has microseconds, a
    // re-serialized Date would re-send the newest message on every poll.
    query = polling
        ? query.gt('created_at', afterParam!).order('created_at', { ascending: true }).limit(OPEN_LIMIT)
        : query.order('created_at', { ascending: false }).limit(OPEN_LIMIT)
    const { data: rows, error } = await query
    if (error) {
        console.error('[admin/inbox] messages read failed:', error)
        return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
    }
    const ordered = (rows ?? []) as SupportMessageRow[]
    if (!polling) ordered.reverse()

    // Read up to the newest message, written only when something is unread so
    // a quiet poll does not write.
    const readCol = roleOf(thread, SUPPORT_CHAT_USER_ID) === 'buyer' ? 'buyer_last_read_at' : 'seller_last_read_at'
    const readAt = thread[readCol]
    if (thread.last_message_at && (!readAt || Date.parse(readAt) < Date.parse(thread.last_message_at))) {
        const now = new Date().toISOString()
        await admin.from('chat_threads').update({ [readCol]: now }).eq('id', id)
        thread[readCol] = now
    }

    const users = await loadChatUsers(admin, [otherOf(thread, SUPPORT_CHAT_USER_ID)])
    return NextResponse.json(
        { thread: toAdminThread(thread, users), messages: ordered.map(toAdminMessage) },
        { headers: { 'Cache-Control': 'no-store' } },
    )
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdminUser()
    if (gate instanceof NextResponse) return gate

    const payload = await request.json().catch(() => ({}))
    const body = typeof payload?.body === 'string' ? payload.body.replace(/\r\n/g, '\n').trim() : ''
    if (!body) return NextResponse.json({ error: 'Message is empty' }, { status: 400 })
    if (body.length > CHAT_MAX_CHARS) {
        return NextResponse.json({ error: `Message is too long (${body.length} of ${CHAT_MAX_CHARS} characters)` }, { status: 400 })
    }

    const { id } = await params
    const admin = createAdminClient()
    const thread = await loadThread(admin, id)
    if (thread instanceof NextResponse) return thread

    const message = await sendAsSupport(admin, thread, body, gate.user.id)
    if (!message) return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    after(() => notifyChatRecipient(id, SUPPORT_CHAT_USER_ID, body))

    return NextResponse.json({ message })
}
