'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BodyPortal from '@/components/BodyPortal';
import ChatInbox from '@/components/chat/ChatInbox';
import ChatThreadView from '@/components/chat/ChatThreadView';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { CHAT_OPEN_EVENT, type ChatOpenDetail, type ChatUser } from '@/lib/chat';

/**
 * The desktop Messages dialog, mounted once in DesktopNav. Opens on
 * CHAT_OPEN_EVENT (the account menu, a seller page's Message button) and on
 * the chat email's link (/?tab=messages&thread=<id>), which lands desktop
 * browsers here rather than in the phone shell. Inbox first, or straight into
 * a conversation when the opener names one. Portaled: DesktopNav mounts it
 * inside the sticky header, whose backdrop-filter would otherwise make the
 * header, not the viewport, the box a fixed dialog is positioned in.
 */
export default function DesktopChatHost({ pathPrefix = '' }: { pathPrefix?: string }) {
    const { user } = useDesktopCart();
    const { t } = useTranslation();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [conversation, setConversation] = useState<{ threadId: string | null; other: ChatUser | null } | null>(null);

    useEffect(() => {
        const onOpen = (e: Event) => {
            const detail = (e as CustomEvent<ChatOpenDetail | undefined>).detail;
            setConversation(detail?.user || detail?.threadId
                ? { threadId: detail.threadId ?? null, other: detail.user ?? null }
                : null);
            setOpen(true);
        };
        window.addEventListener(CHAT_OPEN_EVENT, onOpen);
        return () => window.removeEventListener(CHAT_OPEN_EVENT, onOpen);
    }, []);

    // The chat email's CTA. Strip the params so a refresh does not reopen it.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('tab') !== 'messages') return;
        const threadId = params.get('thread');
        setConversation(threadId ? { threadId, other: null } : null);
        setOpen(true);
        params.delete('tab');
        params.delete('thread');
        const rest = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    }, []);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    if (!open || !user) return null;

    return (
        <BodyPortal>
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={t('chat.title')}
                className="w-full max-w-lg h-[min(80vh,720px)] bg-brand-dark border border-white/10 rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {conversation ? (
                    <ChatThreadView
                        key={conversation.threadId ?? conversation.other?.id ?? 'new'}
                        threadId={conversation.threadId}
                        other={conversation.other}
                        viewerId={user.id}
                        onBack={() => setConversation(null)}
                        onViewShop={(peer) => {
                            if (!peer.username) return;
                            setOpen(false);
                            router.push(`${pathPrefix}/seller/${encodeURIComponent(peer.username)}`);
                        }}
                    />
                ) : (
                    <>
                        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/5">
                            <h2 className="text-lg font-black text-white uppercase tracking-wide">{t('chat.title')}</h2>
                            <button
                                onClick={() => setOpen(false)}
                                aria-label={t('chat.close')}
                                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto p-4">
                            <ChatInbox onOpenThread={(thread) => setConversation({ threadId: thread.id, other: thread.other })} />
                        </div>
                    </>
                )}
            </div>
        </div>
        </BodyPortal>
    );
}
