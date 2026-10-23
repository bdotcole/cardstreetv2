'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReportModal from '@/components/ReportModal';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import {
    CHAT_MAX_CHARS,
    CHAT_POLL_MS,
    CHAT_STRIKE_PERMANENT_AT,
    chatAvatar,
    chatUserName,
    fetchChatMessages,
    fetchChatThreadWith,
    notifyChatChanged,
    sendChatMessage,
    type ChatBanState,
    type ChatMessage,
    type ChatUser,
} from '@/lib/chat';

interface ChatThreadViewProps {
    /** Who the conversation is with. Optional when threadId is given (a push tap knows only the thread). */
    other?: ChatUser | null;
    viewerId: string;
    /** A known thread; without one the conversation with `other` is looked up (or starts on first send). */
    threadId?: string | null;
    onBack: () => void;
    /** 'close' in a desktop dialog, 'back' full-screen on a phone. */
    backIcon?: 'back' | 'close';
    /** Tapping the name opens their shop. */
    onViewShop?: (peer: ChatUser) => void;
}

type ShownMessage = ChatMessage & { pending?: boolean };

/** The server refused the draft: why, and which strike it was. */
interface Refusal {
    kind: 'contact' | 'link' | 'offplatform' | 'solicit';
    strike: number;
}

const banInForce = (ban: ChatBanState | null): ban is ChatBanState =>
    !!ban && (ban.permanent || (!!ban.until && Date.parse(ban.until) > Date.now()));

/**
 * One conversation: header, the pay-on-Cardstreet notice, messages, composer.
 * Fills its parent (a flex column of fixed height). Polls for new messages
 * while open and visible; the server marks the thread read on each read.
 */
export default function ChatThreadView({ other = null, viewerId, threadId: initialThreadId = null, onBack, backIcon = 'back', onViewShop }: ChatThreadViewProps) {
    const { t, isThai } = useTranslation();
    const { showToast } = useToast();
    const [threadId, setThreadId] = useState<string | null>(initialThreadId);
    const [messages, setMessages] = useState<ShownMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    // The server refused the draft for contact details, an off-app deal or an
    // unlisted sale; it stays in the box with the reason until they edit it.
    const [refusal, setRefusal] = useState<Refusal | null>(null);
    // The viewer's chat suspension, from the thread open or the refusal that caused it.
    const [ban, setBan] = useState<ChatBanState | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [peer, setPeer] = useState<ChatUser | null>(other);
    const peerId = other?.id ?? null;
    const name = chatUserName(peer);

    const merge = useCallback((incoming: ChatMessage[]) => {
        if (incoming.length === 0) return;
        setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = incoming.filter((m) => !seen.has(m.id));
            return fresh.length ? [...prev, ...fresh] : prev;
        });
    }, []);

    // First load: the known thread, or the existing conversation with this person.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            let id = initialThreadId;
            if (!id && peerId) {
                const found = await fetchChatThreadWith(peerId);
                if (cancelled) return;
                if (!found) { setFailed(true); setLoading(false); return; }
                id = found.thread?.id ?? null;
            }
            if (!id) { setLoading(false); return; }
            const res = await fetchChatMessages(id);
            if (cancelled) return;
            if (!res) { setFailed(true); setLoading(false); return; }
            setThreadId(id);
            setPeer((p) => p ?? res.thread.other);
            setMessages(res.messages);
            setBan(res.ban ?? null);
            setLoading(false);
            notifyChatChanged();
        })();
        return () => { cancelled = true; };
    }, [initialThreadId, peerId]);

    // Poll for replies. Uses the newest confirmed message as the cursor.
    const lastConfirmedAt = [...messages].reverse().find((m) => !m.pending)?.createdAt;
    useEffect(() => {
        if (!threadId) return;
        const timer = window.setInterval(async () => {
            if (document.visibilityState !== 'visible') return;
            const res = await fetchChatMessages(threadId, lastConfirmedAt);
            if (res?.messages.length) {
                merge(res.messages);
                notifyChatChanged();
            }
        }, CHAT_POLL_MS);
        return () => window.clearInterval(timer);
    }, [threadId, lastConfirmedAt, merge]);

    // Stay pinned to the newest message.
    useLayoutEffect(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, loading]);

    const suspended = banInForce(ban);

    const send = async () => {
        const body = draft.trim();
        if (!body || sending || suspended || (!threadId && !peer)) return;
        const tempId = `local-${Date.now()}`;
        setMessages((prev) => [...prev, { id: tempId, senderId: viewerId, body, createdAt: new Date().toISOString(), pending: true }]);
        setDraft('');
        setSending(true);
        const result = await sendChatMessage({ threadId, toUserId: peer?.id, body });
        setSending(false);
        if (!result.ok) {
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
            setDraft(body);
            if (result.code === 'OFF_PLATFORM') {
                setRefusal({ kind: result.kind, strike: result.strike });
                if (result.ban) setBan(result.ban);
                return;
            }
            if (result.code === 'CHAT_BANNED') {
                setBan(result.ban);
                return;
            }
            const key = result.code === 'RATE_LIMITED' ? 'chat.rateLimited'
                : result.code === 'BANNED' ? 'chat.banned'
                : result.code === 'NOT_AVAILABLE' ? 'chat.unavailable'
                : 'chat.sendFailed';
            showToast(t(key), 'error');
            return;
        }
        setThreadId(result.threadId);
        setMessages((prev) => {
            const withoutTemp = prev.filter((m) => m.id !== tempId);
            return withoutTemp.some((m) => m.id === result.message.id) ? withoutTemp : [...withoutTemp, result.message];
        });
        notifyChatChanged();
        inputRef.current?.focus();
    };

    // Enter sends with a keyboard and pointer; on a phone it is a new line,
    // and the Send button sends.
    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
        if (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
            e.preventDefault();
            void send();
        }
    };

    // Grow the box with its text, up to about five lines.
    useLayoutEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
        // A scrollbar only once the text outgrows the box.
        el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
    }, [draft]);

    const locale = isThai ? 'th-TH' : 'en-US';
    const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const dayOf = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    const untilOf = (iso: string) => new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    // What the red notice says: the reason the draft was refused, then where
    // the sender now stands on the ladder (a warning, or the suspension).
    const notice: string[] = [];
    if (refusal) notice.push(t(refusal.kind === 'solicit' ? 'chat.solicit' : 'chat.offPlatform'));
    if (suspended) {
        if (ban.permanent) notice.push(t('chat.chatBannedForever'));
        else if (refusal && refusal.strike > 1 && refusal.strike < CHAT_STRIKE_PERMANENT_AT) {
            notice.push(t(`chat.strike${refusal.strike}`).replace('{until}', untilOf(ban.until!)));
        } else notice.push(t('chat.chatBannedUntil').replace('{until}', untilOf(ban.until!)));
    } else if (refusal?.strike === 1) {
        notice.push(t('chat.strike1'));
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Header */}
            <div className="shrink-0 flex items-center gap-3 px-3 py-2.5 border-b border-white/5">
                <button
                    onClick={onBack}
                    aria-label={t(backIcon === 'close' ? 'chat.close' : 'chat.back')}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors shrink-0"
                >
                    <i className={`fa-solid ${backIcon === 'close' ? 'fa-xmark' : 'fa-arrow-left'}`}></i>
                </button>
                <button
                    onClick={() => { if (peer) onViewShop?.(peer); }}
                    disabled={!onViewShop || !peer}
                    className="flex-1 min-w-0 flex items-center gap-2.5 text-left disabled:cursor-default"
                >
                    {peer ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={chatAvatar(peer)} alt="" className="w-9 h-9 rounded-full object-cover bg-slate-900 shrink-0" />
                    ) : (
                        <span className="w-9 h-9 rounded-full bg-slate-800 shrink-0" />
                    )}
                    <span className="min-w-0">
                        <span className="block text-sm font-bold text-white truncate">{peer ? name : ''}</span>
                        {onViewShop && peer && <span className="block text-[11px] text-brand-cyan">{t('chat.viewShop')}</span>}
                    </span>
                </button>
                <button
                    onClick={() => setReportOpen(true)}
                    disabled={!peer}
                    aria-label={t('chat.report')}
                    title={t('chat.report')}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-brand-red hover:bg-brand-red/10 transition-colors shrink-0"
                >
                    <i className="fa-solid fa-flag text-sm"></i>
                </button>
            </div>

            {/* Off-platform payment is the scam this channel invites; say it every time. */}
            <p className="shrink-0 mx-3 mt-3 rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-[11px] leading-snug text-amber-200 flex gap-2">
                <i className="fa-solid fa-shield-halved mt-0.5 text-amber-400"></i>
                <span>{t('chat.safety')}</span>
            </p>

            {/* Messages */}
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1.5">
                {loading ? (
                    <div className="flex justify-center py-10">
                        <i className="fa-solid fa-circle-notch fa-spin text-slate-500"></i>
                    </div>
                ) : failed ? (
                    <p className="text-center text-sm text-slate-500 py-10">{t('chat.loadFailed')}</p>
                ) : messages.length === 0 ? (
                    <p className="text-center text-sm text-slate-500 py-10 px-6 leading-relaxed">{t('chat.emptyThread').replace('{name}', name)}</p>
                ) : (
                    messages.map((m, i) => {
                        const mine = m.senderId === viewerId;
                        const prev = messages[i - 1];
                        const newDay = !prev || dayOf(prev.createdAt) !== dayOf(m.createdAt);
                        return (
                            <React.Fragment key={m.id}>
                                {newDay && (
                                    <p className="text-center text-[10px] font-bold text-slate-600 pt-3 pb-1">{dayOf(m.createdAt)}</p>
                                )}
                                <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                    <div
                                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${mine
                                            ? 'bg-brand-cyan text-brand-darker rounded-br-md'
                                            : 'bg-white/[0.07] text-white rounded-bl-md'} ${m.pending ? 'opacity-60' : ''}`}
                                    >
                                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                                        <p className={`text-[10px] mt-0.5 text-right ${mine ? 'text-brand-darker/60' : 'text-slate-500'}`}>{timeOf(m.createdAt)}</p>
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })
                )}
            </div>

            {notice.length > 0 && (
                <div role="alert" className="shrink-0 mx-3 mb-1 rounded-xl bg-brand-red/10 border border-brand-red/30 px-3 py-2 text-[11px] leading-snug text-red-200 flex gap-2">
                    <i className="fa-solid fa-ban mt-0.5 text-brand-red"></i>
                    <span className="space-y-1">
                        {notice.map((line, i) => <span key={i} className={i === 0 ? 'block' : 'block font-bold'}>{line}</span>)}
                    </span>
                </div>
            )}

            {/* Composer */}
            <div className="shrink-0 border-t border-white/5 px-3 py-2.5 flex items-end gap-2">
                <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value.slice(0, CHAT_MAX_CHARS)); setRefusal(null); }}
                    onKeyDown={onKeyDown}
                    rows={1}
                    disabled={suspended}
                    placeholder={t(suspended ? 'chat.composerSuspended' : 'chat.placeholder')}
                    className="flex-1 resize-none bg-white/5 border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors disabled:opacity-50"
                />
                <button
                    onClick={() => { void send(); }}
                    disabled={!draft.trim() || sending || suspended}
                    aria-label={t('chat.send')}
                    className="w-11 h-11 rounded-full bg-brand-cyan text-brand-darker flex items-center justify-center shrink-0 active:scale-95 transition-all disabled:opacity-40"
                >
                    <i className="fa-solid fa-paper-plane text-sm"></i>
                </button>
            </div>

            {peer && (
                <ReportModal
                    isOpen={reportOpen}
                    onClose={() => setReportOpen(false)}
                    entityType="seller"
                    entityId={peer.id}
                    entityName={name}
                    zIndexClass="z-[95]"
                />
            )}
        </div>
    );
}
