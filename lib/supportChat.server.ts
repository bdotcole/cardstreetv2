import 'server-only';
import type { createAdminClient } from '@/lib/supabase/admin';
import { SUPPORT_CHAT_USER_ID, isUnread, otherOf, type ThreadRow } from '@/lib/chat.server';
import type { AdminChatThread, ChatUser } from '@/lib/chat';

// The admin console's view of the support account's chat (/admin/messages).
// Admins see message text as sent, unmasked: they are the ones who review it.

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Names for the people the support account talks to. Read from profiles, not
 * the public_profiles view, so a banned or hidden account still shows who it is.
 */
export async function loadChatUsers(admin: Admin, ids: string[]): Promise<Map<string, ChatUser>> {
    const map = new Map<string, ChatUser>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return map;
    const { data, error } = await admin
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', unique);
    if (error) console.error('[admin/messages] profile lookup failed:', error.message);
    for (const p of (data ?? []) as ChatUser[]) map.set(p.id, p);
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
