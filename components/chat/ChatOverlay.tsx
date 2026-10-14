'use client';

import React, { useEffect } from 'react';
import BodyPortal from '@/components/BodyPortal';
import ChatThreadView from '@/components/chat/ChatThreadView';
import type { ChatUser } from '@/lib/chat';

/** Fired by the shell's Android back handler; an open chat consumes it. */
export const CHAT_BACK_EVENT = 'chat-back';

/**
 * A conversation full-screen on a phone. Portaled to body so the composer is
 * never under the shell's tab bar (the shell's <main> is its own stacking
 * context). z-[90]: above the shell header (z-50), below toasts (z-[100]) so a
 * failed send is still visible.
 */
export default function ChatOverlay({
    other,
    viewerId,
    threadId,
    onClose,
    onViewShop,
}: {
    other?: ChatUser | null;
    viewerId: string;
    threadId?: string | null;
    onClose: () => void;
    onViewShop?: (peer: ChatUser) => void;
}) {
    useEffect(() => {
        const onBack = (e: Event) => {
            e.preventDefault();
            onClose();
        };
        window.addEventListener(CHAT_BACK_EVENT, onBack);
        return () => window.removeEventListener(CHAT_BACK_EVENT, onBack);
    }, [onClose]);

    return (
        <BodyPortal>
            <div
                className="fixed inset-0 z-[90] bg-brand-darker flex flex-col"
                style={{
                    paddingTop: 'var(--sat, max(0.5rem, env(safe-area-inset-top, 0px)))',
                    paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))',
                }}
            >
                <ChatThreadView other={other} viewerId={viewerId} threadId={threadId} onBack={onClose} onViewShop={onViewShop} />
            </div>
        </BodyPortal>
    );
}
