'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { CHAT_CHANGED_EVENT, chatAvatar, chatUserName, fetchChatThreads, type ChatThreadSummary } from '@/lib/chat';

const POLL_MS = 15_000;

/**
 * The list of conversations, newest first, unread ones bold with a dot. No
 * header of its own: Profile's Messages panel and the desktop dialog each
 * draw theirs.
 */
export default function ChatInbox({ onOpenThread }: { onOpenThread: (thread: ChatThreadSummary) => void }) {
    const { t, isThai } = useTranslation();
    const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            void fetchChatThreads().then((res) => {
                if (cancelled) return;
                if (!res) { setFailed(true); setThreads((prev) => prev ?? []); return; }
                setFailed(false);
                setThreads(res.available ? res.threads : []);
            });
        };
        load();
        window.addEventListener(CHAT_CHANGED_EVENT, load);
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
        return () => {
            cancelled = true;
            window.removeEventListener(CHAT_CHANGED_EVENT, load);
            window.clearInterval(timer);
        };
    }, []);

    const locale = isThai ? 'th-TH' : 'en-US';
    const whenOf = (iso: string | null) => {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toDateString() === new Date().toDateString()
            ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    };

    if (threads === null) {
        return (
            <div className="flex justify-center py-16">
                <i className="fa-solid fa-circle-notch fa-spin text-slate-500"></i>
            </div>
        );
    }
    if (threads.length === 0) {
        return (
            <div className="glass p-6 rounded-2xl border border-white/5 text-center text-sm text-slate-400 leading-relaxed">
                {failed ? t('chat.loadFailed') : t('chat.emptyInbox')}
            </div>
        );
    }

    return (
        <div className="glass rounded-[2rem] border-white/5 overflow-hidden">
            {threads.map((thread, idx) => (
                <button
                    key={thread.id}
                    onClick={() => onOpenThread(thread)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors ${idx !== threads.length - 1 ? 'border-b border-white/[0.04]' : ''}`}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={chatAvatar(thread.other)} alt="" className="w-11 h-11 rounded-full object-cover bg-slate-900 shrink-0" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                            <p className={`text-sm truncate ${thread.unread ? 'font-black text-white' : 'font-semibold text-slate-200'}`}>{chatUserName(thread.other)}</p>
                            <span className="text-[10px] text-slate-500 shrink-0">{whenOf(thread.lastMessageAt)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <p className={`text-xs truncate flex-1 ${thread.unread ? 'text-slate-200' : 'text-slate-500'}`}>
                                {thread.lastSenderIsMe ? t('chat.you') : ''}{thread.lastMessagePreview}
                            </p>
                            {thread.unread && <span className="w-2.5 h-2.5 rounded-full bg-brand-cyan shrink-0" aria-hidden="true"></span>}
                        </div>
                    </div>
                </button>
            ))}
        </div>
    );
}
