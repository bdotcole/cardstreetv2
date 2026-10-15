import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPublicSellers, type PublicSeller } from '@/lib/publicProfiles';
import { sendChatMessageNotification } from '@/lib/courier';
import type { ChatThreadSummary, ChatUser } from '@/lib/chat';
import { maskOffPlatform } from '@/lib/chatPolicy';

// Server side of buyer to seller chat: thread lookups, the read/unread rule,
// and the recipient notification. Used only by /api/chat/*, always with the
// service-role client (the tables have no RLS policies).

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703']);
export function isMissingSchema(error: { code?: string } | null | undefined): boolean {
    return !!error?.code && MISSING_SCHEMA_CODES.has(error.code);
}

export const THREAD_COLUMNS =
    'id, buyer_id, seller_id, created_at, last_message_at, last_message_preview, last_sender_id, buyer_last_read_at, seller_last_read_at, buyer_emailed_at, seller_emailed_at';

export interface ThreadRow {
    id: string;
    buyer_id: string;
    seller_id: string;
    created_at: string;
    last_message_at: string | null;
    last_message_preview: string | null;
    last_sender_id: string | null;
    buyer_last_read_at: string | null;
    seller_last_read_at: string | null;
    buyer_emailed_at: string | null;
    seller_emailed_at: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

/** buyer_id is whoever wrote first; the label only picks the read/emailed columns. */
export const roleOf = (t: ThreadRow, me: string): 'buyer' | 'seller' => (t.buyer_id === me ? 'buyer' : 'seller');
export const otherOf = (t: ThreadRow, me: string) => (t.buyer_id === me ? t.seller_id : t.buyer_id);
export const isParticipant = (t: ThreadRow, me: string) => t.buyer_id === me || t.seller_id === me;

export function isUnread(t: ThreadRow, me: string): boolean {
    if (!t.last_message_at || t.last_sender_id === me) return false;
    const readAt = roleOf(t, me) === 'buyer' ? t.buyer_last_read_at : t.seller_last_read_at;
    // Compared as instants: PostgREST trims trailing zeros off the fraction,
    // so two timestamps do not always compare correctly as strings.
    return !readAt || Date.parse(readAt) < Date.parse(t.last_message_at);
}

export function toChatUser(id: string, p: PublicSeller | undefined): ChatUser {
    return {
        id,
        username: p?.username ?? null,
        display_name: p?.display_name ?? null,
        avatar_url: p?.avatar_url ?? null,
    };
}

export function summarize(t: ThreadRow, me: string, profiles: Map<string, PublicSeller>): ChatThreadSummary {
    const otherId = otherOf(t, me);
    return {
        id: t.id,
        other: toChatUser(otherId, profiles.get(otherId)),
        lastMessageAt: t.last_message_at,
        lastMessagePreview: t.last_message_preview ? maskOffPlatform(t.last_message_preview) : null,
        lastSenderIsMe: t.last_sender_id === me,
        unread: isUnread(t, me),
    };
}

/** The one thread between two people, whichever of them wrote first. */
export async function findThreadBetween(admin: Admin, a: string, b: string) {
    return admin
        .from('chat_threads')
        .select(THREAD_COLUMNS)
        .or(`and(buyer_id.eq.${a},seller_id.eq.${b}),and(buyer_id.eq.${b},seller_id.eq.${a})`)
        .maybeSingle<ThreadRow>();
}

// One email per conversation until the recipient opens it, then at most one
// per half hour. Pushes go out for every message: they are the chat.
const EMAIL_GAP_MS = 30 * 60 * 1000;

/**
 * Tell the other side of the thread about a new message. Runs in after(), so
 * it must never throw; a failure only costs the notification.
 */
export async function notifyChatRecipient(threadId: string, senderId: string, body: string): Promise<void> {
    try {
        const admin = createAdminClient();
        const { data: thread } = await admin.from('chat_threads').select(THREAD_COLUMNS).eq('id', threadId).maybeSingle<ThreadRow>();
        if (!thread) return;
        const recipientId = otherOf(thread, senderId);
        const recipientRole = roleOf(thread, recipientId);
        const emailedAt = recipientRole === 'buyer' ? thread.buyer_emailed_at : thread.seller_emailed_at;
        const readAt = recipientRole === 'buyer' ? thread.buyer_last_read_at : thread.seller_last_read_at;
        const allowEmail = !emailedAt
            || (!!readAt && Date.parse(readAt) > Date.parse(emailedAt) && Date.now() - Date.parse(emailedAt) > EMAIL_GAP_MS);

        const sender = (await fetchPublicSellers(admin, [senderId])).get(senderId);
        const senderName = sender?.display_name || sender?.username || 'Cardstreet';
        const result = await sendChatMessageNotification(recipientId, { threadId, senderName, body, allowEmail });
        if (result.emailed) {
            await admin
                .from('chat_threads')
                .update(recipientRole === 'buyer' ? { buyer_emailed_at: new Date().toISOString() } : { seller_emailed_at: new Date().toISOString() })
                .eq('id', threadId);
        }
    } catch (e) {
        console.error(`[chat] notification for thread ${threadId} failed:`, e);
    }
}
