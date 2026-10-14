'use client';

import { useEffect, useState } from 'react';
import { CHAT_CHANGED_EVENT, fetchChatThreads } from '@/lib/chat';

/**
 * Unread chat conversations for the signed-in user, for the Messages badges
 * (mobile Profile row + tab icon, desktop account menu). Several mounts share
 * one lookup within a short window, like useOfferBadge. Re-checks every
 * minute while the page is visible and whenever a chat is sent or read.
 * Fails silent: any error is 0 unread and Messages stays visible.
 */
const TTL_MS = 30_000;
const POLL_MS = 60_000;
let cached: { at: number; value: ChatUnread } | null = null;
let inflight: Promise<ChatUnread> | null = null;

export interface ChatUnread {
    /** False before the chat migration has run; callers hide Messages. */
    available: boolean;
    unread: number;
}

const SIGNED_OUT: ChatUnread = { available: false, unread: 0 };

function load(force: boolean): Promise<ChatUnread> {
    if (!force && cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
    if (inflight) return inflight;
    inflight = fetchChatThreads()
        .then((res) => {
            // null = signed out or an error; neither should hide Messages for a
            // signed-in user, so only an explicit "not available" does.
            const value: ChatUnread = res ? { available: res.available, unread: res.unreadCount } : { available: true, unread: 0 };
            cached = { at: Date.now(), value };
            return value;
        })
        .finally(() => { inflight = null; });
    return inflight;
}

export function useChatUnread(enabled: boolean): ChatUnread {
    const [state, setState] = useState<ChatUnread>(() => (enabled && cached ? cached.value : SIGNED_OUT));

    useEffect(() => {
        // Signed out: drop the cache too, or the next account to sign in on
        // this device would see the previous one's count for a moment.
        if (!enabled) { cached = null; setState(SIGNED_OUT); return; }
        let cancelled = false;
        const refresh = (force: boolean) => {
            void load(force).then((v) => { if (!cancelled) setState(v); });
        };
        refresh(false);
        const onChanged = () => refresh(true);
        window.addEventListener(CHAT_CHANGED_EVENT, onChanged);
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') refresh(true);
        }, POLL_MS);
        return () => {
            cancelled = true;
            window.removeEventListener(CHAT_CHANGED_EVENT, onChanged);
            window.clearInterval(timer);
        };
    }, [enabled]);

    return state;
}
