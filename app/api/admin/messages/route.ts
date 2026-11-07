/**
 * GET /api/admin/messages: admin only. The support account's chat inbox,
 * newest conversation first.
 *   → { threads: AdminChatThread[], unreadCount }
 *
 * The team messages users from the "Cardstreet TCG Marketplace" shop
 * (SUPPORT_CHAT_USER_ID), and users answer it like any other shop, so its
 * conversations are ordinary chat_threads rows. This reads them for the admin
 * console, so nobody has to sign in as that account to see a reply.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SUPPORT_CHAT_USER_ID, THREAD_COLUMNS, isMissingSchema, type ThreadRow } from '@/lib/chat.server'
import { loadChatUsers, toAdminThread } from '@/lib/supportChat.server'

export const dynamic = 'force-dynamic'

const LIST_LIMIT = 200

export async function GET() {
    const gate = await requireAdmin()
    if (gate) return gate

    const admin = createAdminClient()
    const support = SUPPORT_CHAT_USER_ID
    const { data, error } = await admin
        .from('chat_threads')
        .select(THREAD_COLUMNS)
        .or(`buyer_id.eq.${support},seller_id.eq.${support}`)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(LIST_LIMIT)
    if (error) {
        if (isMissingSchema(error)) return NextResponse.json({ threads: [], unreadCount: 0 })
        console.error('[admin/messages] list failed:', error)
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
