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
import { ShareShowButton } from '@/components/live/ShareShowButton';
import { EventSplashLayer, useEventSplash } from '@/components/live/EventSplash';
import {
    bulkTiersOf,
    clampRatio,
    DEFAULT_RATIO,
    formatBulkTier,
    formatCountdown,
    formatSatang,
    isHoldLapsed,
    isSpotOpenNow,
    nameInitials,
    nextTurnSpot,
    currentTurnSpot,
    pollTotalVotes,
    rtyhPricingOf,
    type LiveAuctionState,
    type LiveChatMessage,
    type LiveLotRow,
    type LivePollRow,
    type LiveSpotRow,
    type LiveStreamRow,
} from '@/components/live/shared';
import { PollOptionBars } from '@/components/live/StreamPoll';
import {
    FloatingStickerLayer,
    ReactionFeedLines,
    StickerTray,
    useFloatingStickers,
    useReactionFeed,
} from '@/components/live/StickerReactions';
import { useStreamEvents, type SpotFocusEvent } from '@/components/live/streamEvents';
import type { StickerKey } from '@/components/live/stickers';
import type { PayableSpot } from '@/components/live/SpotPaymentSheet';
import RankChip from '@/components/rewards/rankChip';
import { ChatBody, EMOTE_PACKS, EmoteIcon } from '@/components/rewards/emotes';
import { CHAT_COLORS } from '@/lib/rewardTiers';
import { useRewardsSummary } from '@/lib/hooks/useRewardsSummary';

// Stripe Elements only loads when a checkout actually opens.
const SpotPaymentSheet = dynamic(() => import('@/components/live/SpotPaymentSheet'), { ssr: false });
// Save-a-card sheet for live bidding (platform-context Elements) — loaded on
// the first NEEDS_CARD response, never before.
const AddCardToBid = dynamic(() => import('@/components/live/AddCardToBid'), { ssr: false });
// Sign-in for logged-out share-link arrivals — loaded only when a 401 lands.
const AuthModal = dynamic(() => import('@/components/AuthModal'), { ssr: false });

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

// 'auth' = the request bounced 401: a share link opened without a session.
// Rendering that as the 404 block was the field-reported "share link is
// broken" — the fix is a sign-in screen that reloads the show on success.
type PageState = 'loading' | 'auth' | 'denied' | 'ready';

// Chat is the room's event feed (purchases, lot starts, joins, hits ride it
// as system lines) — it gets a bigger slice of the phone screen than a pure
// social chat would.
const CHAT_OVERLAY_COUNT = 10;

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
    const { t, isThai } = useTranslation();
    const { showToast } = useToast();

    const [pageState, setPageState] = useState<PageState>('loading');
    const [stream, setStream] = useState<LiveStreamRow | null>(null);
    const [lots, setLots] = useState<LiveLotRow[]>([]);
    const [spots, setSpots] = useState<LiveSpotRow[]>([]);
    const [chat, setChat] = useState<LiveChatMessage[]>([]);
    const [profiles, setProfiles] = useState<Map<string, PublicSeller>>(new Map());
    const [myUserId, setMyUserId] = useState<string | null>(null);
    // Own Collector Pass state (level + early-unlocked emote packs) for the
    // emote tray. Must live up here with the other hooks — the render below
    // has early returns.
    const { summary: myRewards } = useRewardsSummary(!!myUserId);

    const [boardOpen, setBoardOpen] = useState(false);
    // Sound ON by default; flipped to muted only if the browser refuses
    // unmuted autoplay (see TrackAudio onBlocked), after which the first tap
    // anywhere turns it on.
    const [audioMuted, setAudioMuted] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [sending, setSending] = useState(false);
    // Collector Pass emote picker (packs unlock by level; see rewards/emotes).
    const [emoteOpen, setEmoteOpen] = useState(false);
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
    // Admin role gates the quiet house-reserve gesture on the board. Fails closed.
    const { isAdmin } = usePremium();

    // DESKTOP pins the TOP simulcast layer; phones stay ADAPTIVE.
    //
    // Pinning every viewer (tried 2026-08-18 to fix a fuzzy-on-desktop report)
    // backfired live: the pin turns adaptiveStream fully OFF, so a phone is
    // forced to pull the 1080p top layer over mobile data no matter what its
    // connection can carry — which arrives as stutter, i.e. "laggy". Sharp but
    // unwatchable is worse than adaptive. Desktop keeps the pin, where the
    // feeds fill the screen and element measurement was under-requesting.
    //
    // Decided once at mount, BEFORE the connect effect runs, so the Room is
    // constructed with the right mode.
    useEffect(() => {
        if (window.innerWidth >= 1024) setSubscriptionQuality('high');
    }, [setSubscriptionQuality]);

    // Desktop chat column keeps the newest message in view. The mobile overlay
    // needs no scroll — it renders only the last few messages.
    const chatEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ block: 'nearest' });
    }, [chat.length]);

    // Bumped after a sign-in so the load below re-runs with the new session.
    const [authNonce, setAuthNonce] = useState(0);
    const [authModalOpen, setAuthModalOpen] = useState(false);
    const [authPrompt, setAuthPrompt] = useState<string | undefined>(undefined);

    // Watching is public; ACTING is not. Every buy/bid/chat/react/vote path
    // opens this instead of failing silently or bouncing off a server 401 —
    // the guest is told what signing in would let them do.
    const promptAuth = useCallback((reason: string) => {
        setAuthPrompt(reason);
        setAuthModalOpen(true);
    }, []);

    // "Get notified" opt-in on a scheduled show (stream_reminders).
    const [reminderSet, setReminderSet] = useState(false);
    const [reminderBusy, setReminderBusy] = useState(false);

    const toggleReminder = useCallback(async () => {
        if (reminderBusy) return;
        if (!myUserId) {
            promptAuth(t('live.viewer.signInToRemind') || 'Sign in to get notified');
            return;
        }
        const next = !reminderSet;
        setReminderBusy(true);
        setReminderSet(next); // optimistic — reverted below if the call fails
        try {
            const res = await fetch(`/api/live/streams/${streamId}/remind`, {
                method: next ? 'POST' : 'DELETE',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setReminderSet(!next);
                showToast(
                    data.error || t('live.scheduled.remindError') || 'Could not update the reminder',
                    'error',
                );
                return;
            }
            if (next) {
                showToast(t('live.scheduled.remindOn') || "You'll be notified when this show starts", 'success');
            }
        } catch {
            setReminderSet(!next);
            showToast(t('live.scheduled.remindError') || 'Could not update the reminder', 'error');
        } finally {
            setReminderBusy(false);
        }
    }, [reminderBusy, reminderSet, streamId, showToast, t]);

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
                if (detailRes.status === 401) {
                    setPageState('auth');
                    setAuthModalOpen(true);
                    return;
                }
                if (!detailRes.ok) {
                    setPageState('denied');
                    return;
                }
                const detail = await detailRes.json();
                setStream(detail.stream);
                setLots(detail.items ?? []);
                setSpots(detail.spots ?? []);
                setReminderSet(detail.reminderSet === true);
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
    }, [streamId, authNonce]);

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
            // Randomizer result: assigned_packs (or a character break's
            // assigned_entity) appearing or changing is the reveal moment —
            // pulse the spot on the board. Compared against CURRENT state, not
            // payload.old — realtime only carries the PK in `old` without
            // REPLICA IDENTITY FULL.
            let revealChanged = false;
            setSpots((prev) => {
                const idx = prev.findIndex((s) => s.id === row.id);
                const before = idx === -1 ? null : prev[idx];
                revealChanged =
                    (!!row.assigned_packs &&
                        JSON.stringify(before?.assigned_packs ?? null) !==
                            JSON.stringify(row.assigned_packs)) ||
                    (typeof row.assigned_entity === 'string' &&
                        row.assigned_entity !== (before?.assigned_entity ?? null)) ||
                    (typeof row.hit_note === 'string' &&
                        row.hit_note !== (before?.hit_note ?? null));
                if (idx === -1) return [...prev, row];
                const next = [...prev];
                next[idx] = { ...next[idx], ...row };
                return next;
            });
            if (revealChanged) {
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
    //     room), so a network blip reconnects with a fresh token. Failures
    //     retry FOREVER with a capped backoff — the old 3-attempt budget
    //     stranded viewers on "Waiting for video" with no error and no way
    //     back (field-diagnosed at the 2026-08-18 show); after 3 misses the
    //     video area now says so and offers a manual retry on top of the
    //     ongoing automatic one. ───
    useEffect(() => {
        if (pageState !== 'ready' || stream?.status !== 'live' || connected) return;
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRetry = () => {
            if (cancelled) return;
            retryTimer = setTimeout(
                () => setConnectAttempt((a) => a + 1),
                Math.min(2000 * (connectAttempt + 1), 15000),
            );
        };
        (async () => {
            try {
                const res = await fetch(`/api/live/streams/${streamId}/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'viewer' }),
                });
                const data = await res.json();
                if (!res.ok || !data.token || !data.url) {
                    // 409 = the show just ended — Realtime flips the page
                    // state, nothing to retry. Anything else (5xx, gateway
                    // hiccup) deserves the same retry loop as a failed
                    // connect.
                    if (res.status !== 409) scheduleRetry();
                    return;
                }
                if (cancelled) return;
                await connect(data.url, data.token);
            } catch {
                // Video is best-effort; chat + board still work without it.
                scheduleRetry();
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

    // ─── Chat reconciliation: realtime is at-most-once in practice ───
    // Field-observed 2026-08-22, mid-show: a viewer held a live channel
    // that delivered the streams UPDATE (header switched lots) but had
    // silently dropped a chat INSERT 43 minutes in — the Now-on-the-block
    // block line stayed on the previous lot for the rest of the show.
    // postgres_changes has no redelivery, so any dropped INSERT is a
    // permanent hole in this client's chat (user messages included).
    // A 30s sweep refetches the tail and merges by id: cheap (one small
    // read per viewer), and it heals every missed row, not just the
    // announcement banner.
    useEffect(() => {
        if (pageState !== 'ready' || stream?.status !== 'live') return;
        let cancelled = false;
        const sweep = async () => {
            try {
                const res = await fetch(`/api/live/streams/${streamId}/chat`);
                if (!res.ok) return;
                const data = await res.json().catch(() => null);
                const fresh: LiveChatMessage[] = data?.messages ?? [];
                if (cancelled || fresh.length === 0) return;
                setChat((prev) => {
                    const known = new Set(prev.map((m) => m.id));
                    const missed = fresh.filter((m) => !known.has(m.id));
                    if (missed.length === 0) return prev;
                    // Merge and restore chronology — a healed hole lands
                    // mid-history, not at the tail.
                    return [...prev, ...missed].sort((a, b) =>
                        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
                    );
                });
            } catch {
                // Offline blip — the next sweep catches up.
            }
        };
        const timer = setInterval(() => void sweep(), 30_000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [pageState, stream?.status, streamId]);


    // ─── Public names for chat senders + sold-spot owners (fail-soft) ───
    // Every sender is hydrated (not just embed-less realtime rows): the
    // public_profiles row also carries reward_level for the chat rank chip.
    // Own id included so the emote picker knows which packs are unlocked.
    const neededProfileIds = useMemo(() => {
        const ids = new Set<string>();
        for (const m of chat) if (!m.is_system) ids.add(m.sender_id);
        for (const s of spots) if (s.status === 'sold' && s.buyer_id) ids.add(s.buyer_id);
        if (myUserId) ids.add(myUserId);
        return [...ids].filter((id) => !profiles.has(id));
    }, [chat, spots, profiles, myUserId]);

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
    // A running auction needs the clock for its countdown, same as holds do.
    const anyLiveAuction = useMemo(() => lots.some((l) => l.auction?.status === 'live'), [lots]);
    const tickNeeded = anyHeldSpot || anyLiveAuction || stream?.status === 'scheduled';

    useEffect(() => {
        if (!tickNeeded) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [tickNeeded]);

    // ─── Claim ───
    const claimSpot = useCallback(
        async (spot: LiveSpotRow) => {
            if (claimingSpotId) return;
            if (!myUserId) {
                promptAuth(t('live.viewer.signInToBuy') || 'Sign in to grab a spot');
                return;
            }
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
                    auction: 'live.viewer.claimAuction',
                    not_next_turn: 'live.viewer.claimNotNextTurn',
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

    // ─── One-tap FCFS buy: the server picks the spot ───
    // random/chase/personal/pack-wars spots and rip_till_hit turns are
    // interchangeable to the buyer, so the big Buy button claims "the next
    // one" via /claim-next instead of making them hunt a number on the grid.
    const [claimingNextLotId, setClaimingNextLotId] = useState<string | null>(null);
    const claimNextSpot = useCallback(
        async (lot: LiveLotRow) => {
            if (claimingNextLotId) return;
            if (!myUserId) {
                promptAuth(t('live.viewer.signInToBuy') || 'Sign in to grab a spot');
                return;
            }
            setClaimingNextLotId(lot.id);
            try {
                const res = await fetch(`/api/live/lots/${lot.id}/claim-next`, { method: 'POST' });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.claimed === true && data.spot_id) {
                    setSpots((prev) =>
                        prev.map((s) =>
                            s.id === data.spot_id
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
                    unavailable: 'live.viewer.soldOutToast',
                    lot_closed: 'live.viewer.lotClosed',
                    stream_not_live: 'live.viewer.notStarted',
                    own_item: 'live.viewer.claimOwnItem',
                    suspended: 'live.viewer.claimSuspended',
                    auction: 'live.viewer.claimAuction',
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
                setClaimingNextLotId(null);
            }
        },
        [claimingNextLotId, myUserId, promptAuth, showToast, t],
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
        if (!myUserId) {
            promptAuth(t('live.viewer.signInToChat') || 'Sign in to join the chat');
            return;
        }
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
                    EMOTE_LOCKED: 'live.viewer.emoteLocked',
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
            if (!myUserId) {
                promptAuth(t('live.viewer.signInToVote') || 'Sign in to vote');
                return;
            }
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

    // Autoplay refused → the very next interaction anywhere on the page
    // (tapping chat, the spot board, a reaction) restores sound, not just a
    // tap on the video. One-shot, and removed as soon as sound is on.
    useEffect(() => {
        if (!audioMuted) return;
        const unmute = () => setAudioMuted(false);
        document.addEventListener('pointerdown', unmute, { once: true });
        return () => document.removeEventListener('pointerdown', unmute);
    }, [audioMuted]);

    // ─── Sticker reactions (ephemeral broadcast; nothing persists) ───
    const { floats: stickerFloats, spawn: spawnSticker, remove: removeSticker } = useFloatingStickers();
    // Reactions also land IN CHAT with the sender's name (the floats alone
    // proved too easy to miss in the field) — see useReactionFeed.
    const { lines: reactionLines, push: pushReaction } = useReactionFeed();

    // The breaker's "now opening" call-out — banner over the video until the
    // next announcement (or a timeout) replaces it.
    const [spotFocus, setSpotFocus] = useState<SpotFocusEvent | null>(null);
    useEffect(() => {
        if (!spotFocus) return;
        const timer = setTimeout(() => setSpotFocus(null), 45000);
        return () => clearTimeout(timer);
    }, [spotFocus]);

    // Auction state pushes patch the lot in place. Stale-push guard: a
    // broadcast can arrive out of order, so an update only applies when it is
    // at least as advanced as what we hold (bid_count monotonic per status).
    const applyAuction = useCallback((lotId: string, auction: LiveAuctionState) => {
        setLots((prev) =>
            prev.map((l) => {
                if (l.id !== lotId) return l;
                if (
                    l.auction &&
                    l.auction.id === auction.id &&
                    l.auction.status === auction.status &&
                    auction.bid_count < l.auction.bid_count
                ) {
                    return l;
                }
                return { ...l, auction_id: auction.id, auction };
            }),
        );
    }, []);

    // The big-moment splash over the video (SOLD, purchases, call-outs).
    const { splash, showSplash } = useEventSplash();

    // Whatnot-style join lines: ephemeral, deduped per session by name.
    const seenJoinsRef = useRef<Set<string>>(new Set());
    const joinIdRef = useRef(0);

    // Track the auction each lot last reported so a state push can tell a
    // FRESH hammer from a refetch of an old one (splash once per sale).
    const splashedAuctionRef = useRef<Set<string>>(new Set());

    useStreamEvents(streamId, pageState === 'ready' && stream?.status === 'live', {
        onSticker: (sticker, from) => {
            spawnSticker(sticker);
            pushReaction(sticker, from);
        },
        onAuction: (lotId, auction) => {
            applyAuction(lotId, auction);
            if (auction.status === 'sold' && !splashedAuctionRef.current.has(auction.id)) {
                splashedAuctionRef.current.add(auction.id);
                showSplash(
                    'auction_sold',
                    `${t('live.auction.sold') || 'SOLD'} ${formatSatang(
                        auction.winning_amount ?? auction.current_price,
                    )}`,
                    auction.winner_name ?? undefined,
                );
            }
            // The hammer hold rides Realtime too, but the winner's checkout
            // bar is the product moment — refetch so it can't be late.
            if (auction.status === 'sold' && auction.winner_id === myUserId) {
                void refetchDetail();
            }
        },
        onSpotFocus: (focus) => {
            setSpotFocus(focus);
            showSplash(
                'now_opening',
                `${t('live.viewer.nowOpening') || 'Now opening'} — ${t('live.viewer.spotWord') || 'Spot'} #${focus.spotNumber}`,
                focus.buyerName ?? undefined,
            );
        },
        onSpotSold: (sold) => {
            showSplash(
                'spot_sold',
                `${t('live.viewer.spotWord') || 'Spot'} #${sold.spotNumber} ${t('live.viewer.soldWord') || 'sold'}`,
                sold.buyerName ?? undefined,
            );
        },
        onViewerJoined: (name) => {
            if (seenJoinsRef.current.has(name)) return;
            seenJoinsRef.current.add(name);
            // Whatnot-style: the join is a PERSISTENT line in the chat
            // scroll, not a 6s toast — synthesized locally, never written
            // to the chat table (reconnects would spam it; the id-merge
            // sweep ignores rows it does not know are missing).
            setChat((prev) => [
                ...prev,
                {
                    id: `join-${joinIdRef.current++}`,
                    stream_id: streamId,
                    sender_id: '',
                    body: name,
                    is_system: false,
                    join: true,
                    created_at: new Date().toISOString(),
                },
            ]);
        },
    });

    const sendSticker = useCallback(
        (sticker: StickerKey) => {
            if (!myUserId) {
                promptAuth(t('live.viewer.signInToReact') || 'Sign in to react');
                return;
            }
            spawnSticker(sticker); // optimistic — the broadcast never echoes back
            pushReaction(sticker, t('live.stickers.you') || 'You');
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
        [streamId, spawnSticker, pushReaction, showToast, t],
    );

    // ─── Live-auction bidding ───
    const [bidBusy, setBidBusy] = useState(false);
    const [customBidThb, setCustomBidThb] = useState('');
    const [showCustomBid, setShowCustomBid] = useState(false);
    // NEEDS_CARD flow: the save-card sheet opens, and the bid that triggered
    // it retries automatically once the card is on file.
    const [cardSheetOpen, setCardSheetOpen] = useState(false);
    const pendingBidRef = useRef<{ lotId: string; amountSatang: number } | null>(null);

    const placeBid = useCallback(
        async (lot: LiveLotRow, amountSatang: number) => {
            if (bidBusy) return;
            if (!myUserId) {
                promptAuth(t('live.viewer.signInToBid') || 'Sign in to bid');
                return;
            }
            setBidBusy(true);
            try {
                const res = await fetch(`/api/live/lots/${lot.id}/auction/bid`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amountSatang }),
                });
                const data = await res.json().catch(() => ({}));
                if (data.auction) applyAuction(lot.id, data.auction as LiveAuctionState);
                if (res.ok && data.accepted === true) {
                    setShowCustomBid(false);
                    setCustomBidThb('');
                    return;
                }
                if (data.code === 'NEEDS_CARD') {
                    pendingBidRef.current = { lotId: lot.id, amountSatang };
                    setCardSheetOpen(true);
                    return;
                }
                let message = t('live.auction.bidError') || 'Could not place your bid';
                if (data.code === 'GEO_RESTRICTED') {
                    message = t('live.viewer.claimGeo') || 'Buying is only available in Thailand for now';
                } else if (data.code === 'RATE_LIMITED') {
                    message = t('live.viewer.rateLimited') || 'Slow down a moment';
                } else if (data.reason === 'below_min') {
                    message = `${t('live.auction.bidTooLow') || 'Bid too low'}${
                        typeof data.min_next_bid === 'number'
                            ? ` — ${formatSatang(data.min_next_bid)}`
                            : ''
                    }`;
                } else if (data.reason === 'ended') {
                    message = t('live.auction.bidEnded') || 'The auction has ended';
                } else if (data.reason === 'suspended') {
                    message = t('live.viewer.claimSuspended') || 'Your account is suspended from buying';
                } else if (data.reason === 'own_auction') {
                    message = t('live.viewer.claimOwnItem') || "You can't bid on your own lot";
                }
                showToast(message, 'error');
            } catch {
                showToast(t('live.auction.bidError') || 'Could not place your bid', 'error');
            } finally {
                setBidBusy(false);
            }
        },
        [bidBusy, applyAuction, showToast, t],
    );

    // Card saved — retry the bid that hit NEEDS_CARD, topped up to the
    // current minimum if the price moved while the sheet was open.
    const onCardSaved = useCallback(() => {
        setCardSheetOpen(false);
        const pending = pendingBidRef.current;
        pendingBidRef.current = null;
        if (!pending) return;
        const lot = lots.find((l) => l.id === pending.lotId);
        if (!lot || lot.auction?.status !== 'live') return;
        void placeBid(lot, Math.max(pending.amountSatang, lot.auction.min_next_bid));
    }, [lots, placeBid]);

    // ─── Derived ───
    // Counts what a buyer can actually tap, not what the DB status column
    // says: a lapsed hold is claimable, so excluding it under-reported the
    // "N left" badge — and a lot whose whole remainder was abandoned holds
    // read as sold out with a claimable board underneath. An auction lot's
    // single spot is the hammer's vehicle, never tappable — count it as 0.
    const openCount =
        activeLot?.item_type === 'auction'
            ? 0
            : activeSpots.filter((s) => isSpotOpenNow(s, now)).length;

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

    // A share link opened without a session: ask for sign-in and reload the
    // show once the modal closes (still signed out -> the CTA reopens it).
    if (pageState === 'auth') {
        return (
            <main className="min-h-screen bg-brand-darker text-white">
                <div className="min-h-[70vh] flex items-center justify-center px-6 text-center">
                    <div className="max-w-md">
                        <i className="fa-solid fa-tower-broadcast text-brand-cyan text-4xl mb-4"></i>
                        <h1 className="text-xl font-bold mb-2">
                            {t('live.viewer.signInToWatch') || 'Sign in to watch this live show'}
                        </h1>
                        <p className="opacity-70 mb-6 text-sm leading-relaxed">
                            {t('live.viewer.signInToWatchDesc') ||
                                'Create a free account or sign in — the show opens right after.'}
                        </p>
                        <button
                            onClick={() => setAuthModalOpen(true)}
                            className="inline-block px-6 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider bg-brand-cyan text-black hover:opacity-90 transition-opacity"
                        >
                            {t('live.viewer.signInCta') || 'Sign in'}
                        </button>
                    </div>
                </div>
                <AuthModal
                    isOpen={authModalOpen}
                    onClose={() => {
                        setAuthModalOpen(false);
                        // Re-run the load: signed in -> the show opens in
                        // place; still signed out -> we land back here.
                        setPageState('loading');
                        setAuthNonce((n) => n + 1);
                    }}
                />
            </main>
        );
    }

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

    const isSellerViewer = !!myUserId && stream.seller_id === myUserId;

    // Formats where the NUMBER is the product — the buyer must see the board
    // and choose (a specific pack, a roster slot). Everything else sells FCFS:
    // the Buy button claims the next available spot server-side, no number
    // hunting.
    const isPickFormat = (lot: LiveLotRow) =>
        lot.item_type === 'pick_your_pack' || lot.item_type === 'character_break';
    const isQuickBuyFormat = (lot: LiveLotRow) =>
        ['personal_break', 'random_pack', 'chase_break', 'pack_wars'].includes(lot.item_type) ||
        (lot.item_type === 'rip_till_hit' && rtyhPricingOf(lot) === 'fixed');

    // ─── Shared blocks (mobile + desktop compose them differently) ───

    // Admins get a quiet secondary action on the board: long-press (or
    // right-click) an OPEN spot to reserve it for the house, or one of their
    // own house-held spots to release it. House spots render exactly like any
    // other sold spot (the admin account's real initials) — the only tell is
    // this hidden gesture. Server-side the routes re-verify the admin role.
    const houseActionFor = (spot: LiveSpotRow): 'reserve' | 'release' | null => {
        if (!isAdmin) return null;
        if (isSpotOpenNow(spot, now)) return 'reserve';
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
    // rip_till_hit sells turns strictly in order: only the next eligible turn
    // is tappable (none at all in auction pricing mode — turns are bid on).
    const spotGrid = (lot: LiveLotRow, lotSpots: LiveSpotRow[]) => {
        const isRtyh = lot.item_type === 'rip_till_hit';
        const rtyhAuction = isRtyh && rtyhPricingOf(lot) === 'auction';
        const eligibleTurnId = isRtyh && !rtyhAuction ? nextTurnSpot(lotSpots, now)?.id ?? null : null;
        return (
        <div className="grid grid-cols-5 gap-2">
            {lotSpots.map((spot) => {
                const mine = spot.held_by === myUserId && spot.status === 'held';
                const soldMine = spot.status === 'sold' && spot.buyer_id === myUserId;
                const flashing = flashSpots.has(spot.id);
                const expired = isHoldLapsed(spot, now);
                const claimable =
                    canBuyLot(lot) &&
                    isSpotOpenNow(spot, now) &&
                    !mine &&
                    (!isRtyh || (!rtyhAuction && spot.id === eligibleTurnId));
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
                        {spot.assigned_entity && (
                            <span
                                title={spot.assigned_entity}
                                className="max-w-full px-0.5 text-[8px] font-bold truncate"
                            >
                                {spot.assigned_entity}
                            </span>
                        )}
                        {spot.hit_note && (
                            <span
                                title={spot.hit_note}
                                className="max-w-full px-0.5 text-[8px] font-black text-amber-300 truncate"
                            >
                                {spot.hit_note}
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
    };

    // Full-width one-tap Buy for the FCFS formats. The numbered grid below it
    // stays for transparency (and the superstitious), but nobody has to use
    // it — and for rip_till_hit it spares the buyer hunting for the one
    // enabled turn cell.
    const quickBuyButton = (lot: LiveLotRow, lotSpots: LiveSpotRow[]) => {
        if (!canBuyLot(lot) || isSellerViewer || !isQuickBuyFormat(lot)) return null;
        const isRtyh = lot.item_type === 'rip_till_hit';
        const nextTurn = isRtyh ? nextTurnSpot(lotSpots, now) : null;
        const soldOut = isRtyh
            ? lotSpots.every((s) => s.status === 'sold' || s.status === 'cancelled')
            : !lotSpots.some((s) => isSpotOpenNow(s, now));
        const priceSatang = (isRtyh ? nextTurn?.price : null) ?? lot.spot_price;
        const busy = claimingNextLotId === lot.id;
        const blocked = isRtyh && !soldOut && !nextTurn;
        const label = soldOut
            ? t('live.viewer.soldOut') || 'Sold out'
            : blocked
                ? t('live.viewer.turnQueueBlocked') || 'Next turn is being paid for'
                : isRtyh
                    ? `${t('live.viewer.buyTurnCta') || 'Buy the next rip'}${
                          nextTurn ? ` · #${nextTurn.spot_number}` : ''
                      }${priceSatang != null ? ` — ${formatSatang(priceSatang)}` : ''}`
                    : `${t('live.viewer.buySpotCta') || 'Buy a spot'}${
                          priceSatang != null ? ` — ${formatSatang(priceSatang)}` : ''
                      }`;
        return (
            <button
                onClick={() => void claimNextSpot(lot)}
                disabled={busy || soldOut || blocked}
                className={`mb-2 w-full h-12 rounded-xl text-xs font-black uppercase active:scale-95 transition-all disabled:opacity-60 ${
                    isThai ? 'tracking-normal' : 'tracking-widest'
                } ${
                    soldOut || blocked
                        ? 'bg-white/10 text-slate-400'
                        : 'bg-brand-cyan text-brand-darker'
                }`}
            >
                {busy ? <i className="fa-solid fa-circle-notch animate-spin"></i> : label}
            </button>
        );
    };

    // ─── Pinned product bar (mobile, Whatnot-style) ───
    // The lot on the block stays visible over the video: art, sold progress,
    // price, and ONE big buy action. Before this the only purchase entry on a
    // phone was the small "Spots" pill next to the chat input. Pick formats
    // route the tap to the board (the number IS the product); FCFS formats
    // buy the next available spot in one tap. Auction lots keep their own
    // quick-bid bar; buy_now lots have no spot rail to sell here.
    const onBlockBar = (() => {
        if (!isLive || !activeLot || isSellerViewer || !canBuyLot(activeLot)) return null;
        if (!isPickFormat(activeLot) && !isQuickBuyFormat(activeLot)) return null;
        const total = activeSpots.length;
        if (total === 0) return null;
        const soldCount = activeSpots.filter((s) => s.status === 'sold').length;
        const isRtyh = activeLot.item_type === 'rip_till_hit';
        const nextTurn = isRtyh ? nextTurnSpot(activeSpots, now) : null;
        const soldOut = isRtyh
            ? activeSpots.every((s) => s.status === 'sold' || s.status === 'cancelled')
            : openCount === 0;
        const blocked = isRtyh && !soldOut && !nextTurn;
        const priceSatang = (isRtyh ? nextTurn?.price : null) ?? activeLot.spot_price;
        const busy = claimingNextLotId === activeLot.id;
        const pick = isPickFormat(activeLot);
        const img = activeLot.card_data?.images?.small || activeLot.card_data?.images?.large;
        return (
            <div className="flex items-center gap-3 rounded-2xl bg-black/70 border border-brand-cyan/30 backdrop-blur-md px-3 py-2.5">
                {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={img}
                        alt=""
                        className="w-10 h-14 rounded-lg object-cover border border-white/10 shrink-0"
                    />
                ) : (
                    <div className="w-10 h-14 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-box-open text-slate-400 text-sm"></i>
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-black text-white leading-tight truncate">
                        {activeLot.card_data?.name || t(`live.types.${activeLot.item_type}`)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-white/15 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-emerald-400 transition-all"
                                style={{ width: `${Math.round((soldCount / total) * 100)}%` }}
                            />
                        </div>
                        <p className="text-[10px] font-black text-slate-300 tabular-nums shrink-0">
                            {(t('live.viewer.soldProgress') || '{sold}/{total} sold')
                                .replace('{sold}', String(soldCount))
                                .replace('{total}', String(total))}
                        </p>
                    </div>
                    {isRtyh && !soldOut && (
                        <p className="mt-0.5 text-[10px] font-bold text-amber-300 truncate">
                            {nextTurn
                                ? `${t('live.viewer.turnWord') || 'Turn'} #${nextTurn.spot_number}`
                                : t('live.viewer.turnQueueBlocked') || 'Next turn is being paid for'}
                        </p>
                    )}
                </div>
                <button
                    onClick={() => {
                        if (soldOut || blocked) return;
                        if (pick) setBoardOpen(true);
                        else void claimNextSpot(activeLot);
                    }}
                    disabled={busy || soldOut || blocked}
                    className={`shrink-0 min-h-12 px-4 rounded-xl text-[11px] font-black uppercase active:scale-95 transition-all disabled:opacity-60 ${
                        isThai ? 'tracking-normal' : 'tracking-wider'
                    } ${
                        soldOut || blocked
                            ? 'bg-white/10 text-slate-400'
                            : 'bg-brand-cyan text-brand-darker'
                    }`}
                >
                    {busy ? (
                        <i className="fa-solid fa-circle-notch animate-spin"></i>
                    ) : soldOut ? (
                        t('live.viewer.soldOut') || 'Sold out'
                    ) : (
                        <span className="flex flex-col items-center leading-tight gap-0.5">
                            <span>
                                {pick
                                    ? t('live.viewer.pickSpotCta') || 'Pick a spot'
                                    : isRtyh
                                        ? t('live.viewer.buyTurnShort') || 'Buy rip'
                                        : t('live.viewer.buyCta') || 'Buy'}
                            </span>
                            {priceSatang != null && (
                                <span className="text-[13px] tabular-nums">
                                    {formatSatang(priceSatang)}
                                </span>
                            )}
                        </span>
                    )}
                </button>
            </div>
        );
    })();

    // Overlay messages get a text shadow — they sit on live video, where the
    // old 12px unshadowed lines were the field test's "can't read the chat".
    // Streamer-pinned line ("bundle deal today...") — stream-level state, so
    // it survives chat scroll and moderation. Arrives/updates through the
    // existing streams postgres_changes subscription; no extra channel.
    const pinnedBanner = stream?.pinned_message ? (
        <div className="flex items-start gap-2 rounded-xl bg-brand-cyan/15 border border-brand-cyan/30 px-3 py-2">
            <i className="fa-solid fa-thumbtack text-brand-cyan text-[11px] mt-0.5"></i>
            <p className="text-[12px] font-bold text-white leading-snug break-words min-w-0">
                {stream.pinned_message}
            </p>
        </div>
    ) : null;

    const chatMessages = (limit?: number) => {
        const visible = limit ? chat.slice(-limit) : chat;
        const shadow = limit ? ' [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]' : '';
        return visible.map((m, i) => {
            const faded = limit ? Math.max(0.45, (i + 1) / visible.length) : 1;
            if (m.join) {
                return (
                    <p
                        key={m.id}
                        style={limit ? { opacity: faded } : undefined}
                        className={`text-[12px] text-slate-400 font-bold py-0.5 px-2 break-words${shadow}`}
                    >
                        {m.body} {t('live.viewer.joined') || 'has joined'}
                    </p>
                );
            }
            if (m.is_system) {
                return (
                    <p
                        key={m.id}
                        style={limit ? { opacity: faded } : undefined}
                        className={`text-[12px] text-amber-300 font-bold text-center py-0.5 px-2 break-words${shadow}`}
                    >
                        {m.body}
                    </p>
                );
            }
            const senderProfile = profiles.get(m.sender_id);
            const senderLevel = senderProfile?.reward_level ?? m.sender_level ?? null;
            const colorKey = senderProfile?.equipped_chat_color ?? m.sender_chat_color ?? null;
            const nameClass = (colorKey && CHAT_COLORS[colorKey]) || 'text-brand-cyan';
            return (
                <p
                    key={m.id}
                    style={limit ? { opacity: faded } : undefined}
                    className={`text-sm leading-snug py-1 px-2 break-words${shadow}`}
                >
                    {typeof senderLevel === 'number' && (
                        <RankChip level={senderLevel} className="mr-1" />
                    )}
                    <span className={`font-black mr-1.5 ${nameClass}`}>
                        {displayName(m.sender_id, m.sender)}
                    </span>
                    <span className="text-white"><ChatBody body={m.body} /></span>
                </p>
            );
        });
    };

    // Level-gated emote tray. Own level comes from the same public_profiles
    // hydration map chat chips use; early-unlocked packs (coin store) come
    // from the rewards summary. Pre-migration both resolve empty and every
    // pack shows locked (the server gate agrees, so nothing can desync).
    const myLevel = myRewards?.level
        ?? ((myUserId ? profiles.get(myUserId)?.reward_level : null) ?? 1);
    const myUnlockedPacks = new Set(
        (myRewards?.owned ?? [])
            .filter((o) => o.key === 'emote_early_unlock')
            .map((o) => String((o.meta as { pack?: string })?.pack ?? ''))
            .filter(Boolean),
    );
    const emoteTray = emoteOpen && myUserId ? (
        <div className="mb-2 rounded-2xl bg-black/80 border border-white/15 backdrop-blur-md p-3 space-y-2.5 max-h-48 overflow-y-auto">
            {EMOTE_PACKS.map((pack) => {
                const unlocked = myLevel >= pack.minLevel || myUnlockedPacks.has(pack.key);
                return (
                    <div key={pack.key}>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                {t(`rewards.emotePack.${pack.key}`)}
                            </span>
                            {!unlocked && (
                                <span className="text-[8px] font-black uppercase rounded bg-white/10 text-slate-500 px-1.5 py-px">
                                    <i className="fa-solid fa-lock mr-1"></i>Lv {pack.minLevel}
                                </span>
                            )}
                        </div>
                        <div className="flex gap-1.5">
                            {pack.emotes.map((key) => (
                                <button
                                    key={key}
                                    onClick={() => {
                                        if (!unlocked) return;
                                        setChatInput((v) => `${v}:${key}: `);
                                    }}
                                    disabled={!unlocked}
                                    aria-label={key}
                                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                                        unlocked
                                            ? 'bg-white/10 hover:bg-white/20 active:scale-90'
                                            : 'bg-white/5 opacity-35'
                                    }`}
                                >
                                    <EmoteIcon emote={key} className="w-5 h-5" />
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    ) : null;

    const chatInputRow = (
        <div>
            {emoteTray}
            <div className="flex items-center gap-2">
                {myUserId && (
                    <button
                        onClick={() => setEmoteOpen((v) => !v)}
                        aria-label={t('rewards.emotePicker')}
                        className={`w-11 h-11 rounded-full border flex items-center justify-center shrink-0 backdrop-blur-sm active:scale-90 transition-all ${
                            emoteOpen
                                ? 'bg-brand-cyan text-brand-darker border-brand-cyan'
                                : 'bg-black/50 border-white/15 text-slate-300'
                        }`}
                    >
                        <i className="fa-regular fa-face-smile text-sm"></i>
                    </button>
                )}
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
                            : !myUserId
                                ? t('live.viewer.signInToChat') || 'Sign in to join the chat'
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
        </div>
    );

    // ─── Live auction panel (replaces the claim grid for auction lots) ───
    const auctionPanel = (lot: LiveLotRow) => {
        const a = lot.auction ?? null;
        if (!a) {
            return (
                <p className="text-xs text-slate-400 text-center py-8 px-4">
                    {t('live.auction.waiting') || 'The auction will start soon'}
                </p>
            );
        }
        const msLeft = Date.parse(a.ends_at) - now;
        const running = a.status === 'live' && msLeft > 0;
        const closing = a.status === 'live' && msLeft <= 0;
        const iAmHigh = !!myUserId && a.high_bidder_id === myUserId;
        const iWon = !!myUserId && a.status === 'sold' && a.winner_id === myUserId;
        const urgent = running && msLeft <= 10_000;

        return (
            <div className="p-4 space-y-3">
                <div className="flex items-end justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                            {a.bid_count > 0
                                ? t('live.auction.currentBid') || 'Current bid'
                                : t('live.auction.startingAt') || 'Starting at'}
                        </p>
                        <p className="text-2xl font-black text-white tabular-nums leading-tight">
                            {formatSatang(a.current_price)}
                        </p>
                        <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                            {a.bid_count}{' '}
                            {t('live.auction.bids') || 'bids'}
                            {a.bid_count > 0 && a.high_bidder_name && !iAmHigh && (
                                <span className="ml-2 text-slate-300">
                                    {t('live.auction.highBidder') || 'High bidder'}:{' '}
                                    {a.high_bidder_name}
                                </span>
                            )}
                        </p>
                    </div>
                    {(running || closing) && (
                        <div
                            className={`px-2.5 py-1.5 rounded-xl border text-center ${
                                urgent
                                    ? 'bg-brand-red/15 border-brand-red/40 text-brand-red'
                                    : 'bg-white/5 border-white/10 text-white'
                            }`}
                        >
                            <p className="text-lg font-black tabular-nums leading-none">
                                {closing
                                    ? t('live.auction.closing') || 'Closing...'
                                    : formatCountdown(msLeft)}
                            </p>
                            {a.extension_count > 0 && running && (
                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-300 mt-1">
                                    {t('live.auction.extended') || 'Extended'} x{a.extension_count}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {iAmHigh && running && (
                    <p className="text-[11px] font-black uppercase tracking-widest text-emerald-300">
                        {t('live.auction.youAreHigh') || "You're the high bidder!"}
                    </p>
                )}

                {running && !isSellerViewer && (
                    <div className="space-y-2">
                        <button
                            onClick={() => void placeBid(lot, a.min_next_bid)}
                            disabled={bidBusy}
                            className="w-full h-12 rounded-xl bg-brand-cyan text-brand-darker text-sm font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
                        >
                            {bidBusy ? (
                                <i className="fa-solid fa-circle-notch animate-spin"></i>
                            ) : (
                                `${t('live.auction.bid') || 'Bid'} ${formatSatang(a.min_next_bid)}`
                            )}
                        </button>
                        {showCustomBid ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    min={Math.ceil(a.min_next_bid / 100)}
                                    value={customBidThb}
                                    onChange={(e) => setCustomBidThb(e.target.value)}
                                    placeholder={`${t('live.auction.customBidMin') || 'Min'} ${formatSatang(a.min_next_bid)}`}
                                    className="flex-1 h-11 rounded-xl bg-black/40 border border-white/15 px-3 text-sm text-white outline-none focus:border-brand-cyan/60"
                                />
                                <button
                                    onClick={() => {
                                        const thb = parseFloat(customBidThb);
                                        if (!Number.isFinite(thb)) return;
                                        void placeBid(lot, Math.round(thb * 100));
                                    }}
                                    disabled={bidBusy || !customBidThb.trim()}
                                    className="px-4 h-11 rounded-xl bg-white/10 text-white text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40"
                                >
                                    {t('live.auction.bid') || 'Bid'}
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowCustomBid(true)}
                                className="w-full text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-200 transition-colors py-1"
                            >
                                {t('live.auction.customBid') || 'Custom bid'}
                            </button>
                        )}
                    </div>
                )}

                {a.status === 'sold' && (
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/30 p-3">
                        <p className="text-xs font-black uppercase tracking-widest text-emerald-300">
                            {t('live.auction.sold') || 'SOLD'}
                            {a.winning_amount != null && ` — ${formatSatang(a.winning_amount)}`}
                        </p>
                        {iWon ? (
                            myHeldSpots.some((s) => s.stream_item_id === lot.id) ? (
                                // Auto-charge fell back to manual checkout —
                                // the hold is the pay window.
                                <>
                                    <p className="text-sm text-white font-bold mt-1 leading-snug">
                                        {t('live.auction.youWon') ||
                                            'You won! Check out now to lock it in.'}
                                    </p>
                                    <button
                                        onClick={() => setPaymentOpen(true)}
                                        className="mt-2 w-full h-11 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                                    >
                                        {t('live.auction.payNow') || 'Pay now'}
                                    </button>
                                </>
                            ) : (
                                <p className="text-sm text-white font-bold mt-1 leading-snug">
                                    {t('live.auction.youWonCharged') ||
                                        'You won! Your saved card covers it — this one is yours.'}
                                </p>
                            )
                        ) : (
                            a.winner_name && (
                                <p className="text-xs text-slate-300 font-bold mt-1">
                                    {t('live.auction.soldTo') || 'Sold to'} {a.winner_name}
                                </p>
                            )
                        )}
                    </div>
                )}
                {a.status === 'unsold' && (
                    <p className="text-xs text-slate-400 font-bold">
                        {t('live.auction.unsold') || 'Ended with no bids'}
                    </p>
                )}
            </div>
        );
    };

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
                            {bulkTiersOf(activeLot.bulk_tiers).map((tier) => (
                                <span
                                    key={tier.qty}
                                    className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[9px] font-black tracking-widest"
                                >
                                    {formatBulkTier(tier)}
                                </span>
                            ))}
                            {activeLot.item_type !== 'auction' && (
                                <span className="text-emerald-300">
                                    {(t('live.viewer.spotsLeftCount') || '{n} left').replace(
                                        '{n}',
                                        String(openCount),
                                    )}
                                </span>
                            )}
                            {activeLot.break_opened_at && (
                                <span className="text-amber-300 uppercase tracking-wider">
                                    {t('live.console.ripped') || 'Ripped'}
                                </span>
                            )}
                        </div>
                    </div>
                    {activeLot.item_type === 'auction' ? (
                        <div className="overflow-y-auto">{auctionPanel(activeLot)}</div>
                    ) : (
                        <div className="p-3 overflow-y-auto">
                            {quickBuyButton(activeLot, activeSpots)}
                            {/* rip_till_hit: whose turn is being ripped, and —
                                in auction pricing mode — the live bid panel
                                for the next turn, above the turn ladder. */}
                            {activeLot.item_type === 'rip_till_hit' && (() => {
                                const ripping = currentTurnSpot(activeSpots);
                                return ripping ? (
                                    <div className="mb-2 flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-400/30 px-3 py-2">
                                        <i className="fa-solid fa-fire text-amber-300 text-xs"></i>
                                        <p className="text-xs font-black text-amber-200 truncate">
                                            {t('live.viewer.rippingNow') || 'Now ripping'}:{' '}
                                            {t('live.viewer.turnWord') || 'Turn'} #{ripping.spot_number}
                                            {ripping.buyer_id &&
                                                ` — ${displayName(ripping.buyer_id)}`}
                                        </p>
                                    </div>
                                ) : null;
                            })()}
                            {activeLot.item_type === 'rip_till_hit' &&
                                rtyhPricingOf(activeLot) === 'auction' &&
                                activeLot.auction?.status === 'live' && (
                                    <div className="mb-2 rounded-xl border border-brand-cyan/30 bg-brand-cyan/5">
                                        {auctionPanel(activeLot)}
                                    </div>
                                )}
                            {spotGrid(activeLot, activeSpots)}
                        </div>
                    )}
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
    // Sign-in sheet for guests, shared by the scheduled landing and the live
    // layout. On close the page reloads its data, so signing in swaps the
    // guest view for the full one in place — nobody loses the show.
    const authSheet = authModalOpen && (
        <AuthModal
            isOpen={authModalOpen}
            contextMessage={authPrompt}
            onClose={() => {
                setAuthModalOpen(false);
                setAuthPrompt(undefined);
                setAuthNonce((n) => n + 1);
            }}
        />
    );

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

    // fullBleed = the mobile phone layout: a solo feed cover-crops to fill the
    // whole screen (Whatnot-style) unless the broadcaster explicitly chose
    // 'Fit'. Desktop keeps the slot defaults. No stats badges here — receive
    // diagnostics are a console (breaker) surface, never a viewer one.
    const videoArea = (fullBleed: boolean) => (
        <div
            // First tap anywhere on the video turns the sound on. That tap IS
            // the user gesture browsers demand before unmuted playback, so it
            // replaces the old floating pill with no loss of function. Once
            // unmuted the handler is inert — tapping never re-mutes, which
            // would be a nasty surprise mid-break.
            onClick={audioMuted ? () => setAudioMuted(false) : undefined}
            className="relative w-full h-full bg-black overflow-hidden">
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
                // Three failed connects = say so. The automatic retry keeps
                // running behind this (capped backoff), the button just skips
                // the wait — a viewer must never be stranded on a silent
                // spinner (2026-08-18 field report).
                !connected && connectAttempt >= 3 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
                        <i className="fa-solid fa-triangle-exclamation text-amber-400 text-2xl mb-3"></i>
                        <p className="text-xs text-slate-300 font-bold">
                            {t('live.viewer.videoTrouble') || 'Having trouble connecting to the video'}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                            {t('live.viewer.videoTroubleDesc') || 'Retrying automatically — chat and the board still work'}
                        </p>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setConnectAttempt(0);
                            }}
                            className="mt-4 px-4 py-2 rounded-full bg-brand-cyan text-slate-950 text-xs font-bold active:scale-95 transition-transform"
                        >
                            {t('live.viewer.retryNow') || 'Retry now'}
                        </button>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-xl mb-3"></i>
                        <p className="text-xs text-slate-400">
                            {t('live.viewer.waitingVideo') || 'Waiting for video...'}
                        </p>
                    </div>
                )
            ) : feedCount === 1 ? (
                <CroppedTrackVideo
                    track={mainTrack ?? tableTrack}
                    crop={cropFor(mainTrack ? 'main' : 'table')}
                    slot={mainTrack ? 'main' : 'table'}
                    defaultFit={fullBleed ? 'cover' : undefined}
                    className="absolute inset-0"
                />
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
                    </div>
                </div>
            )}

            {/* Remote audio (main cam mic). Starts muted because browsers
                refuse to autoplay audio without a user gesture — but the
                gesture is now a tap ANYWHERE on the video (see the container's
                onClick) rather than a floating "Tap for sound" pill, which
                collided with the header and cluttered the frame. */}
            {remoteFeeds.audio.map((track, i) => (
                <TrackAudio
                    key={track.sid ?? i}
                    track={track}
                    muted={audioMuted}
                    onBlocked={() => setAudioMuted(true)}
                />
            ))}

            {/* The breaker's "now opening" call-out — the on-video moment of
                the announce-spot flow, so the buyer whose spot is up feels it
                without reading chat. */}
            <AnimatePresence>
                {isLive && spotFocus && (
                    <motion.div
                        key={`${spotFocus.lotId}-${spotFocus.spotNumber}-${spotFocus.at}`}
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        className="absolute top-[calc(var(--sat)+4.25rem)] inset-x-0 z-20 flex justify-center pointer-events-none px-4"
                    >
                        <div className="rounded-2xl bg-black/70 border border-brand-cyan/40 backdrop-blur-sm px-4 py-2.5 text-center max-w-full">
                            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-brand-cyan">
                                {t('live.viewer.nowOpening') || 'Now opening'}
                            </p>
                            <p className="text-base font-black text-white leading-snug truncate">
                                {t('live.viewer.spotWord') || 'Spot'} #{spotFocus.spotNumber}
                                {spotFocus.buyerName ? ` — ${spotFocus.buyerName}` : ''}
                            </p>
                            {(spotFocus.entity || (spotFocus.packs && spotFocus.packs.length > 0)) && (
                                <p className="text-[11px] font-bold text-slate-300 truncate">
                                    {spotFocus.entity ??
                                        `${t('live.viewer.packsWord') || 'Packs'} ${spotFocus.packs!.join(', ')}`}
                                </p>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Sticker floats. videoArea renders twice (mobile + desktop
                trees), both layers share one float list — the hidden twin
                never animates, and the hook's sweep reaps on its behalf. */}
            <FloatingStickerLayer floats={stickerFloats} onDone={removeSticker} />

            {/* Big-moment splash (SOLD / purchase / call-out). */}
            <EventSplashLayer splash={splash} />
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
                    {/* Get notified: the one action for a visitor who isn't
                        buying a presale spot. Alerts land at go-live as email
                        AND push, so a web visitor with no app is reachable.
                        Thai drops the tracking for the same reason as the
                        presale pill below. */}
                    <button
                        onClick={() => void toggleReminder()}
                        disabled={reminderBusy}
                        aria-pressed={reminderSet}
                        className={`mt-5 inline-flex items-center gap-2 px-5 h-11 rounded-xl text-xs font-black uppercase transition-all active:scale-95 disabled:opacity-60 ${
                            isThai ? 'tracking-normal' : 'tracking-widest'
                        } ${
                            reminderSet
                                ? 'bg-white/10 border border-brand-cyan/40 text-brand-cyan'
                                : 'bg-brand-cyan text-brand-darker'
                        }`}
                    >
                        <i className={`fa-solid ${reminderSet ? 'fa-bell-slash' : 'fa-bell'}`}></i>
                        {reminderSet
                            ? t('live.scheduled.remindCancel') || "You'll be notified — tap to cancel"
                            : t('live.scheduled.remindMe') || 'Get notified'}
                    </button>

                    {/* The Thai line is ~40px wider than the English; at
                        tracking-widest it wraps the pill onto two lines on a
                        360px phone. Thai gets no extra tracking — it also keeps
                        tone marks visually attached to their base. */}
                    {presaleOpen && (
                        <p
                            className={`mt-4 inline-block px-3 py-1.5 rounded-full bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-[11px] font-black uppercase ${
                                isThai ? 'tracking-normal' : 'tracking-widest'
                            }`}
                        >
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
                            const open = lotSpots.filter((s) => isSpotOpenNow(s, now)).length;
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
                                            {bulkTiersOf(lot.bulk_tiers).map((tier) => (
                                                <span
                                                    key={tier.qty}
                                                    className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[9px] font-black tracking-widest"
                                                >
                                                    {formatBulkTier(tier)}
                                                </span>
                                            ))}
                                            {presale && (
                                                <span className="text-emerald-300">
                                                    {(
                                                        t('live.viewer.spotsLeftCount') || '{n} left'
                                                    ).replace('{n}', String(open))}
                                                </span>
                                            )}
                                            {sold > 0 && (
                                                <span>
                                                    {(
                                                        t('live.scheduled.soldCount') || '{n} sold'
                                                    ).replace('{n}', String(sold))}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {presale ? (
                                        <div className="p-3">
                                            {quickBuyButton(lot, lotSpots)}
                                            {spotGrid(lot, lotSpots)}
                                        </div>
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
                {authSheet}
            </main>
        );
    }

    return (
        <main className="h-[100dvh] bg-brand-darker text-white overflow-hidden">
            {/* ─── Mobile: full-bleed video with overlays ─── */}
            <div className="relative h-full lg:hidden">
                {videoArea(true)}

                {/* Sits immediately under the system status bar — --sat alone,
                    no extra padding. The old +0.5rem pushed the whole cluster
                    (back, shop, LIVE, viewers, share) visibly down the frame. */}
                <div className="absolute top-0 inset-x-0 pt-[var(--sat)] px-3 bg-gradient-to-b from-black/70 to-transparent pb-5 pointer-events-none">
                    <div className="pointer-events-auto">{header}</div>
                </div>

                {/* Chat overlay + input + held bar over the lower feed */}
                <div className="absolute bottom-0 inset-x-0 pb-[calc(var(--sab)+0.75rem)] px-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10">
                    {pinnedBanner && <div className="mb-2">{pinnedBanner}</div>}
                    {pollCard && <div className="mb-2">{pollCard}</div>}
                    <div className="mb-2 max-h-[42vh] overflow-hidden flex flex-col justify-end [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                        {chatMessages(CHAT_OVERLAY_COUNT)}
                        <ReactionFeedLines
                            lines={reactionLines}
                            anonymousLabel={t('live.stickers.someone') || 'Someone'}
                        />
                    </div>
                    {/* Live-auction quick bid — the primary interaction rides
                        inline; sheets are too slow for a 30s clock. Serves
                        whole-lot auctions AND rip_till_hit auctioned turns. */}
                    {isLive &&
                        (activeLot?.item_type === 'auction' ||
                            (activeLot?.item_type === 'rip_till_hit' &&
                                rtyhPricingOf(activeLot) === 'auction')) &&
                        activeLot.auction?.status === 'live' &&
                        !isSellerViewer && (
                            <div className="mb-2 flex items-center gap-2 rounded-2xl bg-black/60 border border-white/15 backdrop-blur-sm px-3 py-2">
                                <div className="flex-1 min-w-0">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                                        {activeLot.auction.bid_count > 0
                                            ? t('live.auction.currentBid') || 'Current bid'
                                            : t('live.auction.startingAt') || 'Starting at'}
                                    </p>
                                    <p className="text-base font-black text-white tabular-nums leading-tight">
                                        {formatSatang(activeLot.auction.current_price)}
                                        <span
                                            className={`ml-2 text-sm ${
                                                Date.parse(activeLot.auction.ends_at) - now <= 10_000
                                                    ? 'text-brand-red'
                                                    : 'text-slate-300'
                                            }`}
                                        >
                                            {Date.parse(activeLot.auction.ends_at) - now > 0
                                                ? formatCountdown(Date.parse(activeLot.auction.ends_at) - now)
                                                : t('live.auction.closing') || 'Closing...'}
                                        </span>
                                    </p>
                                </div>
                                <button
                                    onClick={() => void placeBid(activeLot, activeLot.auction!.min_next_bid)}
                                    disabled={bidBusy || Date.parse(activeLot.auction.ends_at) - now <= 0}
                                    className="px-4 h-11 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
                                >
                                    {bidBusy ? (
                                        <i className="fa-solid fa-circle-notch animate-spin"></i>
                                    ) : (
                                        `${t('live.auction.bid') || 'Bid'} ${formatSatang(activeLot.auction.min_next_bid)}`
                                    )}
                                </button>
                            </div>
                        )}
                    {activeLot?.auction?.status === 'live' &&
                        activeLot.auction.high_bidder_id === myUserId && (
                            <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-emerald-300 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                                {t('live.auction.youAreHigh') || "You're the high bidder!"}
                            </p>
                        )}
                    {onBlockBar && <div className="mb-2">{onBlockBar}</div>}
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
                    {/* Phone-aspect stage: desktop renders EXACTLY the framing a phone
                        viewer gets (same fullBleed cover semantics), centered on a dark
                        stage. Before this, the same feed was fit into a LANDSCAPE box,
                        so a broadcaster fill/crop choice that looked right on phones
                        cover-cropped desktop to ~38% of the frame (measured live
                        2026-08-22: 720x1280 feed in a 997x682 box) — the seller was
                        framing against a surface no phone viewer saw. One framing
                        everywhere means the console manages ONE field of view. */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black">
                        <div
                            className="relative h-full max-w-full"
                            style={{ aspectRatio: '9 / 16' }}
                        >
                            {videoArea(true)}
                        </div>
                    </div>
                    <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-black/70 to-transparent pb-8">
                        {header}
                    </div>
                </div>
                <div className="w-[400px] border-l border-white/10 bg-slate-950/60 flex flex-col">
                    <div className="border-b border-white/5 max-h-[45%] overflow-y-auto">{spotBoard}</div>
                    {pollCard && <div className="px-3 pt-3">{pollCard}</div>}
                    {heldBar && <div className="px-3 pt-3">{heldBar}</div>}
                    <div className="flex-1 overflow-y-auto py-2 flex flex-col justify-end">
                        {pinnedBanner && <div className="px-2 pt-2">{pinnedBanner}</div>}
                        {chatMessages()}
                        <ReactionFeedLines
                            lines={reactionLines}
                            anonymousLabel={t('live.stickers.someone') || 'Someone'}
                        />
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

            {authSheet}

            {/* Save-a-card sheet (NEEDS_CARD) — the pending bid retries on save. */}
            {cardSheetOpen && (
                <div className="fixed inset-0 z-[70] flex items-end lg:items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/70"
                        onClick={() => {
                            pendingBidRef.current = null;
                            setCardSheetOpen(false);
                        }}
                    />
                    <div className="relative w-full max-w-md rounded-t-3xl lg:rounded-2xl bg-slate-900 border border-white/10 p-5 pb-[calc(var(--sab)+1.25rem)] lg:m-4 lg:pb-5">
                        <AddCardToBid
                            onSaved={onCardSaved}
                            onCancel={() => {
                                pendingBidRef.current = null;
                                setCardSheetOpen(false);
                            }}
                        />
                    </div>
                </div>
            )}

            {houseSheet}
        </main>
    );
}
