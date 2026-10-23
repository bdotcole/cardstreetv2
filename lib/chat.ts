// Buyer to seller chat (20261014_shop_chat.sql): shared types and the client
// fetchers. Every call goes through /api/chat/*; the tables have no RLS
// policies, so there is no direct client path to them. All fetchers fail
// soft: an error reads as "nothing to show", never a throw into the UI.

export const CHAT_MAX_CHARS = 2000;
/** How often an open conversation checks for new messages. */
export const CHAT_POLL_MS = 5000;

export interface ChatUser {
    id: string;
    username: string | null;
    display_name: string | null;
    avatar_url: string | null;
}

export interface ChatThreadSummary {
    id: string;
    other: ChatUser;
    lastMessageAt: string | null;
    lastMessagePreview: string | null;
    lastSenderIsMe: boolean;
    unread: boolean;
}

export interface ChatMessage {
    id: string;
    senderId: string;
    body: string;
    createdAt: string;
}

/** A chat suspension in force: until an instant, or for good. */
export interface ChatBanState {
    until: string | null;
    permanent: boolean;
}

// The strike ladder for messages the chat policy refuses (contact details,
// outside links, off-app deals, selling unlisted cards). Strikes are for
// life; the count decides what the refusal does (20261023_chat_strikes.sql).
export const CHAT_STRIKE_BAN_HOURS: Record<number, number> = { 2: 48, 3: 24 * 7 };
export const CHAT_STRIKE_PERMANENT_AT = 4;

/** What strike number `strike` brings: nothing but the warning, a timed ban, or a permanent one. */
export function chatBanForStrike(strike: number): { hours: number } | 'permanent' | null {
    if (strike >= CHAT_STRIKE_PERMANENT_AT) return 'permanent';
    const hours = CHAT_STRIKE_BAN_HOURS[strike];
    return hours ? { hours } : null;
}

/** Desktop: opens the chat dialog, optionally straight into a conversation. */
export const CHAT_OPEN_EVENT = 'cs:openChat';
export interface ChatOpenDetail {
    user?: ChatUser;
    threadId?: string;
}

/** Fired after sending or reading, so unread badges re-check. */
export const CHAT_CHANGED_EVENT = 'cs-chat-changed';
export function notifyChatChanged() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAT_CHANGED_EVENT));
}

export const chatUserName = (u: ChatUser | null | undefined) => u?.display_name || u?.username || 'Seller';
export const chatAvatar = (u: ChatUser) => u.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.id}`;

export async function fetchChatThreads(): Promise<{ available: boolean; threads: ChatThreadSummary[]; unreadCount: number } | null> {
    try {
        const res = await fetch('/api/chat/threads', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/** The conversation with one person, if there is one yet. */
export async function fetchChatThreadWith(userId: string): Promise<{ available: boolean; thread: ChatThreadSummary | null } | null> {
    try {
        const res = await fetch(`/api/chat/threads?with=${encodeURIComponent(userId)}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * A thread's messages; with `after`, only newer ones (polling). Opening marks
 * it read. The first load also says whether the caller's chat is suspended.
 */
export async function fetchChatMessages(threadId: string, after?: string): Promise<{ thread: ChatThreadSummary; messages: ChatMessage[]; ban?: ChatBanState | null } | null> {
    try {
        const qs = after ? `?after=${encodeURIComponent(after)}` : '';
        const res = await fetch(`/api/chat/threads/${encodeURIComponent(threadId)}${qs}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export type SendChatResult =
    | { ok: true; threadId: string; message: ChatMessage }
    /** Refused by the chat policy: a strike, and the ban it brought, if any. */
    | { ok: false; code: 'OFF_PLATFORM'; kind: 'contact' | 'link' | 'offplatform' | 'solicit'; strike: number; ban: ChatBanState | null }
    /** The caller's chat is suspended (not the whole account). */
    | { ok: false; code: 'CHAT_BANNED'; ban: ChatBanState }
    | { ok: false; code: 'UNAUTHORIZED' | 'RATE_LIMITED' | 'BANNED' | 'NOT_AVAILABLE' | 'FAILED' };

export async function sendChatMessage(args: { threadId?: string | null; toUserId?: string; body: string }): Promise<SendChatResult> {
    try {
        const res = await fetch('/api/chat/messages', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thread_id: args.threadId || undefined, to_user_id: args.toUserId, body: args.body }),
        });
        if (res.status === 401) return { ok: false, code: 'UNAUTHORIZED' };
        if (res.status === 429) return { ok: false, code: 'RATE_LIMITED' };
        if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            if (data?.code === 'CHAT_BANNED') {
                return { ok: false, code: 'CHAT_BANNED', ban: { until: data.until ?? null, permanent: !!data.permanent } };
            }
            return { ok: false, code: 'BANNED' };
        }
        if (res.status === 503) return { ok: false, code: 'NOT_AVAILABLE' };
        // Contact details, an outside link, an off-app deal or selling unlisted cards (lib/chatPolicy).
        if (res.status === 422) {
            const data = await res.json().catch(() => ({}));
            const ban = data?.ban ? { until: data.ban.until ?? null, permanent: !!data.ban.permanent } : null;
            return { ok: false, code: 'OFF_PLATFORM', kind: data?.kind ?? 'offplatform', strike: Number(data?.strike) || 0, ban };
        }
        if (!res.ok) return { ok: false, code: 'FAILED' };
        const data = await res.json();
        return { ok: true, threadId: data.thread_id, message: data.message };
    } catch {
        return { ok: false, code: 'FAILED' };
    }
}
