'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { createClient } from '@/lib/supabase/client';
import { useLiveKitRoom } from '@/lib/hooks/useLiveKitRoom';
import { TrackVideo } from '@/components/live/TrackVideo';
import {
    formatSatang,
    isNativeShell,
    type LiveChatMessage,
    type LiveLotRow,
    type LiveSpotRow,
    type LiveStreamRow,
} from '@/components/live/shared';

/**
 * The broadcaster CONSOLE (desktop-first, phone-usable): camera + go-live,
 * the table-cam QR handoff, the lot queue, the spot board, and moderated chat.
 *
 * Table-cam token rides the URL FRAGMENT of the QR link (never the query
 * string) — fragments don't leave the browser, so the bearer token stays out
 * of server/proxy logs. The token is short-lived and dies with the room.
 *
 * Chat here POLLS (5s) in addition to Realtime: the chat SELECT policy needs
 * the 'live_streams' grant, and a host may hold only 'live_broadcast' — the
 * API route lets them through, RLS-gated Realtime would not.
 */

type PageState = 'loading' | 'denied' | 'ready';

const BREAK_TYPES = [
    'personal_break',
    'pick_your_pack',
    'random_pack',
    'chase_break',
    'pack_wars',
] as const;
type BreakType = (typeof BREAK_TYPES)[number];

const PRODUCT_TYPES = ['box', 'pack', 'other'] as const;

type CameraIssue = 'denied' | 'notfound' | 'other';

/** Map a getUserMedia failure to a message the seller can act on. */
function classifyCameraError(err: unknown): CameraIssue {
    const name = (err as { name?: string } | null)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        return 'denied';
    }
    if (
        name === 'NotFoundError' ||
        name === 'DevicesNotFoundError' ||
        name === 'OverconstrainedError'
    ) {
        return 'notfound';
    }
    return 'other';
}

interface ConfirmState {
    message: string;
    confirmLabel: string;
    run: () => Promise<void>;
    /** chase_break hit input is collected inside the dialog. */
    withHitInput?: boolean;
}

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

export default function BroadcastConsolePage() {
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

    const [goingLive, setGoingLive] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmState | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [hitText, setHitText] = useState('');
    // The lot a hit-assignment confirm targets (the dialog collects the hit
    // text, so the run needs to know which lot it was opened for).
    const confirmLotRef = useRef<LiveLotRow | null>(null);
    const [randomizeResult, setRandomizeResult] = useState<{ seed: string; summary: string } | null>(
        null,
    );
    const [tableQr, setTableQr] = useState<string | null>(null);
    const [settleResult, setSettleResult] = useState<number | null>(null);
    const [chatInput, setChatInput] = useState('');
    const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

    // Add-lot form.
    const [showAddLot, setShowAddLot] = useState(false);
    const [lotName, setLotName] = useState('');
    const [lotType, setLotType] = useState<BreakType>('random_pack');
    const [lotSpots, setLotSpots] = useState('10');
    const [lotPriceThb, setLotPriceThb] = useState('100');
    const [lotPacks, setLotPacks] = useState('1');
    const [lotProductType, setLotProductType] = useState<(typeof PRODUCT_TYPES)[number]>('box');
    const [creatingLot, setCreatingLot] = useState(false);

    const supabaseRef = useRef(createClient());
    const {
        connect,
        connected,
        publishCamera,
        startPreview,
        stopPreview,
        localVideo,
        participantCount,
        disconnect,
    } = useLiveKitRoom();

    // Native Capacitor shell: the binary carries no camera permission, so
    // broadcasting is browser-only. Resolved in an effect so SSR and the
    // first client paint agree (same pattern as PremiumHub).
    const [isNativeApp, setIsNativeApp] = useState(false);
    useEffect(() => { setIsNativeApp(isNativeShell()); }, []);

    const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);
    const [previewStarting, setPreviewStarting] = useState(false);

    const cameraIssueText = useCallback(
        (issue: CameraIssue): string => {
            if (issue === 'denied') {
                return (
                    t('live.console.cameraDenied') ||
                    'Camera permission denied — allow camera access in your browser and retry'
                );
            }
            if (issue === 'notfound') {
                return t('live.console.noCameraFound') || 'No camera found — connect one and retry';
            }
            return t('live.console.cameraError') || 'Could not access the camera';
        },
        [t],
    );

    // ─── Load ───
    const loadDetail = useCallback(async () => {
        const res = await fetch(`/api/live/streams/${streamId}`);
        if (!res.ok) {
            setPageState('denied');
            return null;
        }
        const data = await res.json();
        setStream(data.stream);
        setLots((data.items ?? []).sort((a: LiveLotRow, b: LiveLotRow) => a.position - b.position));
        setSpots(data.spots ?? []);
        setPageState('ready');
        return data.stream as LiveStreamRow;
    }, [streamId]);

    useEffect(() => {
        if (!streamId) return;
        void loadDetail();
    }, [streamId, loadDetail]);

    // Tolerant re-sync used after a Realtime gap (backgrounded WebView,
    // channel error). Unlike loadDetail it never flips pageState — a
    // transient failure mid-show must not 404 the console.
    const refetchDetail = useCallback(async () => {
        try {
            const res = await fetch(`/api/live/streams/${streamId}`);
            if (!res.ok) return;
            const data = await res.json();
            setStream(data.stream);
            setLots((data.items ?? []).sort((a: LiveLotRow, b: LiveLotRow) => a.position - b.position));
            setSpots(data.spots ?? []);
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

    // Bumped to tear down + rebuild the Realtime channel after an error.
    const [realtimeNonce, setRealtimeNonce] = useState(0);

    // ─── Chat: poll + realtime (see header comment) ───
    const loadChat = useCallback(async () => {
        try {
            const res = await fetch(`/api/live/streams/${streamId}/chat`);
            if (!res.ok) return;
            const data = await res.json();
            setChat((prev) => {
                const merged = new Map<string, LiveChatMessage>(prev.map((m) => [m.id, m]));
                for (const m of data.messages ?? []) merged.set(m.id, m);
                return [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
            });
        } catch {
            // Poll again next tick.
        }
    }, [streamId]);

    useEffect(() => {
        if (pageState !== 'ready') return;
        void loadChat();
        const timer = setInterval(() => void loadChat(), 5000);
        return () => clearInterval(timer);
    }, [pageState, loadChat]);

    // ─── Realtime on spots / lots / stream (seller-visible under RLS) ───
    useEffect(() => {
        if (pageState !== 'ready' || !streamId) return;
        const supabase = supabaseRef.current;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        const channel = supabase
            .channel(`live-console-${streamId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'break_spots', filter: `stream_id=eq.${streamId}` },
                (payload) => {
                    const row = payload.new as LiveSpotRow;
                    if (!row?.id) return;
                    setSpots((prev) => {
                        const idx = prev.findIndex((s) => s.id === row.id);
                        if (idx === -1) return [...prev, row];
                        const next = [...prev];
                        next[idx] = { ...next[idx], ...row };
                        return next;
                    });
                },
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'stream_items', filter: `stream_id=eq.${streamId}` },
                (payload) => {
                    const row = payload.new as LiveLotRow;
                    if (!row?.id) return;
                    setLots((prev) => {
                        const idx = prev.findIndex((l) => l.id === row.id);
                        const next = idx === -1 ? [...prev, row] : prev.map((l) => (l.id === row.id ? { ...l, ...row } : l));
                        return next.sort((a, b) => a.position - b.position);
                    });
                },
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'streams', filter: `id=eq.${streamId}` },
                (payload) => setStream((prev) => (prev ? { ...prev, ...(payload.new as LiveStreamRow) } : prev)),
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

    // ─── Camera preview (before go-live) ───
    // The camera is requested the moment the console is usable so the seller
    // sees themselves and resolves the permission prompt EARLY — not in the
    // middle of pressing Go live. Skipped in the native app (no camera
    // permission in the binary) and once the show has ended.
    const beginPreview = useCallback(async () => {
        if (previewStarting) return;
        setPreviewStarting(true);
        try {
            await startPreview({ facingMode: 'user', audio: true });
            setCameraIssue(null);
        } catch (err) {
            setCameraIssue(classifyCameraError(err));
        } finally {
            setPreviewStarting(false);
        }
    }, [previewStarting, startPreview]);

    useEffect(() => {
        if (pageState !== 'ready' || isNativeApp) return;
        const status = stream?.status;
        if (!status || status === 'ended' || status === 'cancelled') return;
        void beginPreview();
        // localVideo/connected are deliberately not deps: the hook no-ops when
        // a preview or room already owns the camera, and a denied prompt must
        // not re-fire on every render — retry is the seller's button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageState, isNativeApp, stream?.status]);

    // The show ending (locally or via realtime) releases the previewed camera.
    useEffect(() => {
        if (stream?.status === 'ended' || stream?.status === 'cancelled') stopPreview();
    }, [stream?.status, stopPreview]);

    // In-app broadcasters copy the console URL and reopen it in Chrome.
    const copyConsoleLink = useCallback(async () => {
        const link = `${window.location.origin}/live/broadcast/${streamId}`;
        try {
            await navigator.clipboard.writeText(link);
            showToast(t('live.console.linkCopied') || 'Link copied', 'success');
        } catch {
            showToast(t('live.console.copyError') || 'Could not copy the link', 'error');
        }
    }, [streamId, showToast, t]);

    // ─── Go live (also the resume-camera path when already live) ───
    const goLive = useCallback(async () => {
        if (goingLive) return;
        setGoingLive(true);
        try {
            const res = await fetch(`/api/live/streams/${streamId}/go-live`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.token) {
                showToast(data.error || t('live.console.goLiveError') || 'Could not go live', 'error');
                return;
            }
            if (!data.url) {
                showToast(t('live.console.goLiveError') || 'Could not go live', 'error');
                return;
            }
            setStream((prev) => (prev ? { ...prev, status: 'live' } : prev));
            await connect(data.url, data.token);
            try {
                // Adopts the preview's tracks when they're up (no re-prompt).
                await publishCamera({ facingMode: 'user', audio: true });
                setCameraIssue(null);
            } catch (err) {
                const issue = classifyCameraError(err);
                setCameraIssue(issue);
                showToast(cameraIssueText(issue), 'error');
            }
        } catch {
            showToast(t('live.console.goLiveError') || 'Could not go live', 'error');
        } finally {
            setGoingLive(false);
        }
    }, [goingLive, streamId, connect, publishCamera, cameraIssueText, showToast, t]);

    // Camera-only retry for the live-but-not-publishing state (publishCamera
    // failed after go-live, e.g. a denied permission the seller then granted).
    // The Go live button is disabled once live + connected, so without this
    // the seller would be stuck broadcasting a black screen.
    const [retryingCamera, setRetryingCamera] = useState(false);
    const retryCamera = useCallback(async () => {
        if (retryingCamera) return;
        setRetryingCamera(true);
        try {
            await publishCamera({ facingMode: 'user', audio: true });
            setCameraIssue(null);
        } catch (err) {
            const issue = classifyCameraError(err);
            setCameraIssue(issue);
            showToast(cameraIssueText(issue), 'error');
        } finally {
            setRetryingCamera(false);
        }
    }, [retryingCamera, publishCamera, cameraIssueText, showToast]);

    // ─── Table-cam QR ───
    const openTableQr = useCallback(async () => {
        try {
            const res = await fetch(`/api/live/streams/${streamId}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'table_cam' }),
            });
            const data = await res.json();
            if (!res.ok || !data.token || !data.url) {
                showToast(
                    data.error || t('live.console.tableCamError') || 'Could not create the table-cam link',
                    'error',
                );
                return;
            }
            // Token + wss URL in the FRAGMENT — see the file header for why.
            const link = `${window.location.origin}/live/cam/${streamId}#t=${encodeURIComponent(
                data.token,
            )}&u=${encodeURIComponent(data.url)}`;
            const dataUrl = await QRCode.toDataURL(link, { width: 480, margin: 1 });
            setTableQr(dataUrl);
        } catch {
            showToast(t('live.console.tableCamError') || 'Could not create the table-cam link', 'error');
        }
    }, [streamId, showToast, t]);

    // ─── Lots ───
    const createLot = useCallback(async () => {
        if (creatingLot) return;
        const spotsTotal = lotType === 'personal_break' ? 1 : parseInt(lotSpots, 10);
        const priceThb = parseFloat(lotPriceThb);
        const packs = parseInt(lotPacks, 10);
        if (!lotName.trim() || !Number.isFinite(priceThb) || priceThb < 1) return;
        setCreatingLot(true);
        try {
            const res = await fetch(`/api/live/streams/${streamId}/lots`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemType: lotType,
                    spotsTotal,
                    spotPrice: Math.round(priceThb * 100),
                    packsPerSpot: Number.isFinite(packs) && packs > 0 ? packs : 1,
                    cardData: { name: lotName.trim(), isSealed: true, productType: lotProductType },
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showToast(data.error || t('live.console.createLotError') || 'Could not create the lot', 'error');
                return;
            }
            setLotName('');
            setShowAddLot(false);
            await loadDetail();
        } catch {
            showToast(t('live.console.createLotError') || 'Could not create the lot', 'error');
        } finally {
            setCreatingLot(false);
        }
    }, [creatingLot, lotType, lotSpots, lotPriceThb, lotPacks, lotName, lotProductType, streamId, loadDetail, showToast, t]);

    const patchLot = useCallback(
        async (lotId: string, body: Record<string, unknown>) => {
            try {
                const res = await fetch(`/api/live/lots/${lotId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    showToast(data.error || t('live.console.updateError') || 'Could not update the lot', 'error');
                    return false;
                }
                if (data.lot) {
                    setLots((prev) =>
                        prev
                            .map((l) => (l.id === data.lot.id ? { ...l, ...data.lot } : l))
                            .sort((a, b) => a.position - b.position),
                    );
                }
                return true;
            } catch {
                showToast(t('live.console.updateError') || 'Could not update the lot', 'error');
                return false;
            }
        },
        [showToast, t],
    );

    const moveLot = useCallback(
        async (lot: LiveLotRow, dir: -1 | 1) => {
            const ordered = lots.filter((l) => l.status === 'queued' || l.status === 'active');
            const idx = ordered.findIndex((l) => l.id === lot.id);
            const neighbor = ordered[idx + dir];
            if (!neighbor) return;
            // Swap positions — two PATCHes; realtime/local patches reconcile.
            await patchLot(lot.id, { position: neighbor.position });
            await patchLot(neighbor.id, { position: lot.position });
        },
        [lots, patchLot],
    );

    const deleteLot = useCallback(
        async (lotId: string) => {
            try {
                const res = await fetch(`/api/live/lots/${lotId}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    showToast(data.error || t('live.console.updateError') || 'Could not update the lot', 'error');
                    return;
                }
                setLots((prev) => prev.filter((l) => l.id !== lotId));
                setSpots((prev) => prev.filter((s) => s.stream_item_id !== lotId));
            } catch {
                showToast(t('live.console.updateError') || 'Could not update the lot', 'error');
            }
        },
        [showToast, t],
    );

    // ─── Randomizer (always behind the confirm dialog) ───
    const runRandomizer = useCallback(
        async (lot: LiveLotRow, purpose: 'spot_to_pack' | 'hit_assignment', hit?: string) => {
            const res = await fetch(`/api/live/lots/${lot.id}/randomize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(purpose === 'hit_assignment' ? { purpose, hit } : { purpose }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showToast(data.error || t('live.console.updateError') || 'Randomization failed', 'error');
                return;
            }
            const summary =
                purpose === 'hit_assignment'
                    ? `${data.assignments?.hit ?? ''} -> #${data.assignments?.spot ?? '?'}`
                    : (data.assignments ?? [])
                          .map((a: { spot: number; packs: number[] }) => `#${a.spot}:${a.packs.join(',')}`)
                          .join('  ');
            setRandomizeResult({ seed: data.seed, summary });
        },
        [showToast, t],
    );

    // ─── End + settle ───
    const endShow = useCallback(async () => {
        const res = await fetch(`/api/live/streams/${streamId}/end`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.error || t('live.console.endError') || 'Could not end the show', 'error');
            return;
        }
        setStream((prev) => (prev ? { ...prev, status: 'ended' } : prev));
        await disconnect();
    }, [streamId, disconnect, showToast, t]);

    const settleShow = useCallback(async () => {
        const res = await fetch(`/api/live/streams/${streamId}/settle`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || t('live.console.settleError') || 'Settlement failed', 'error');
            return;
        }
        setSettleResult((data.shipments ?? []).length);
        if (Array.isArray(data.errors) && data.errors.length > 0) {
            showToast(t('live.console.settleError') || 'Settlement failed', 'error');
        }
    }, [streamId, showToast, t]);

    // ─── Chat send + moderation ───
    const sendChat = useCallback(async () => {
        const body = chatInput.trim();
        if (!body) return;
        try {
            const res = await fetch(`/api/live/streams/${streamId}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || t('live.viewer.sendError') || 'Message not sent', 'error');
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
        }
    }, [chatInput, streamId, showToast, t]);

    const moderate = useCallback(
        async (body: Record<string, unknown>) => {
            try {
                const res = await fetch(`/api/live/streams/${streamId}/moderate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    showToast(data.error || t('live.console.moderateError') || 'Moderation action failed', 'error');
                    return;
                }
                if (body.action === 'delete_message') {
                    setChat((prev) => prev.filter((m) => m.id !== body.messageId));
                }
                if (body.action === 'chat_toggle') {
                    setStream((prev) => (prev ? { ...prev, chat_disabled: data.chatDisabled } : prev));
                }
            } catch {
                showToast(t('live.console.moderateError') || 'Moderation action failed', 'error');
            }
        },
        [streamId, showToast, t],
    );

    // ─── Derived ───
    const focusedLot = useMemo(
        () =>
            lots.find((l) => l.id === selectedLotId) ??
            lots.find((l) => l.status === 'active') ??
            null,
        [lots, selectedLotId],
    );
    const focusedSpots = useMemo(
        () =>
            focusedLot
                ? spots
                      .filter((s) => s.stream_item_id === focusedLot.id)
                      .sort((a, b) => a.spot_number - b.spot_number)
                : [],
        [spots, focusedLot],
    );
    const soldSpots = spots.filter((s) => s.status === 'sold');
    const revenueSatang = soldSpots.reduce((sum, s) => sum + s.price, 0);

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
    const isEnded = stream.status === 'ended';

    const sectionCls = 'glass rounded-2xl border-white/10 p-4';
    const btnPrimary =
        'px-4 h-10 rounded-xl bg-brand-cyan text-brand-darker text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40';
    const btnGhost =
        'px-3 h-9 rounded-lg bg-white/10 text-slate-200 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-40';
    const inputCls =
        'w-full h-10 rounded-xl bg-black/30 border border-white/10 px-3 text-sm text-white outline-none focus:border-brand-cyan/50';

    return (
        <main className="min-h-screen bg-brand-darker text-white px-4 pb-16 pt-[calc(var(--sat)+1.5rem)]">
            <div className="max-w-6xl mx-auto">
                {/* ─── Header ─── */}
                <div className="flex flex-wrap items-center gap-3 mb-5">
                    <button
                        onClick={() => router.push('/live')}
                        aria-label={t('live.common.back')}
                        className="inline-flex w-10 h-10 rounded-xl glass border-white/10 items-center justify-center active:scale-90 transition-all"
                    >
                        <i className="fa-solid fa-chevron-left text-slate-400 text-sm"></i>
                    </button>
                    <div className="min-w-0">
                        <h1 className="text-lg font-black tracking-tight truncate">{stream.title}</h1>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            {t('live.console.title') || 'Broadcast console'}
                        </p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        {isLive ? (
                            <span className="px-2.5 py-1 rounded-md bg-brand-red text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                {t('live.console.live') || 'LIVE'}
                                {connected && (
                                    <span className="ml-1">
                                        · {participantCount} {t('live.console.viewers') || 'watching'}
                                    </span>
                                )}
                            </span>
                        ) : (
                            <span className="px-2.5 py-1 rounded-md bg-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest">
                                {isEnded
                                    ? t('live.viewer.ended') || 'Show ended'
                                    : t('live.console.notLiveYet') || 'Not live yet'}
                            </span>
                        )}
                        {!isEnded && (
                            <button onClick={() => void goLive()} disabled={goingLive || (isLive && connected)} className={btnPrimary}>
                                {goingLive
                                    ? t('live.console.goingLive') || 'Starting...'
                                    : t('live.console.goLive') || 'Go live'}
                            </button>
                        )}
                        {isLive && (
                            <button
                                onClick={() =>
                                    setConfirm({
                                        message: t('live.console.confirmEnd') || 'End the show for everyone?',
                                        confirmLabel: t('live.console.endShow') || 'End show',
                                        run: endShow,
                                    })
                                }
                                className="px-4 h-10 rounded-xl bg-brand-red/80 text-white text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                            >
                                {t('live.console.endShow') || 'End show'}
                            </button>
                        )}
                        {isEnded && !stream.settled_at && (
                            <button
                                onClick={() =>
                                    setConfirm({
                                        message:
                                            t('live.console.confirmSettle') ||
                                            'Group all paid spots into one parcel per buyer?',
                                        confirmLabel: t('live.console.settle') || 'Settle shipments',
                                        run: settleShow,
                                    })
                                }
                                className={btnPrimary}
                            >
                                {t('live.console.settle') || 'Settle shipments'}
                            </button>
                        )}
                    </div>
                </div>

                {settleResult != null && (
                    <div className="mb-4 glass rounded-2xl border-brand-green/30 p-4 text-sm text-brand-green font-bold">
                        {t('live.console.settleDone') || 'Settlement complete'} — {settleResult}{' '}
                        {t('live.console.shipmentsCreated') || 'shipments created'}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* ─── Column 1: camera + table cam + stats ─── */}
                    <div className="space-y-4">
                        <div className={sectionCls}>
                            <div className="relative aspect-[9/12] bg-black rounded-xl overflow-hidden">
                                {isNativeApp && !isEnded ? (
                                    /* The binary has no camera permission — a dead
                                       viewfinder here would read as a bug. Hand off
                                       to a real browser instead. */
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5">
                                        <i className="fa-solid fa-arrow-up-right-from-square text-brand-cyan text-2xl mb-3"></i>
                                        <p className="text-sm font-bold text-white leading-snug">
                                            {t('live.console.inAppTitle') ||
                                                "Broadcasting from the app isn't available yet"}
                                        </p>
                                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                                            {t('live.console.inAppDesc') ||
                                                "Open this show's console in Chrome to broadcast. Viewing and buying in the app work as usual."}
                                        </p>
                                        <button onClick={() => void copyConsoleLink()} className={`${btnGhost} mt-4`}>
                                            <i className="fa-solid fa-copy mr-1.5"></i>
                                            {t('live.console.copyLink') || 'Copy console link'}
                                        </button>
                                    </div>
                                ) : localVideo ? (
                                    <>
                                        <TrackVideo
                                            track={localVideo}
                                            mirror
                                            className="absolute inset-0 w-full h-full object-cover"
                                        />
                                        {!connected && !isEnded && (
                                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-slate-200 text-[10px] font-black uppercase tracking-widest">
                                                {t('live.console.preview') || 'Preview'}
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                                        <i className="fa-solid fa-video-slash text-slate-600 text-2xl mb-3"></i>
                                        <p className="text-xs text-slate-500 leading-relaxed">
                                            {isEnded
                                                ? t('live.viewer.ended') || 'Show ended'
                                                : cameraIssue
                                                    ? cameraIssueText(cameraIssue)
                                                    : previewStarting
                                                        ? t('live.console.previewStarting') || 'Starting camera...'
                                                        : isLive
                                                            ? t('live.console.noCamera')
                                                            : t('live.console.notLiveYet') || 'Not live yet'}
                                        </p>
                                        {!isEnded && (cameraIssue || (isLive && connected)) && (
                                            <button
                                                onClick={() => void (connected ? retryCamera() : beginPreview())}
                                                disabled={retryingCamera || previewStarting}
                                                className={`${btnGhost} mt-3`}
                                            >
                                                {retryingCamera || previewStarting
                                                    ? t('live.payment.processing') || 'Processing...'
                                                    : t('live.console.retryCamera')}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            {isLive && (
                                <button onClick={() => void openTableQr()} className={`${btnGhost} mt-3 w-full h-10`}>
                                    <i className="fa-solid fa-qrcode mr-2"></i>
                                    {t('live.console.tableCam') || 'Table cam'}
                                </button>
                            )}
                        </div>

                        <div className={sectionCls}>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                    {t('live.console.soldCount') || 'sold'}
                                </span>
                                <span className="font-black">{soldSpots.length}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm mt-2">
                                <span className="text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                    {t('live.console.revenue')}
                                </span>
                                <span className="font-black text-brand-cyan">{formatSatang(revenueSatang)}</span>
                            </div>
                        </div>
                    </div>

                    {/* ─── Column 2: lot queue + spots ─── */}
                    <div className="space-y-4">
                        <div className={sectionCls}>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">
                                    {t('live.console.lots') || 'Lot queue'}
                                </h2>
                                {!isEnded && (
                                    <button onClick={() => setShowAddLot((v) => !v)} className={btnGhost}>
                                        <i className="fa-solid fa-plus mr-1.5"></i>
                                        {t('live.console.addLot') || 'Add lot'}
                                    </button>
                                )}
                            </div>

                            {showAddLot && (
                                <div className="mb-4 bg-black/20 rounded-xl p-3 space-y-2.5">
                                    <input
                                        value={lotName}
                                        onChange={(e) => setLotName(e.target.value)}
                                        placeholder={t('live.console.lotName') || 'Product name'}
                                        className={inputCls}
                                    />
                                    <div className="grid grid-cols-2 gap-2.5">
                                        <label className="block">
                                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                                                {t('live.console.itemType') || 'Format'}
                                            </span>
                                            <select
                                                value={lotType}
                                                onChange={(e) => setLotType(e.target.value as BreakType)}
                                                className={inputCls}
                                            >
                                                {BREAK_TYPES.map((bt) => (
                                                    <option key={bt} value={bt}>
                                                        {t(`live.types.${bt}`)}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                                                {t('live.console.productType') || 'Product type'}
                                            </span>
                                            <select
                                                value={lotProductType}
                                                onChange={(e) =>
                                                    setLotProductType(e.target.value as (typeof PRODUCT_TYPES)[number])
                                                }
                                                className={inputCls}
                                            >
                                                {PRODUCT_TYPES.map((pt) => (
                                                    <option key={pt} value={pt}>
                                                        {t(`live.console.productTypes.${pt}`)}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                                                {t('live.console.spotsTotal') || 'Spots'}
                                            </span>
                                            <input
                                                type="number"
                                                min={1}
                                                max={200}
                                                value={lotType === 'personal_break' ? '1' : lotSpots}
                                                disabled={lotType === 'personal_break'}
                                                onChange={(e) => setLotSpots(e.target.value)}
                                                className={inputCls}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                                                {t('live.console.spotPrice') || 'Price per spot (THB)'}
                                            </span>
                                            <input
                                                type="number"
                                                min={1}
                                                value={lotPriceThb}
                                                onChange={(e) => setLotPriceThb(e.target.value)}
                                                className={inputCls}
                                            />
                                        </label>
                                        <label className="block">
                                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                                                {t('live.console.packsPerSpot') || 'Packs per spot'}
                                            </span>
                                            <input
                                                type="number"
                                                min={1}
                                                max={50}
                                                value={lotPacks}
                                                onChange={(e) => setLotPacks(e.target.value)}
                                                className={inputCls}
                                            />
                                        </label>
                                    </div>
                                    <button
                                        onClick={() => void createLot()}
                                        disabled={creatingLot || !lotName.trim()}
                                        className={`${btnPrimary} w-full`}
                                    >
                                        {creatingLot
                                            ? t('live.hub.creating') || 'Scheduling...'
                                            : t('live.console.create') || 'Add to queue'}
                                    </button>
                                </div>
                            )}

                            <div className="space-y-2">
                                {lots.map((lot) => {
                                    const lotSpotRows = spots.filter((s) => s.stream_item_id === lot.id);
                                    const sold = lotSpotRows.filter((s) => s.status === 'sold').length;
                                    const isFocused = focusedLot?.id === lot.id;
                                    return (
                                        <div
                                            key={lot.id}
                                            onClick={() => setSelectedLotId(lot.id)}
                                            className={`rounded-xl border p-3 cursor-pointer transition-all ${
                                                lot.status === 'active'
                                                    ? 'border-brand-cyan/50 bg-brand-cyan/5'
                                                    : isFocused
                                                        ? 'border-white/25 bg-white/5'
                                                        : 'border-white/10 bg-black/20'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-bold text-white truncate">
                                                    {lot.card_data?.name || '—'}
                                                </p>
                                                <span className="ml-auto shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                                    {t(`live.console.lotStatus.${lot.status}`)}
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-slate-400 mt-0.5">
                                                {t(`live.types.${lot.item_type}`)}
                                                {lot.spot_price != null &&
                                                    ` · ${formatSatang(lot.spot_price)} × ${lot.spots_total}`}
                                                {` · ${sold}/${lotSpotRows.length} ${t('live.console.soldCount') || 'sold'}`}
                                            </p>
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {lot.status === 'queued' && (
                                                    <>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void patchLot(lot.id, { status: 'active' });
                                                            }}
                                                            disabled={!isLive}
                                                            className={`${btnGhost} bg-brand-cyan/20 text-brand-cyan`}
                                                        >
                                                            {t('live.console.startLot') || 'Start'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void moveLot(lot, -1);
                                                            }}
                                                            aria-label="Move up"
                                                            className={btnGhost}
                                                        >
                                                            <i className="fa-solid fa-arrow-up"></i>
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void moveLot(lot, 1);
                                                            }}
                                                            aria-label="Move down"
                                                            className={btnGhost}
                                                        >
                                                            <i className="fa-solid fa-arrow-down"></i>
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void deleteLot(lot.id);
                                                            }}
                                                            className={`${btnGhost} text-brand-red`}
                                                        >
                                                            {t('live.console.deleteLot') || 'Remove'}
                                                        </button>
                                                    </>
                                                )}
                                                {lot.status === 'active' && (
                                                    <>
                                                        {!lot.break_opened_at && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    void patchLot(lot.id, { breakOpened: true });
                                                                }}
                                                                className={`${btnGhost} bg-amber-500/20 text-amber-300`}
                                                            >
                                                                {t('live.console.markOpened') || 'Mark ripped'}
                                                            </button>
                                                        )}
                                                        {lot.item_type === 'random_pack' && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setConfirm({
                                                                        message:
                                                                            t('live.console.confirmRandomize') ||
                                                                            'Run the server randomizer? The result is final.',
                                                                        confirmLabel: t('live.console.randomize') || 'Randomize packs',
                                                                        run: () => runRandomizer(lot, 'spot_to_pack'),
                                                                    });
                                                                }}
                                                                className={`${btnGhost} bg-purple-500/20 text-purple-300`}
                                                            >
                                                                {t('live.console.randomize') || 'Randomize packs'}
                                                            </button>
                                                        )}
                                                        {lot.item_type === 'chase_break' && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setHitText('');
                                                                    setConfirm({
                                                                        message:
                                                                            t('live.console.confirmRandomize') ||
                                                                            'Run the server randomizer? The result is final.',
                                                                        confirmLabel: t('live.console.randomizeHit') || 'Assign hit',
                                                                        withHitInput: true,
                                                                        // The real run happens in the dialog's confirm
                                                                        // handler, which reads hitText + confirmLotRef.
                                                                        run: async () => {},
                                                                    });
                                                                    confirmLotRef.current = lot;
                                                                }}
                                                                className={`${btnGhost} bg-purple-500/20 text-purple-300`}
                                                            >
                                                                {t('live.console.randomizeHit') || 'Assign hit'}
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void patchLot(lot.id, { status: 'sold' });
                                                            }}
                                                            className={btnGhost}
                                                        >
                                                            {t('live.console.closeSold') || 'Close sold'}
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void patchLot(lot.id, { status: 'unsold' });
                                                            }}
                                                            className={btnGhost}
                                                        >
                                                            {t('live.console.closeUnsold') || 'Close unsold'}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Spot board for the focused lot */}
                        {focusedLot && (
                            <div className={sectionCls}>
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300 mb-3">
                                    {t('live.console.spots') || 'Spots'} — {focusedLot.card_data?.name || ''}
                                </h2>
                                <div className="grid grid-cols-6 gap-1.5">
                                    {focusedSpots.map((spot) => {
                                        const held =
                                            spot.status === 'held' &&
                                            !!spot.hold_expires_at &&
                                            Date.parse(spot.hold_expires_at) > Date.now();
                                        const cls =
                                            spot.status === 'sold'
                                                ? 'bg-brand-cyan/20 border-brand-cyan/40 text-brand-cyan'
                                                : held
                                                    ? 'bg-amber-500/10 border-amber-400/40 text-amber-300'
                                                    : 'bg-emerald-500/5 border-emerald-400/20 text-slate-300';
                                        return (
                                            <div
                                                key={spot.id}
                                                className={`aspect-square rounded-lg border flex flex-col items-center justify-center ${cls}`}
                                            >
                                                <span className="text-xs font-black">{spot.spot_number}</span>
                                                {spot.assigned_packs && spot.assigned_packs.length > 0 && (
                                                    <span className="text-[8px] font-bold">
                                                        {spot.assigned_packs.join(',')}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ─── Column 3: chat + moderation ─── */}
                    <div className={`${sectionCls} flex flex-col max-h-[80vh]`}>
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">
                                {t('live.console.chat') || 'Chat'}
                            </h2>
                            <button
                                onClick={() => void moderate({ action: 'chat_toggle' })}
                                className={`${btnGhost} ${stream.chat_disabled ? 'bg-amber-500/20 text-amber-300' : ''}`}
                            >
                                {stream.chat_disabled
                                    ? t('live.console.unfreeze') || 'Unfreeze chat'
                                    : t('live.console.freeze') || 'Freeze chat'}
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-1 min-h-[200px]">
                            {chat.map((m) =>
                                m.is_system ? (
                                    <p key={m.id} className="text-[11px] text-amber-300 font-bold text-center py-0.5 break-words">
                                        {m.body}
                                    </p>
                                ) : (
                                    <div key={m.id} className="group flex items-start gap-2 text-[12px] py-0.5">
                                        <p className="flex-1 leading-snug break-words">
                                            <span className="font-black text-brand-cyan mr-1.5">
                                                {m.sender?.display_name || '...'}
                                            </span>
                                            <span className="text-white/90">{m.body}</span>
                                        </p>
                                        {m.sender_id !== stream.seller_id && (
                                            <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                <button
                                                    onClick={() =>
                                                        void moderate({ action: 'delete_message', messageId: m.id })
                                                    }
                                                    aria-label={t('live.console.deleteMessage') || 'Delete'}
                                                    className="w-6 h-6 rounded bg-white/10 text-slate-400 text-[10px]"
                                                >
                                                    <i className="fa-solid fa-trash"></i>
                                                </button>
                                                <button
                                                    onClick={() => void moderate({ action: 'ban', userId: m.sender_id })}
                                                    aria-label={t('live.console.ban') || 'Ban'}
                                                    className="w-6 h-6 rounded bg-brand-red/20 text-brand-red text-[10px]"
                                                >
                                                    <i className="fa-solid fa-ban"></i>
                                                </button>
                                            </span>
                                        )}
                                    </div>
                                ),
                            )}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') void sendChat();
                                }}
                                maxLength={300}
                                placeholder={t('live.viewer.chatPlaceholder') || 'Say something...'}
                                className={inputCls}
                            />
                            <button
                                onClick={() => void sendChat()}
                                disabled={!chatInput.trim()}
                                aria-label={t('live.common.send')}
                                className="w-10 h-10 shrink-0 rounded-xl bg-brand-cyan text-brand-darker flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all"
                            >
                                <i className="fa-solid fa-paper-plane text-sm"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Confirm dialog ─── */}
            {confirm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 p-5">
                        <p className="text-sm text-white leading-relaxed">{confirm.message}</p>
                        {confirm.withHitInput && (
                            <input
                                value={hitText}
                                onChange={(e) => setHitText(e.target.value)}
                                maxLength={200}
                                placeholder={t('live.console.hitPlaceholder') || 'Hit description'}
                                className={`${inputCls} mt-3`}
                            />
                        )}
                        <div className="mt-4 flex gap-2 justify-end">
                            <button
                                onClick={() => setConfirm(null)}
                                disabled={confirmBusy}
                                className={btnGhost}
                            >
                                {t('live.console.cancel') || 'Cancel'}
                            </button>
                            <button
                                onClick={async () => {
                                    if (confirm.withHitInput && !hitText.trim()) return;
                                    setConfirmBusy(true);
                                    try {
                                        if (confirm.withHitInput && confirmLotRef.current) {
                                            await runRandomizer(confirmLotRef.current, 'hit_assignment', hitText.trim());
                                        } else {
                                            await confirm.run();
                                        }
                                        setConfirm(null);
                                    } finally {
                                        setConfirmBusy(false);
                                    }
                                }}
                                disabled={confirmBusy || (confirm.withHitInput && !hitText.trim())}
                                className={btnPrimary}
                            >
                                {confirmBusy
                                    ? t('live.payment.processing') || 'Processing...'
                                    : confirm.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Randomizer result (seed shown for verifiability) ─── */}
            {randomizeResult && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 p-5">
                        <p className="text-sm font-black text-white uppercase tracking-wide mb-3">
                            {t('live.console.randomize') || 'Randomize packs'}
                        </p>
                        <p className="text-xs text-slate-300 leading-relaxed break-words">{randomizeResult.summary}</p>
                        <p className="text-[10px] text-slate-500 mt-3 break-all">
                            {t('live.console.seed') || 'Seed'}: {randomizeResult.seed}
                        </p>
                        <button
                            onClick={() => setRandomizeResult(null)}
                            className={`${btnPrimary} w-full mt-4`}
                        >
                            {t('live.payment.close') || 'Close'}
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Table-cam QR ─── */}
            {tableQr && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 p-5 text-center">
                        <p className="text-sm font-black text-white uppercase tracking-wide mb-3">
                            {t('live.console.tableCam') || 'Table cam'}
                        </p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={tableQr} alt="Table cam QR" className="w-full max-w-[280px] mx-auto rounded-xl" />
                        <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                            {t('live.console.tableCamHint') ||
                                'Scan with your second phone to publish the overhead table camera.'}
                        </p>
                        <button onClick={() => setTableQr(null)} className={`${btnPrimary} w-full mt-4`}>
                            {t('live.payment.close') || 'Close'}
                        </button>
                    </div>
                </div>
            )}
        </main>
    );
}
