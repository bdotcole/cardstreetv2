import 'server-only';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
    SUPPORT_CHAT_USER_ID, THREAD_COLUMNS, findThreadBetween, isUnread, otherOf, roleOf, type ThreadRow,
} from '@/lib/chat.server';
import type { AdminChatMessage, AdminChatThread, ChatUser } from '@/lib/chat';

// The admin console's view of the support account's chat (the DMs in the
// Support inbox, /admin/inbox). Admins see message text as sent, unmasked:
// they are the ones who review it.

type Admin = ReturnType<typeof createAdminClient>;

/** PostgREST puts .in() lists in the URL; keep each request well under its limit. */
const ID_CHUNK = 100;

/**
 * Names for the people the support account talks to. Read from profiles, not
 * the public_profiles view, so a banned or hidden account still shows who it is.
 */
export async function loadChatUsers(admin: Admin, ids: string[]): Promise<Map<string, ChatUser>> {
    const map = new Map<string, ChatUser>();
    const unique = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
        const { data, error } = await admin
            .from('profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', unique.slice(i, i + ID_CHUNK));
        if (error) console.error('[admin/inbox] profile lookup failed:', error.message);
        for (const p of (data ?? []) as ChatUser[]) map.set(p.id, p);
    }
    return map;
}

export function toAdminThread(t: ThreadRow, users: Map<string, ChatUser>): AdminChatThread {
    const otherId = otherOf(t, SUPPORT_CHAT_USER_ID);
    return {
        id: t.id,
        other: users.get(otherId) ?? { id: otherId, username: null, display_name: null, avatar_url: null },
        lastMessageAt: t.last_message_at,
        lastMessagePreview: t.last_message_preview,
        lastSenderIsSupport: t.last_sender_id === SUPPORT_CHAT_USER_ID,
        unread: isUnread(t, SUPPORT_CHAT_USER_ID),
    };
}

export type SupportMessageRow = { id: string; sender_id: string; body: string; created_at: string };

export const toAdminMessage = (m: SupportMessageRow): AdminChatMessage => ({
    id: m.id,
    senderId: m.sender_id,
    body: m.body,
    createdAt: m.created_at,
    fromSupport: m.sender_id === SUPPORT_CHAT_USER_ID,
});

/** The support account's conversation with a user, started if there is none yet. */
export async function findOrCreateSupportThread(admin: Admin, userId: string): Promise<ThreadRow | null> {
    const found = await findThreadBetween(admin, SUPPORT_CHAT_USER_ID, userId);
    if (found.error) {
        console.error('[admin/inbox] thread lookup failed:', found.error);
        return null;
    }
    if (found.data) return found.data;
    const created = await admin
        .from('chat_threads')
        .insert({ buyer_id: SUPPORT_CHAT_USER_ID, seller_id: userId })
        .select(THREAD_COLUMNS)
        .single<ThreadRow>();
    if (created.error?.code === '23505') {
        // The user wrote to the support shop a moment ago.
        const again = await findThreadBetween(admin, SUPPORT_CHAT_USER_ID, userId);
        return again.data ?? null;
    }
    if (created.error) {
        console.error('[admin/inbox] thread create failed:', created.error);
        return null;
    }
    return created.data;
}

const PREVIEW_CHARS = 140;

/**
 * Sends `body` as the support account and moves the thread's preview and read
 * mark. The caller sends the recipient's push/email (notifyChatRecipient) in after().
 */
export async function sendAsSupport(admin: Admin, thread: ThreadRow, body: string, adminUserId: string): Promise<AdminChatMessage | null> {
    const { data: message, error } = await admin
        .from('chat_messages')
        .insert({ thread_id: thread.id, sender_id: SUPPORT_CHAT_USER_ID, body })
        .select('id, sender_id, body, created_at')
        .single<SupportMessageRow>();
    if (error || !message) {
        console.error('[admin/inbox] send failed:', error);
        return null;
    }

    const flat = body.replace(/\s+/g, ' ');
    await admin
        .from('chat_threads')
        .update({
            last_message_at: message.created_at,
            last_message_preview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 3)}...` : flat,
            last_sender_id: SUPPORT_CHAT_USER_ID,
            [roleOf(thread, SUPPORT_CHAT_USER_ID) === 'buyer' ? 'buyer_last_read_at' : 'seller_last_read_at']: message.created_at,
        })
        .eq('id', thread.id);

    // The message row only records the shop; the log says which admin wrote it.
    console.info(`[admin/inbox] ${adminUserId} replied in thread ${thread.id} (message ${message.id})`);
    return toAdminMessage(message);
}
