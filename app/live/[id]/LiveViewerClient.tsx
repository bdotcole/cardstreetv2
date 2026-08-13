'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { getGame } from '@/lib/games';
import { createClient } from '@/lib/supabase/client';
import { fetchPublicSellers, type PublicSeller } from '@/lib/publicProfiles';
import { useLiveKitRoom, type CameraSlot } from '@/lib/hooks/useLiveKitRoom';
import { usePremium } from '@/lib/hooks/usePremium';
import { TrackAudio } from '@/components/live/TrackVideo';
import { CroppedTrackVideo } from '@/components/live/CroppedTrackVideo';
import { TrackStatsBadge } from '@/components/live/TrackStatsBadge';
import { ShareShowButton } from '@/components/live/ShareShowButton';
import {
    clampRatio,
    DEFAULT_RATIO,
    formatCountdown,
    formatSatang,
    nameInitials,
    pollTotalVotes,
    type LiveChatMessage,
    type LiveLotRow,
    type LivePollRow,
    type LiveSpotRow,
    type LiveStreamRow,
} from '@/components/live/shared';
import { PollOptionBars } from '@/components/live/StreamPoll';
import {
    FloatingStickerLayer,
    StickerTray,
    useFloatingStickers,
    useStickerBroadcast,
} from '@/components/live/StickerReactions';
import type { StickerKey } from '@/components/live/stickers';
import type { PayableSpot } from '@/components/live/SpotPaymentSheet';

// Stripe Elements only loads when a checkout actually opens.
const SpotPaymentSheet = dynamic(() => import('@/components/live/SpotPaymentSheet'), { ssr: false });

/**
 * The VIEWER. Whatnot-style layout: two stacked feeds (face cam on top at the
 * broadcaster's split ratio, table cam below — the seller's layout is
 * authoritative; there is deliberately no viewer-side rearranging), chat
 * overlaying the lower feed, and the spot board as a slide-up sheet.
 * On lg: the video moves left and chat + board become a right column.
 *
 * Data flow: one initial GET /api/live/streams/[id], then Supabase Realtime
 * (postgres_changes under RLS) patches streams / stream_items / break_spots /
 * chat rows in place. LiveKit only carries the video.
 */

type PageState = 'loading' | 'denied' | 'ready';

const CHAT_OVERLAY_COUNT = 6;

function NotFoundBlock() {
    const { t } = useTranslation();
    return (
        <div className="min-h-[70vh] flex items-center justify-center px-6 text-center">
            <div className="max-w-md">
                <p className="text-6xl font-black tracking-tight mb-3 opacity-90">404</p>
                <h1 className="text-xl font-bold mb-2">{t('live.notFound.title') || 'Page not found'}</h1>
                <p className="opacity-70 mb-6 text-sm leading-relaxed">
                    {t('live.notFound.desc') ||
                        "The page you're looking for may have moved or no longer exists."}
                </p>
                <a
                    href="/"
                    className="inline-block px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider bg-brand-cyan text-black hover:opacity-90 transition-opacity"
                >
                    {t('live.notFound.back') || 'Back home'}
                </a>
            </div>
        </div>
    );
}

function spotStatusClasses(opts: { status: string; mine: boolean; flashing: boolean }): string {
    if (opts.flashing) return 'bg-brand-cyan/30 border-brand-cyan text-white';
    if (opts.mine) return 'bg-brand-cyan/15 border-brand-cyan text-brand-cyan';
    switch (opts.status) {
        case 'open':
            return 'bg-emerald-500/10 border-emerald-400/40 text-emerald-300 active:scale-95';
        case 'held':
            return 'bg-amber-500/10 border-amber-400/40 text-amber-300';
        case 'sold':
            return 'bg-white/5 border-white/10 text-slate-400';
        default:
            return 'bg-black/30 border-white/5 text-slate-600';
    }
}

export default function LiveViewerClient() {
    const params = useParams<{ id: string }>();
    const streamId = params?.id ?? '';
    const router = useRouter();
    const { t } = useTranslation();
    const { showToast } = useToast();

    const [pageState, setPageState] = useState<PageState>('loading');
    const [stream, setStream] = useState<LiveStreamRow | null>(null);
    const [lots, setLots] = useState<LiveLotRow[]>([]);
    const [spots, setSpots] = useState<LiveSpotRow[]>([]);
    const [chat, setChat] = useState<LiveChatMessage[]>([]);
    const [profiles, setProfiles] = useState<Map<string, PublicSeller>>(new Map());
    const [myUserId, setMyUserId] = useState<string | null>(null);

    const [boardOpen, setBoardOpen] = useState(false);
    const [audioMuted, setAudioMuted] = useState(true);
    const [chatInput, setChatInput] = useState('');
    const [sending, setSending] = useState(false);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [claimingSpotId, setClaimingSpotId] = useState<string | null>(null);
    // ─── Admin house-reserve (quiet board filler; the routes re-verify the
    //     admin role server-side, so this is UX only and fails closed) ───
    const [houseAction, setHouseAction] = useState<{
        spot: LiveSpotRow;
        type: 'reserve' | 'release';
    } | null>(null);
    const [houseBusy, setHouseBusy] = useState(false);
    // A long-press that opened the house sheet must not ALSO fire the spot
    // button's click (which would claim the spot the admin meant to reserve).
    const suppressSpotClickRef = useRef(false);
    const housePressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The current poll (open, or just-closed while its result lingers).
    const [poll, setPoll] = useState<LivePollRow | null>(null);
    const [myVote, setMyVote] = useState<string | null>(null);
    const [voting, setVoting] = useState(false);
    // Realtime handlers compare against the CURRENT poll without re-binding
    // the channel on every tally tick.
    const pollRef = useRef<LivePollRow | null>(null);
    useEffect(() => {
        pollRef.current = poll;
    }, [poll]);
    // Spots the randomizer just touched — pulse-highlighted for a few seconds.
    const [flashSpots, setFlashSpots] = useState<Set<string>>(new Set());
    // 1s tick that drives the hold countdowns.
    const [now, setNow] = useState(() => Date.now());
    // Bumped to tear down + rebuild the Realtime channel after an error.
    const [realtimeNonce, setRealtimeNonce] = useState(0);
    // LiveKit reconnect attempts since the last successful connection.
    const [connectAttempt, setConnectAttempt] = useState(0);

    const supabaseRef = useRef(createClient());
    const { connect, connected, remoteFeeds, participantCount, setSubscriptionQuality } =
        useLiveKitRoom();
    // Admin-only receive-side stats overlay (field diagnostics). Fails closed.
    const { isAdmin } = usePremium();

    // Desktop viewports pin the TOP simulcast layer instead of relying on
    // adaptiveStream's element measurement, which served the middle layer to
    // large screens (the fuzzy-viewer field report). Decided once at mount,
    // BEFORE the connect effect can run (it waits on pageState/stream), so the
    // Room is constructed with the right subscription mode.
    useEffect(() => {
        if (window.innerWidth >= 1024) setSubscriptionQuality('high');
    }, [setSubscriptionQuality]);

    // Desktop chat column keeps the newest message in view. The mobile overlay
    // needs no scroll — it renders only the last few messages.
    const chatEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ block: 'nearest' });
    }, [chat.length]);

    // ─── Initial load ───
    useEffect(() => {
        if (!streamId) return;
        let cancelled = false;
        (async () => {
            try {
                const [detailRes, chatRes, pollRes, userRes] = await Promise.all([
                    fetch(`/api/live/streams/${streamId}`),
                    fetch(`/api/live/streams/${streamId}/chat`),
                    fetch(`/api/live/streams/${streamId}/polls`),
                    supabaseRef.current.auth.getUser(),
                ]);
                if (cancelled) return;
                if (!detailRes.ok) {
                    setPageState('denied');
                    return;
                }
                const detail = await detailRes.json();
                setStream(detail.stream);
                setLots(detail.items ?? []);
                setSpots(detail.spots ?? []);
                if (chatRes.ok) {
                    const chatData = await chatRes.json();
                    setChat(chatData.messages ?? []);
                }
                if (pollRes.ok) {
                    // Only a live open poll matters at join time; a poll that
                    // closed before we arrived stays hidden.
                    const pollData = await pollRes.json();
                    if (pollData.poll?.status === 'open') {
                        setPoll(pollData.poll);
                        setMyVote(pollData.myVote ?? null);
                    }
                }
                setMyUserId(userRes.data.user?.id ?? null);
                setPageState('ready');
            } catch {
                if (!cancelled) setPageState('denied');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [streamId]);

    // Tolerant re-sync used after a Realtime gap (backgrounded WebView,
    // channel error). Never flips pageState — a transient failure mid-show
    // must not 404 the viewer; the next trigger catches us up.
    const refetchDetail = useCallback(async () => {
        try {
            const [res, pollRes] = await Promise.all([
                fetch(`/api/live/streams/${streamId}`),
                fetch(`/api/live/streams/${streamId}/polls`),
            ]);
            if (res.ok) {
                const detail = await res.json();
                setStream(detail.stream);
                setLots(detail.items ?? []);
                setSpots(detail.spots ?? []);
            }
            if (pollRes.ok) {
                // Recover a poll INSERT/close the dead channel missed. Only an
                // open poll is (re)adopted — closed ones linger via the
                // Realtime path's grace timer, not here.
                const pollData = await pollRes.json();
                if (pollData.poll?.status === 'open') {
                    setPoll(pollData.poll);
                    setMyVote(pollData.myVote ?? null);
                } else if (pollData.poll) {
                    setPoll((prev) =>
                        prev && prev.id === pollData.poll.id ? pollData.poll : prev,
                    );
                }
            }
        } catch {
            // Realtime (or the next visibility flip) will catch us up.
        }
    }, [streamId]);

    // Capacitor WebView backgrounding kills sockets silently — the channel
    // looks alive but rows were missed. Refetch on return to foreground.
    useEffect(() => {
        if (pageState !== 'ready') return;
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void refetchDetail();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [pageState, refetchDetail]);

    // PromptPay (and other redirect-flow methods) bounce back to this page
    // with ?payment_intent=...&redirect_status=... appended by Stripe. Surface
    // the outcome, then strip the params — the webhook finalizes server-side
    // and Realtime flips the board.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const redirectStatus = params.get('redirect_status');
        if (!redirectStatus) return;
        if (redirectStatus === 'succeeded') {
            showToast(t('live.payment.redirectSucceeded'), 'success');
        } else if (redirectStatus === 'processing') {
            showToast(t('live.payment.redirectProcessing'), 'success');
        } else {
            showToast(t('live.payment.redirectFailed'), 'error');
        }
        params.delete('redirect_status');
        params.delete('payment_intent');
        params.delete('payment_intent_client_secret');
        const qs = params.toString();
        window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
        );
        // Mount-only: the params exist only on the redirect landing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─── Realtime: patch rows in place ───
    useEffect(() => {
        if (pageState !== 'ready' || !streamId) return;
        const supabase = supabaseRef.current;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const patchSpot = (row: LiveSpotRow) => {
            if (!row?.id) return; // DELETE payloads carry an empty `new`
            // Randomizer result: assigned_packs appearing (or changing) is the
            // reveal moment — pulse the spot on the board. Compared against
            // CURRENT state, not payload.old — realtime only carries the PK in
            // `old` without REPLICA IDENTITY FULL.
            let packsChanged = false;
            setSpots((prev) => {
                const idx = prev.findIndex((s) => s.id === row.id);
                const before = idx === -1 ? null : prev[idx].assigned_packs ?? null;
                packsChanged =
                    !!row.assigned_packs &&
                    JSON.stringify(before) !== JSON.stringify(row.assigned_packs);
                if (idx === -1) return [...prev, row];
                const next = [...prev];
                next[idx] = { ...next[idx], ...row };
                return next;
            });
            if (packsChanged) {
                setFlashSpots((prev) => new Set(prev).add(row.id));
                setTimeout(() => {
                    setFlashSpots((prev) => {
                        const next = new Set(prev);
                        next.delete(row.id);
                        return next;
                    });
                }, 4000);
            }
        };

        const channel = supabase
            .channel(`live-viewer-${streamId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'break_spots', filter: `stream_id=eq.${streamId}` },
                (payload) => patchSpot(payload.new as LiveSpotRow),
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'stream_items', filter: `stream_id=eq.${streamId}` },
                (payload) => {
                    const row = payload.new as LiveLotRow;
                    if (!row?.id) return;
                    setLots((prev) => {
                        const idx = prev.findIndex((l) => l.id === row.id);
                        if (idx === -1) return [...prev, row].sort((a, b) => a.position - b.position);
                        const next = [...prev];
                        next[idx] = { ...next[idx], ...row };
                        return next.sort((a, b) => a.position - b.position);
                    });
                },
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'streams', filter: `id=eq.${streamId}` },
                (payload) => setStream((prev) => (prev ? { ...prev, ...(payload.new as LiveStreamRow) } : prev)),
            )
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'stream_chat_messages',
                    filter: `stream_id=eq.${streamId}`,
                },
                (payload) => {
                    const msg = payload.new as LiveChatMessage;
                    setChat((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
                },
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'stream_polls', filter: `stream_id=eq.${streamId}` },
                (payload) => {
                    const row = payload.new as LivePollRow;
                    if (!row?.id) return;
                    if (pollRef.current?.id === row.id) {
                        setPoll((prev) => (prev && prev.id === row.id ? { ...prev, ...row } : prev));
                    } else if (row.status === 'open') {
                        // A fresh poll replaces whatever card was up; the
                        // ballot highlight resets with it. (A close/update of
                        // a poll we never showed is ignored.)
                        setMyVote(null);
                        setPoll(row);
                    }
                },
            )
            .subscribe((status) => {
                // A broken channel means silently missed rows: recover the
                // gap with a refetch, then rebuild the channel via the nonce.
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    void refetchDetail();
                    if (retryTimer) clearTimeout(retryTimer);
                    retryTimer = setTimeout(() => setRealtimeNonce((n) => n + 1), 3000);
                }
            });

        return () => {
            if (retryTimer) clearTimeout(retryTimer);
            supabase.removeChannel(channel);
        };
    }, [pageState, streamId, refetchDetail, realtimeNonce]);

    // ─── LiveKit: join the room while the show is live. Re-runs when
    //     `connected` flips false (RoomEvent.Disconnected cleared the dead
    //     room), so a network blip reconnects with a fresh token; outright
    //     failures retry a few times with a short backoff. ───
    useEffect(() => {
        if (pageState !== 'ready' || stream?.status !== 'live' || connected) return;
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        (async () => {
            try {
                const res = await fetch(`/api/live/streams/${streamId}/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'viewer' }),
                });
                const data = await res.json();
                if (!res.ok || !data.token || !data.url) return; // 409 = just ended; realtime updates the state
                if (cancelled) return;
                await connect(data.url, data.token);
            } catch {
                // Video is best-effort; chat + board still work without it.
                // Retry a couple of times before settling for no video.
                if (!cancelled && connectAttempt < 3) {
                    retryTimer = setTimeout(
                        () => setConnectAttempt((a) => a + 1),
                        2000 * (connectAttempt + 1),
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [pageState, stream?.status, streamId, connect, connected, connectAttempt]);

    // A successful connection re-arms the retry budget for the next blip.
    useEffect(() => {
        if (connected) setConnectAttempt(0);
    }, [connected]);

    // ─── Public names for chat senders + sold-spot owners (fail-soft) ───
    const neededProfileIds = useMemo(() => {
        const ids = new Set<string>();
        for (const m of chat) if (!m.is_system && !m.sender) ids.add(m.sender_id);
        for (const s of spots) if (s.status === 'sold' && s.buyer_id) ids.add(s.buyer_id);
        return [...ids].filter((id) => !profiles.has(id));
    }, [chat, spots, profiles]);

    useEffect(() => {
        if (neededProfileIds.length === 0) return;
        let cancelled = false;
        fetchPublicSellers(supabaseRef.current, neededProfileIds).then((fetched) => {
            if (cancelled || fetched.size === 0) return;
            setProfiles((prev) => {
                const next = new Map(prev);
                fetched.forEach((v, k) => next.set(k, v));
                return next;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [neededProfileIds]);

    // ─── Derived: the lot on the block + its spots (the tick below needs
    //     them, so they live above it) ───
    const activeLot = useMemo(
        () =>
            lots.find((l) => l.id === stream?.current_item_id) ??
            lots.find((l) => l.status === 'active') ??
            null,
        [lots, stream?.current_item_id],
    );
    const activeSpots = useMemo(
        () =>
            activeLot
                ? spots
                      .filter((s) => s.stream_item_id === activeLot.id)
                      .sort((a, b) => a.spot_number - b.spot_number)
                : [],
        [spots, activeLot],
    );

    // ─── Hold countdown tick ───
    const myHeldSpots = useMemo(
        () =>
            spots.filter(
                (s) =>
                    s.status === 'held' &&
                    s.held_by === myUserId &&
                    !!myUserId &&
                    !!s.hold_expires_at &&
                    Date.parse(s.hold_expires_at) > now,
            ),
        [spots, myUserId, now],
    );

    // Tick while ANY spot is held — not only the current user's. Every
    // viewer's board derives hold expiry from `now`, so a clock frozen at
    // mount would leave an expired hold rendered as un-claimable amber
    // forever for everyone who never held a spot themselves. All spots, not
    // just the active lot's: presale boards on a scheduled show span every
    // presale lot. A scheduled show also ticks unconditionally — the same
    // clock drives the start countdown on the landing.
    const anyHeldSpot = useMemo(() => spots.some((s) => s.status === 'held'), [spots]);
    const tickNeeded = anyHeldSpot || stream?.status === 'scheduled';

    useEffect(() => {
        if (!tickNeeded) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [tickNeeded]);

    // ─── Claim ───
    const claimSpot = useCallback(
        async (spot: LiveSpotRow) => {
            if (claimingSpotId) return;
            setClaimingSpotId(spot.id);
            try {
                const res = await fetch(`/api/live/spots/${spot.id}/claim`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.claimed === true) {
                    setSpots((prev) =>
                        prev.map((s) =>
                            s.id === spot.id
                                ? {
                                      ...s,
                                      status: 'held',
                                      held_by: myUserId,
                                      hold_expires_at: data.hold_expires_at ?? null,
                                  }
                                : s,
                        ),
                    );
                    setNow(Date.now());
                    return;
                }
                const reasonKey: Record<string, string> = {
                    held: 'live.viewer.claimTaken',
                    unavailable: 'live.viewer.claimTaken',
                    lot_closed: 'live.viewer.lotClosed',
                    stream_not_live: 'live.viewer.notStarted',
                    own_item: 'live.viewer.claimOwnItem',
                    suspended: 'live.viewer.claimSuspended',
                };
                let message = t('live.viewer.claimError') || 'Could not claim that spot';
                if (data.code === 'GEO_RESTRICTED') {
                    message = t('live.viewer.claimGeo') || 'Buying is only available in Thailand for now';
                } else if (data.code === 'RATE_LIMITED') {
                    message = t('live.viewer.rateLimited') || 'Slow down a moment';
                } else if (typeof data.reason === 'string' && reasonKey[data.reason]) {
                    message = t(reasonKey[data.reason]);
                }
                showToast(message, 'error');
            } catch {
                showToast(t('live.viewer.claimError') || 'Could not claim that spot', 'error');
            } finally {
                setClaimingSpotId(null);
            }
        },
        [claimingSpotId, myUserId, showToast, t],
    );

    const runHouseAction = useCallback(async () => {
        const action = houseAction;
        if (!action || houseBusy) return;
        setHouseBusy(true);
        try {
            const res = await fetch(
                `/api/live/spots/${action.spot.id}/house-${action.type === 'reserve' ? 'reserve' : 'release'}`,
                { method: 'POST' },
            );
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.spot) {
                // Realtime will confirm; patch now so the board flips instantly.
                setSpots((prev) =>
                    prev.map((s) => (s.id === action.spot.id ? { ...s, ...data.spot } : s)),
                );
                showToast(
                    action.type === 'reserve'
                        ? t('live.viewer.houseReserved') || 'Spot reserved for the house'
                        : t('live.viewer.houseReleased') || 'Spot released back to open',
                    'success',
                );
            } else {
                showToast(t('live.viewer.houseError') || 'Could not update that spot', 'error');
            }
        } catch {
            showToast(t('live.viewer.houseError') || 'Could not update that spot', 'error');
        } finally {
            setHouseBusy(false);
            setHouseAction(null);
        }
    }, [houseAction, houseBusy, showToast, t]);

    const releaseMyHolds = useCallback(async () => {
        const held = myHeldSpots;
        await Promise.all(
            held.map((s) => fetch(`/api/live/spots/${s.id}/release`, { method: 'POST' }).catch(() => null)),
        );
        setSpots((prev) =>
            prev.map((s) =>
                held.some((h) => h.id === s.id)
                    ? { ...s, status: 'open', held_by: null, hold_expires_at: null }
                    : s,
            ),
        );
    }, [myHeldSpots]);

    // ─── Chat send ───
    const sendChat = useCallback(async () => {
        const body = chatInput.trim();
        if (!body || sending) return;
        setSending(true);
        try {
            const res = await fetch(`/api/live/streams/${streamId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const codeKey: Record<string, string> = {
                    BANNED: 'live.viewer.banned',
                    CHAT_DISABLED: 'live.viewer.chatFrozen',
                    RATE_LIMITED: 'live.viewer.rateLimited',
                };
                showToast(
                    (data.code && codeKey[data.code] && t(codeKey[data.code])) ||
                        t('live.viewer.sendError') ||
                        'Message not sent',
                    'error',
                );
                return;
            }
            setChatInput('');
            if (data.message) {
                setChat((prev) =>
                    prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
                );
            }
        } catch {
            showToast(t('live.viewer.sendError') || 'Message not sent', 'error');
        } finally {
            setSending(false);
        }
    }, [chatInput, sending, streamId, showToast, t]);

    // ─── Poll: vote + closed-result lingering ───
    const votePoll = useCallback(
        async (optionKey: string) => {
            const target = pollRef.current;
            if (!target || voting || target.status !== 'open') return;
            const previousVote = myVote;
            setMyVote(optionKey); // optimistic highlight; tallies wait for the server
            setVoting(true);
            try {
                const res = await fetch(`/api/live/polls/${target.id}/vote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ option: optionKey }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setMyVote(previousVote);
                    showToast(
                        data.code === 'RATE_LIMITED'
                            ? t('live.viewer.rateLimited') || 'Slow down a moment'
                            : t('live.poll.voteError') || 'Could not record your vote',
                        'error',
                    );
                    return;
                }
                if (data.tallies) {
                    setPoll((prev) =>
                        prev && prev.id === target.id ? { ...prev, tallies: data.tallies } : prev,
                    );
                }
            } catch {
                setMyVote(previousVote);
                showToast(t('live.poll.voteError') || 'Could not record your vote', 'error');
            } finally {
                setVoting(false);
            }
        },
        [voting, myVote, showToast, t],
    );

    // A closed poll collapses to its result for a beat, then leaves the stage.
    useEffect(() => {
        if (poll?.status !== 'closed') return;
        const pollId = poll.id;
        const timer = setTimeout(() => {
            setPoll((prev) => (prev && prev.id === pollId ? null : prev));
        }, 6000);
        return () => clearTimeout(timer);
    }, [poll?.status, poll?.id]);

    // ─── Sticker reactions (ephemeral broadcast; nothing persists) ───
    const { floats: stickerFloats, spawn: spawnSticker, remove: removeSticker } = useFloatingStickers();
    useStickerBroadcast(streamId, pageState === 'ready' && stream?.status === 'live', spawnSticker);

    const sendSticker = useCallback(
        (sticker: StickerKey) => {
            spawnSticker(sticker); // optimistic — the broadcast never echoes back
            void fetch(`/api/live/streams/${streamId}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sticker }),
            })
                .then((res) => {
                    if (res.status === 429) {
                        showToast(t('live.viewer.rateLimited') || 'Slow down a moment', 'error');
                    }
                })
                .catch(() => {
                    // Ephemeral by design — a lost reaction is not worth a toast.
                });
        },
        [streamId, spawnSticker, showToast, t],
    );

    // ─── Derived ───
    const openCount = activeSpots.filter((s) => s.status === 'open').length;

    const mainTrack = remoteFeeds.video.main ?? null;
    const tableTrack = remoteFeeds.video.table ?? null;
    const feedCount = (mainTrack ? 1 : 0) + (tableTrack ? 1 : 0);
    // The broadcaster's per-feed framing (streams.layout, live via Realtime).
    // CroppedTrackVideo treats null/invalid as the default uncropped fill.
    const cropFor = (slot: CameraSlot) => stream?.layout?.[slot] ?? null;
    // Split ratio = the FACE cam's share of the stacked height. Pre-ratio rows
    // fall back to the default split.
    const faceRatio = clampRatio(stream?.layout?.ratio) ?? DEFAULT_RATIO;

    const payableSpots: PayableSpot[] = myHeldSpots.map((s) => ({
        id: s.id,
        spotNumber: s.spot_number,
        priceSatang: s.price,
    }));
    const holdMsLeft = myHeldSpots.reduce((min, s) => {
        const left = Date.parse(s.hold_expires_at as string) - now;
        return Math.min(min, left);
    }, Infinity);

    const displayName = (userId: string, fallback?: { display_name: string | null } | null) =>
        fallback?.display_name || profiles.get(userId)?.display_name || '...';

    if (pageState === 'denied') {
        return (
            <main className="min-h-screen bg-brand-darker text-white">
                <NotFoundBlock />
            </main>
        );
    }

    if (pageState === 'loading' || !stream) {
        return (
            <main className="min-h-screen bg-brand-darker text-white flex items-center justify-center">
                <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl"></i>
            </main>
        );
    }

    const isLive = stream.status === 'live';
    const isScheduled = stream.status === 'scheduled';

    // Presales: a scheduled show's presale-enabled lot is purchasable now;
    // everything else needs the show live. Mirrors the claim RPC's guard —
    // the server (claim_break_spot) stays authoritative either way.
    const canBuyLot = (lot: LiveLotRow) =>
        (lot.status === 'queued' || lot.status === 'active') &&
        (isLive || (isScheduled && lot.presale_enabled === true));

    // Any still-purchasable presale lot — drives the landing chip and the
    // share message's "reserve your spot" variant.
    const presaleOpen = lots.some(
        (l) => (l.status === 'queued' || l.status === 'active') && l.presale_enabled === true,
    );

    // ─── Shared blocks (mobile + desktop compose them differently) ───

    // Admins get a quiet secondary action on the board: long-press (or
    // right-click) an OPEN spot to reserve it for the house, or one of their
    // own house-held spots to release it. House spots render exactly like any
    // other sold spot (the admin account's real initials) — the only tell is
    // this hidden gesture. Server-side the routes re-verify the admin role.
    const houseActionFor = (spot: LiveSpotRow): 'reserve' | 'release' | null => {
        if (!isAdmin) return null;
        const holdLapsed =
            spot.status === 'held' &&
            !!spot.hold_expires_at &&
            Date.parse(spot.hold_expires_at) <= now;
        if (spot.status === 'open' || holdLapsed) return 'reserve';
        // order_id survives the API's visibility filter only on the caller's
        // own spots, so sold + no order + mine = my house reservation — never
        // a real (paid) purchase of mine, which always carries its order id.
        if (spot.status === 'sold' && spot.order_id === null && spot.buyer_id === myUserId) {
            return 'release';
        }
        return null;
    };
    const startHousePress = (spot: LiveSpotRow, type: 'reserve' | 'release') => {
        suppressSpotClickRef.current = false;
        if (housePressTimerRef.current) clearTimeout(housePressTimerRef.current);
        housePressTimerRef.current = setTimeout(() => {
            suppressSpotClickRef.current = true;
            setHouseAction({ spot, type });
        }, 500);
    };
    const cancelHousePress = () => {
        if (housePressTimerRef.current) {
            clearTimeout(housePressTimerRef.current);
            housePressTimerRef.current = null;
        }
    };

    // The claim grid for one lot — the live board renders it for the lot on
    // the block; the scheduled landing renders one per presale lot.
    const spotGrid = (lot: LiveLotRow, lotSpots: LiveSpotRow[]) => (
        <div className="grid grid-cols-5 gap-2">
            {lotSpots.map((spot) => {
                const mine = spot.held_by === myUserId && spot.status === 'held';
                const soldMine = spot.status === 'sold' && spot.buyer_id === myUserId;
                const flashing = flashSpots.has(spot.id);
                const expired =
                    spot.status === 'held' &&
                    !!spot.hold_expires_at &&
                    Date.parse(spot.hold_expires_at) <= now;
                const claimable =
                    canBuyLot(lot) && (spot.status === 'open' || (expired && !mine));
                const houseAct = houseActionFor(spot);
                return (
                    <motion.button
                        key={spot.id}
                        animate={flashing ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                        transition={flashing ? { duration: 0.6, repeat: 2 } : undefined}
                        onClick={() => {
                            if (suppressSpotClickRef.current) {
                                suppressSpotClickRef.current = false;
                                return;
                            }
                            if (claimable) void claimSpot(spot);
                        }}
                        onPointerDown={houseAct ? () => startHousePress(spot, houseAct) : undefined}
                        onPointerUp={houseAct ? cancelHousePress : undefined}
                        onPointerLeave={houseAct ? cancelHousePress : undefined}
                        onPointerCancel={houseAct ? cancelHousePress : undefined}
                        onContextMenu={
                            houseAct
                                ? (e) => {
                                      e.preventDefault();
                                      cancelHousePress();
                                      setHouseAction({ spot, type: houseAct });
                                  }
                                : undefined
                        }
                        disabled={(!claimable && !houseAct) || claimingSpotId === spot.id}
                        className={`relative aspect-square rounded-xl border flex flex-col items-center justify-center transition-all select-none ${spotStatusClasses(
                            { status: expired ? 'open' : spot.status, mine: mine || soldMine, flashing },
                        )}`}
                    >
                        <span className="text-sm font-black">{spot.spot_number}</span>
                        {spot.status === 'sold' && (
                            <span className="text-[9px] font-black uppercase">
                                {soldMine
                                    ? t('live.viewer.yourSpot') || 'Yours'
                                    : nameInitials(
                                          spot.buyer_id
                                              ? profiles.get(spot.buyer_id)?.display_name
                                              : null,
                                      )}
                            </span>
                        )}
                        {mine && !expired && (
                            <span className="text-[9px] font-black">
                                {formatCountdown(Date.parse(spot.hold_expires_at as string) - now)}
                            </span>
                        )}
                        {spot.assigned_packs && spot.assigned_packs.length > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-brand-cyan text-brand-darker text-[8px] font-black flex items-center justify-center">
                                {spot.assigned_packs.join(',')}
                            </span>
                        )}
                    </motion.button>
                );
            })}
        </div>
    );

    const chatMessages = (limit?: number) => {
        const visible = limit ? chat.slice(-limit) : chat;
        return visible.map((m, i) => {
            const faded = limit ? Math.max(0.35, (i + 1) / visible.length) : 1;
            if (m.is_system) {
                return (
                    <p
                        key={m.id}
                        style={limit ? { opacity: faded } : undefined}
                        className="text-[11px] text-amber-300 font-bold text-center py-0.5 px-2 break-words"
                    >
                        {m.body}
                    </p>
                );
            }
            return (
                <p
                    key={m.id}
                    style={limit ? { opacity: faded } : undefined}
                    className="text-[12px] leading-snug py-0.5 px-2 break-words"
                >
                    <span className="font-black text-brand-cyan mr-1.5">
                        {displayName(m.sender_id, m.sender)}
                    </span>
                    <span className="text-white/90">{m.body}</span>
                </p>
            );
        });
    };

    const chatInputRow = (
        <div className="flex items-center gap-2">
            <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') void sendChat();
                }}
                maxLength={300}
                placeholder={
                    stream.chat_disabled
                        ? t('live.viewer.chatFrozen') || 'Chat is frozen by the host'
                        : t('live.viewer.chatPlaceholder') || 'Say something...'
                }
                disabled={stream.chat_disabled || stream.status === 'ended'}
                className="flex-1 h-11 rounded-full bg-black/50 border border-white/15 px-4 text-sm text-white outline-none focus:border-brand-cyan/60 placeholder:text-slate-500 disabled:opacity-50 backdrop-blur-sm"
            />
            <button
                onClick={() => void sendChat()}
                disabled={sending || !chatInput.trim()}
                aria-label={t('live.common.send')}
                className="w-11 h-11 rounded-full bg-brand-cyan text-brand-darker flex items-center justify-center disabled:opacity-40 active:scale-90 transition-all"
            >
                <i className="fa-solid fa-paper-plane text-sm"></i>
            </button>
        </div>
    );

    const spotBoard = (
        <div className="flex flex-col min-h-0">
            {activeLot ? (
                <>
                    <div className="px-4 py-3 border-b border-white/5">
                        <p className="text-sm font-black text-white leading-snug">
                            {activeLot.card_data?.name || t('live.viewer.spotBoard') || 'Spots'}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 font-bold">
                            <span className="text-brand-cyan uppercase tracking-wider">
                                {t(`live.types.${activeLot.item_type}`)}
                            </span>
                            {activeLot.spot_price != null && (
                                <span>{formatSatang(activeLot.spot_price)}</span>
                            )}
                            {activeLot.packs_per_spot > 1 && (
                                <span>
                                    {activeLot.packs_per_spot} {t('live.viewer.packsPerSpot') || 'packs/spot'}
                                </span>
                            )}
                            <span className="text-emerald-300">
                                {openCount} {t('live.viewer.spotsLeft') || 'left'}
                            </span>
                            {activeLot.break_opened_at && (
                                <span className="text-amber-300 uppercase tracking-wider">
                                    {t('live.console.ripped') || 'Ripped'}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="p-3 overflow-y-auto">{spotGrid(activeLot, activeSpots)}</div>
                </>
            ) : (
                <p className="text-xs text-slate-400 text-center py-8 px-4">
                    {t('live.viewer.noActiveLot') || 'No lot on the block yet'}
                </p>
            )}
        </div>
    );

    // The audience poll card — open polls take votes, a just-closed poll
    // lingers as its result for a few seconds (the effect above clears it).
    const pollCard = isLive && poll && (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-black/60 border border-white/15 backdrop-blur-sm p-3"
        >
            <div className="flex items-center gap-2 mb-1.5">
                <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                        poll.status === 'open'
                            ? 'bg-brand-cyan/15 text-brand-cyan'
                            : 'bg-white/10 text-slate-300'
                    }`}
                >
                    {poll.status === 'open'
                        ? t('live.poll.open') || 'Live poll'
                        : t('live.poll.closed') || 'Poll closed'}
                </span>
                <span className="text-[10px] text-slate-400 font-bold ml-auto tabular-nums">
                    {pollTotalVotes(poll)} {t('live.poll.votes') || 'votes'}
                </span>
            </div>
            <p className="text-xs font-black text-white leading-snug mb-2 break-words">{poll.question}</p>
            <PollOptionBars
                poll={poll}
                myVote={myVote}
                onVote={poll.status === 'open' ? (key) => void votePoll(key) : undefined}
                disabled={voting}
            />
            {poll.status === 'open' && !myVote && (
                <p className="mt-1.5 text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                    {t('live.poll.tapToVote') || 'Tap an option to vote'}
                </p>
            )}
        </motion.div>
    );

    const heldBar = myHeldSpots.length > 0 && (
        <div className="flex items-center gap-2 bg-brand-cyan/10 border border-brand-cyan/30 rounded-2xl px-3 py-2 backdrop-blur-sm">
            <div className="flex-1 min-w-0">
                <p className="text-[10px] text-brand-cyan font-black uppercase tracking-widest">
                    {myHeldSpots.length} {t('live.payment.spots') || 'Spots'} ·{' '}
                    {t('live.viewer.holdCountdown') || 'Held'}{' '}
                    {Number.isFinite(holdMsLeft) ? formatCountdown(holdMsLeft) : ''}
                </p>
                <p className="text-xs text-white font-bold">
                    {formatSatang(myHeldSpots.reduce((sum, s) => sum + s.price, 0))}
                </p>
            </div>
            <button
                onClick={() => void releaseMyHolds()}
                className="px-3 h-9 rounded-xl bg-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
            >
                {t('live.viewer.releaseHold') || 'Release'}
            </button>
            <button
                onClick={() => setPaymentOpen(true)}
                className="px-4 h-9 rounded-xl bg-brand-cyan text-brand-darker text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all"
            >
                {t('live.viewer.payNow') || 'Checkout'}
            </button>
        </div>
    );

    // The house-action confirm sheet — a deliberate second tap so a stray
    // long-press can never silently take a spot off (or put one back on) the
    // board. Rendered by both the scheduled landing and the live layout.
    const houseSheet = houseAction && (
        <div
            className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center"
            onClick={() => !houseBusy && setHouseAction(null)}
        >
            <div className="absolute inset-0 bg-black/60" />
            <div
                className="relative w-full max-w-sm m-4 mb-[calc(var(--sab)+1rem)] lg:mb-4 rounded-2xl bg-slate-900 border border-white/10 p-4"
                onClick={(e) => e.stopPropagation()}
            >
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                    {t('live.viewer.spotBoard') || 'Spots'} · #{houseAction.spot.spot_number}
                </p>
                <p className="text-sm font-black text-white mt-1">
                    {houseAction.type === 'reserve'
                        ? t('live.viewer.houseReserve') || 'Reserve for house'
                        : t('live.viewer.houseRelease') || 'Release house spot'}
                </p>
                <div className="mt-4 flex gap-2">
                    <button
                        onClick={() => setHouseAction(null)}
                        disabled={houseBusy}
                        className="flex-1 h-10 rounded-xl bg-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
                    >
                        {t('live.payment.close') || 'Close'}
                    </button>
                    <button
                        onClick={() => void runHouseAction()}
                        disabled={houseBusy}
                        className="flex-1 h-10 rounded-xl bg-brand-cyan text-brand-darker text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
                    >
                        {houseBusy ? (
                            <i className="fa-solid fa-circle-notch animate-spin"></i>
                        ) : houseAction.type === 'reserve' ? (
                            t('live.viewer.houseReserve') || 'Reserve for house'
                        ) : (
                            t('live.viewer.houseRelease') || 'Release house spot'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );

    const videoArea = (
        <div className="relative w-full h-full bg-black overflow-hidden">
            {!isLive ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                    <i className="fa-solid fa-tower-broadcast text-slate-600 text-4xl mb-4"></i>
                    <p className="text-sm text-slate-300 font-bold">
                        {stream.status === 'ended'
                            ? t('live.viewer.ended') || 'Show ended'
                            : t('live.viewer.notStarted') || "The show hasn't started yet"}
                    </p>
                    {stream.status === 'ended' && (
                        <p className="text-xs text-slate-500 mt-1">
                            {t('live.viewer.endedDesc') || 'Thanks for watching'}
                        </p>
                    )}
                </div>
            ) : feedCount === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-xl mb-3"></i>
                    <p className="text-xs text-slate-400">
                        {t('live.viewer.waitingVideo') || 'Waiting for video...'}
                    </p>
                </div>
            ) : feedCount === 1 ? (
                <>
                    <CroppedTrackVideo
                        track={mainTrack ?? tableTrack}
                        crop={cropFor(mainTrack ? 'main' : 'table')}
                        slot={mainTrack ? 'main' : 'table'}
                        className="absolute inset-0"
                    />
                    {isAdmin && (
                        <TrackStatsBadge
                            track={mainTrack ?? tableTrack}
                            className="absolute top-16 left-3"
                        />
                    )}
                </>
            ) : (
                <div className="absolute inset-0 flex flex-col">
                    {/* Fixed arrangement — the seller's layout is authoritative:
                        face cam on top at its ratio share, table cam below.
                        (Tap-to-swap was removed: viewers reframing the show
                        defeated the broadcaster's deliberate framing.) */}
                    <div className="relative" style={{ height: `${faceRatio * 100}%` }}>
                        <CroppedTrackVideo
                            track={mainTrack}
                            crop={cropFor('main')}
                            slot="main"
                            className="absolute inset-0"
                        />
                        {isAdmin && (
                            <TrackStatsBadge
                                track={mainTrack}
                                className="absolute bottom-1.5 left-1.5"
                            />
                        )}
                    </div>
                    <div
                        className="relative border-t border-white/10"
                        style={{ height: `${(1 - faceRatio) * 100}%` }}
                    >
                        <CroppedTrackVideo
                            track={tableTrack}
                            crop={cropFor('table')}
                            slot="table"
                            className="absolute inset-0"
                        />
                        {isAdmin && (
                            <TrackStatsBadge
                                track={tableTrack}
                                className="absolute top-1.5 left-1.5"
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Remote audio (main cam mic). Muted until the viewer opts in. */}
            {remoteFeeds.audio.map((track, i) => (
                <TrackAudio key={track.sid ?? i} track={track} muted={audioMuted} />
            ))}
            {isLive && audioMuted && feedCount > 0 && (
                <button
                    onClick={() => setAudioMuted(false)}
                    className="absolute top-16 right-3 px-3 h-9 rounded-full bg-black/60 border border-white/20 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2 backdrop-blur-sm active:scale-95 transition-all"
                >
                    <i className="fa-solid fa-volume-xmark"></i>
                    {t('live.viewer.unmute') || 'Tap for sound'}
                </button>
            )}

            {/* Sticker floats. videoArea renders twice (mobile + desktop
                trees), both layers share one float list — the hidden twin
                never animates, and the hook's sweep reaps on its behalf. */}
            <FloatingStickerLayer floats={stickerFloats} onDone={removeSticker} />
        </div>
    );

    const header = (
        <div className="flex items-center gap-2.5">
            <button
                onClick={() => router.push('/live')}
                aria-label={t('live.common.back')}
                className="w-9 h-9 rounded-full bg-black/50 border border-white/15 flex items-center justify-center text-slate-300 backdrop-blur-sm active:scale-90 transition-all"
            >
                <i className="fa-solid fa-chevron-left text-xs"></i>
            </button>
            {stream.seller?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={stream.seller.avatar_url}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover border border-white/20"
                />
            ) : (
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                    <i className="fa-solid fa-circle-user text-slate-400"></i>
                </div>
            )}
            <div className="min-w-0">
                <p className="text-xs font-black text-white truncate max-w-[40vw] lg:max-w-none">
                    {stream.seller?.display_name || '—'}
                </p>
                <p className="text-[10px] text-slate-300 truncate max-w-[40vw] lg:max-w-none">
                    {stream.title}
                </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
                {isLive && (
                    <>
                        <span className="px-2 py-0.5 rounded-md bg-brand-red text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                            {t('live.viewer.live') || 'LIVE'}
                        </span>
                        {connected && (
                            <span className="px-2 py-0.5 rounded-md bg-black/50 border border-white/15 text-slate-200 text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-sm">
                                <i className="fa-solid fa-eye text-[9px]"></i>
                                {participantCount}
                            </span>
                        )}
                    </>
                )}
                <ShareShowButton
                    title={stream.title}
                    sellerName={stream.seller?.display_name}
                    path={`/live/${streamId}`}
                    status={stream.status}
                    scheduledAt={stream.scheduled_at}
                    presaleOpen={presaleOpen}
                    className="w-9 h-9 rounded-full bg-black/50 border border-white/15 flex items-center justify-center text-slate-300 backdrop-blur-sm active:scale-90 transition-all"
                />
            </div>
        </div>
    );

    // ─── Scheduled: the pre-live landing. Cover + countdown + the lot list,
    //     with working presale spot boards where the seller opted in (full
    //     claim -> SpotPaymentSheet purchase, board updates via the same
    //     Realtime channel). No LiveKit here — the join effect above is gated
    //     on status='live', so flipping live via Realtime connects video and
    //     swaps this landing for the live layout in place. ───
    if (isScheduled) {
        const game = getGame(stream.game_id);
        const visibleLots = lots.filter((l) => l.status === 'queued' || l.status === 'active');
        const msToStart = stream.scheduled_at ? Date.parse(stream.scheduled_at) - now : null;
        const countdown =
            msToStart != null && msToStart > 0
                ? {
                      d: Math.floor(msToStart / 86_400_000),
                      h: Math.floor((msToStart % 86_400_000) / 3_600_000),
                      m: Math.floor((msToStart % 3_600_000) / 60_000),
                      s: Math.floor((msToStart % 60_000) / 1000),
                  }
                : null;
        const countdownCells: Array<[number, string]> = countdown
            ? [
                  [countdown.d, t('live.scheduled.days') || 'days'],
                  [countdown.h, t('live.scheduled.hours') || 'hrs'],
                  [countdown.m, t('live.scheduled.mins') || 'min'],
                  [countdown.s, t('live.scheduled.secs') || 'sec'],
              ]
            : [];

        return (
            <main className="min-h-screen bg-brand-darker text-white pb-36">
                {/* ─── Cover ─── */}
                <div className="relative h-64 sm:h-72">
                    {stream.cover_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={stream.cover_image_url}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                    ) : (
                        <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient}`} />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-darker via-brand-darker/40 to-black/30" />
                    <div className="absolute top-0 inset-x-0 pt-[calc(var(--sat)+0.75rem)] px-4 flex items-center gap-2">
                        <button
                            onClick={() => router.push('/live')}
                            aria-label={t('live.common.back')}
                            className="w-9 h-9 rounded-full bg-black/50 border border-white/15 flex items-center justify-center text-slate-300 backdrop-blur-sm active:scale-90 transition-all"
                        >
                            <i className="fa-solid fa-chevron-left text-xs"></i>
                        </button>
                        <ShareShowButton
                            title={stream.title}
                            sellerName={stream.seller?.display_name}
                            path={`/live/${streamId}`}
                            status={stream.status}
                            scheduledAt={stream.scheduled_at}
                            presaleOpen={presaleOpen}
                            className="ml-auto w-9 h-9 rounded-full bg-black/50 border border-white/15 flex items-center justify-center text-slate-300 backdrop-blur-sm active:scale-90 transition-all"
                        />
                    </div>
                    <div className="absolute bottom-0 inset-x-0 px-5 pb-4 max-w-xl lg:max-w-2xl mx-auto w-full">
                        <div className="flex items-center gap-2 mb-1.5">
                            {stream.seller?.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={stream.seller.avatar_url}
                                    alt=""
                                    className="w-7 h-7 rounded-full object-cover border border-white/20"
                                />
                            ) : (
                                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                                    <i className="fa-solid fa-circle-user text-slate-400 text-sm"></i>
                                </div>
                            )}
                            <p className="text-xs font-bold text-slate-200 truncate">
                                {stream.seller?.display_name || '—'}
                            </p>
                        </div>
                        <h1 className="text-xl font-black tracking-tight leading-snug">{stream.title}</h1>
                    </div>
                </div>

                {/* ─── Countdown ─── */}
                <section className="px-5 mt-5 max-w-xl lg:max-w-2xl mx-auto w-full text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                        {countdown
                            ? t('live.scheduled.startsIn') || 'Show starts in'
                            : stream.scheduled_at
                                ? t('live.scheduled.startsSoon') || 'Starting soon'
                                : t('live.scheduled.tba') || 'Start time coming soon'}
                    </p>
                    {countdown && (
                        <div className="mt-3 flex items-stretch justify-center gap-2">
                            {countdownCells.map(([value, label]) => (
                                <div
                                    key={label}
                                    className="w-16 rounded-xl glass border-white/10 py-2.5"
                                >
                                    <p className="text-xl font-black tabular-nums">
                                        {String(value).padStart(2, '0')}
                                    </p>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                                        {label}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                    {presaleOpen && (
                        <p className="mt-4 inline-block px-3 py-1.5 rounded-full bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-[11px] font-black uppercase tracking-widest">
                            {t('live.scheduled.presaleNow') || 'Presale open — grab your spots now'}
                        </p>
                    )}
                </section>

                {/* ─── Lots ─── */}
                <section className="px-4 mt-6 max-w-xl lg:max-w-2xl mx-auto w-full">
                    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-3 px-1">
                        {t('live.scheduled.lots') || 'Lots in this show'}
                    </h2>
                    {visibleLots.length === 0 && (
                        <p className="text-xs text-slate-500 text-center py-8">
                            {t('live.scheduled.noLots') || 'Lots will appear here soon'}
                        </p>
                    )}
                    <div className="space-y-3">
                        {visibleLots.map((lot) => {
                            const lotSpots = spots
                                .filter((s) => s.stream_item_id === lot.id)
                                .sort((a, b) => a.spot_number - b.spot_number);
                            const open = lotSpots.filter((s) => s.status === 'open').length;
                            const sold = lotSpots.filter((s) => s.status === 'sold').length;
                            const presale = canBuyLot(lot);
                            return (
                                <div
                                    key={lot.id}
                                    className="glass rounded-2xl border-white/10 overflow-hidden"
                                >
                                    <div className="px-4 py-3 border-b border-white/5">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-black text-white leading-snug">
                                                {lot.card_data?.name || '—'}
                                            </p>
                                            {lot.presale_enabled === true && (
                                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-cyan text-[9px] font-black uppercase tracking-widest">
                                                    {t('live.console.presaleChip') || 'Presale'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 font-bold">
                                            <span className="text-brand-cyan uppercase tracking-wider">
                                                {t(`live.types.${lot.item_type}`)}
                                            </span>
                                            {lot.spot_price != null && (
                                                <span>{formatSatang(lot.spot_price)}</span>
                                            )}
                                            {lot.packs_per_spot > 1 && (
                                                <span>
                                                    {lot.packs_per_spot}{' '}
                                                    {t('live.viewer.packsPerSpot') || 'packs/spot'}
                                                </span>
                                            )}
                                            {presale && (
                                                <span className="text-emerald-300">
                                                    {open} {t('live.viewer.spotsLeft') || 'left'}
                                                </span>
                                            )}
                                            {sold > 0 && (
                                                <span>
                                                    {sold} {t('live.console.soldCount') || 'sold'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {presale ? (
                                        <div className="p-3">{spotGrid(lot, lotSpots)}</div>
                                    ) : (
                                        <p className="px-4 py-4 text-xs text-slate-500">
                                            {t('live.scheduled.availableWhenLive') ||
                                                'Available when the show goes live'}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Held spots -> the same checkout rail as the live board. */}
                {heldBar && (
                    <div className="fixed bottom-0 inset-x-0 z-40 px-4 pb-[calc(var(--sab)+0.75rem)] pt-6 bg-gradient-to-t from-brand-darker via-brand-darker/90 to-transparent">
                        <div className="max-w-xl lg:max-w-2xl mx-auto">{heldBar}</div>
                    </div>
                )}

                <SpotPaymentSheet
                    open={paymentOpen}
                    spots={payableSpots}
                    onClose={() => setPaymentOpen(false)}
                    onSuccess={() => {
                        // Board flips via Realtime when finalize lands.
                    }}
                    onReleased={() => {
                        setPaymentOpen(false);
                        void releaseMyHolds();
                    }}
                />

                {houseSheet}
            </main>
        );
    }

    return (
        <main className="h-[100dvh] bg-brand-darker text-white overflow-hidden">
            {/* ─── Mobile: full-bleed video with overlays ─── */}
            <div className="relative h-full lg:hidden">
                {videoArea}

                <div className="absolute top-0 inset-x-0 pt-[calc(var(--sat)+0.5rem)] px-3 bg-gradient-to-b from-black/70 to-transparent pb-6 pointer-events-none">
                    <div className="pointer-events-auto">{header}</div>
                </div>

                {/* Chat overlay + input + held bar over the lower feed */}
                <div className="absolute bottom-0 inset-x-0 pb-[calc(var(--sab)+0.75rem)] px-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10">
                    {pollCard && <div className="mb-2">{pollCard}</div>}
                    <div className="mb-2 max-h-[30vh] overflow-hidden flex flex-col justify-end">
                        {chatMessages(CHAT_OVERLAY_COUNT)}
                    </div>
                    {heldBar && <div className="mb-2">{heldBar}</div>}
                    {isLive && (
                        <div className="mb-2 flex justify-end">
                            <StickerTray onSend={sendSticker} />
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <div className="flex-1">{chatInputRow}</div>
                        <button
                            onClick={() => setBoardOpen(true)}
                            className="h-11 px-3.5 rounded-full bg-white/10 border border-white/15 text-white text-[10px] font-black uppercase tracking-widest backdrop-blur-sm active:scale-95 transition-all flex items-center gap-1.5"
                        >
                            <i className="fa-solid fa-table-cells"></i>
                            {t('live.viewer.spotBoard') || 'Spots'}
                            {openCount > 0 && (
                                <span className="min-w-4 h-4 px-1 rounded-full bg-emerald-400 text-black text-[9px] font-black flex items-center justify-center">
                                    {openCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Slide-up spot board sheet */}
                <AnimatePresence>
                    {boardOpen && (
                        <>
                            <motion.div
                                key="board-backdrop"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setBoardOpen(false)}
                                className="absolute inset-0 bg-black/50 z-30"
                            />
                            <motion.div
                                key="board-sheet"
                                initial={{ y: '100%' }}
                                animate={{ y: 0 }}
                                exit={{ y: '100%' }}
                                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                                className="absolute bottom-0 inset-x-0 z-40 bg-slate-900 rounded-t-[2rem] border-t border-white/10 max-h-[70vh] flex flex-col pb-[calc(var(--sab)+0.5rem)]"
                            >
                                <div className="flex items-center justify-between px-4 pt-3 pb-1">
                                    <div className="w-10 h-1 rounded-full bg-white/20 absolute left-1/2 -translate-x-1/2 top-2"></div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 pt-2">
                                        {t('live.viewer.spotBoard') || 'Spots'}
                                    </p>
                                    <button
                                        onClick={() => setBoardOpen(false)}
                                        aria-label={t('live.payment.close') || 'Close'}
                                        className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-slate-400"
                                    >
                                        <i className="fa-solid fa-xmark text-sm"></i>
                                    </button>
                                </div>
                                <div className="overflow-y-auto">{spotBoard}</div>
                                {heldBar && <div className="px-3 pt-2">{heldBar}</div>}
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>
            </div>

            {/* ─── Desktop (lg:): video left, chat + board right ─── */}
            <div className="hidden lg:flex h-full">
                <div className="flex-1 relative">
                    {videoArea}
                    <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/70 to-transparent pb-8">
                        {header}
                    </div>
                </div>
                <div className="w-[400px] border-l border-white/10 bg-slate-950/60 flex flex-col">
                    <div className="border-b border-white/5 max-h-[45%] overflow-y-auto">{spotBoard}</div>
                    {pollCard && <div className="px-3 pt-3">{pollCard}</div>}
                    {heldBar && <div className="px-3 pt-3">{heldBar}</div>}
                    <div className="flex-1 overflow-y-auto py-2 flex flex-col justify-end">
                        {chatMessages()}
                        <div ref={chatEndRef} />
                    </div>
                    <div className="p-3 border-t border-white/5 space-y-2">
                        {isLive && (
                            <div className="flex justify-end">
                                <StickerTray onSend={sendSticker} />
                            </div>
                        )}
                        {chatInputRow}
                    </div>
                </div>
            </div>

            <SpotPaymentSheet
                open={paymentOpen}
                spots={payableSpots}
                onClose={() => setPaymentOpen(false)}
                onSuccess={() => {
                    // Board flips via Realtime when finalize lands; nothing to
                    // patch locally beyond letting the sheet show its success.
                }}
                onReleased={() => {
                    setPaymentOpen(false);
                    void releaseMyHolds();
                }}
            />

            {houseSheet}
        </main>
    );
}
