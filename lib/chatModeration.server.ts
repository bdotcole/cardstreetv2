import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { createAdminClient } from '@/lib/supabase/admin';
import { chatBanForStrike, type ChatBanState } from '@/lib/chat';
import type { OffPlatformKind } from '@/lib/chatPolicy';
import { isMissingSchema } from '@/lib/chat.server';

// The strike ladder behind the chat policy (20261023_chat_strikes.sql). A
// refused message is a strike for life; the count decides the ban:
// warning, 48 hours, 7 days, for good (lib/chat.ts:chatBanForStrike).
// A ban only ever lengthens: a 7-day ban is not cut short by a later
// strike's 48-hour one, and a permanent ban stays.

type Admin = ReturnType<typeof createAdminClient>;

export const CHAT_BAN_COLUMNS = 'banned_at, chat_banned_until';

export interface ChatBanRow {
    banned_at?: string | null;
    chat_banned_until?: string | null;
}

/** The chat ban in force for this profile row, or null when they may chat. */
export function chatBanState(row: ChatBanRow | null | undefined): ChatBanState | null {
    const until = row?.chat_banned_until;
    if (!until) return null;
    if (until === 'infinity') return { until: null, permanent: true };
    const ms = Date.parse(until);
    if (!Number.isFinite(ms) || ms <= Date.now()) return null;
    return { until: new Date(ms).toISOString(), permanent: false };
}

/**
 * Record a refused message against its sender and apply the ban the ladder
 * says. Fails soft: without the migration the message is still refused,
 * but strike 0 comes back and nothing is banned.
 */
export async function recordChatStrike(
    admin: Admin,
    { userId, kind, body, threadId }: { userId: string; kind: OffPlatformKind; body: string; threadId: string | null },
): Promise<{ strike: number; ban: ChatBanState | null }> {
    const inserted = await admin.from('chat_strikes').insert({ user_id: userId, kind, body, thread_id: threadId });
    if (inserted.error) {
        if (!isMissingSchema(inserted.error)) console.error('[chat] strike insert failed:', inserted.error.message);
        return { strike: 0, ban: null };
    }
    const counted = await admin.from('chat_strikes').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const strike = typeof counted.count === 'number' && counted.count > 0 ? counted.count : 1;

    const rule = chatBanForStrike(strike);
    if (!rule) return { strike, ban: null };

    const until = rule === 'permanent' ? 'infinity' : new Date(Date.now() + rule.hours * 3_600_000).toISOString();
    const { data: current } = await admin.from('profiles').select('chat_banned_until').eq('id', userId).maybeSingle<ChatBanRow>();
    const existing = chatBanState(current);
    const lengthens = !existing || (!existing.permanent && (rule === 'permanent' || Date.parse(existing.until!) < Date.parse(until)));
    if (lengthens) {
        const updated = await admin.from('profiles').update({ chat_banned_until: until }).eq('id', userId);
        if (updated.error) console.error('[chat] chat ban update failed:', updated.error.message);
    }
    const ban = lengthens ? chatBanState({ chat_banned_until: until }) : existing;

    // One issue per user so the team sees who climbs the ladder.
    Sentry.captureMessage(rule === 'permanent' ? 'Chat user banned for good (off-platform dealing)' : 'Chat user suspended (off-platform dealing)', {
        level: 'warning',
        tags: { area: 'chat', kind, strike: String(strike) },
        fingerprint: ['chat-ban', userId],
        extra: { userId, strike, until },
    });
    return { strike, ban };
}
