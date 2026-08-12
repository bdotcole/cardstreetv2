'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';
import { createClient } from '@/lib/supabase/client';
import { useLiveKitRoom } from '@/lib/hooks/useLiveKitRoom';
import { CroppedTrackVideo } from '@/components/live/CroppedTrackVideo';
import { TrackStatsBadge } from '@/components/live/TrackStatsBadge';
import CustomSelect from '@/components/CustomSelect';
import { ShareShowButton } from '@/components/live/ShareShowButton';
import {
    clampCrop,
    clampRatio,
    DEFAULT_CROP,
    DEFAULT_RATIO,
    formatSatang,
    isNativeShell,
    pollTotalVotes,
    resolveFit,
    type FeedCrop,
    type FeedFit,
    type LiveChatMessage,
    type LiveLotRow,
    type LivePollRow,
    type LiveSpotRow,
    type LiveStreamRow,
    type StreamLayout,
} from '@/components/live/shared';
import { PollOptionBars } from '@/components/live/StreamPoll';
import {
    FloatingStickerLayer,
    useFloatingStickers,
    useStickerBroadcast,
} from '@/components/live/StickerReactions';

/**
 * The broadcaster CONSOLE (phone-first, desktop-capable): camera staging +
 * go-live, the companion-cam QR handoff, the lot queue, the spot board, and
 * moderated chat.
 *
 * CAMERA MODE: the first visit asks (once per stream, sessionStorage) how
 * THIS device broadcasts —
 *   'table' (phone default): publishes the REAR camera as the table slot +
 *            mic, so a streamer goes live with just their phone, single-cam;
 *   'main'  (desktop default): publishes the FRONT camera as the face slot +
 *            mic — the classic console;
 *   'none'  (manage only): connects subscribe-only ('monitor' token, no
 *            getUserMedia, no permission prompt) — a pure control surface
 *            with monitor tiles of whatever remote devices publish.
 *
 * Staging is AUTOMATIC once the mode is known: the console mints the mode's
 * token, connects, publishes per the mode, and fetches the companion-cam QR —
 * zero further clicks before a second phone can scan. While the show is
 * 'scheduled' none of it is visible to viewers (viewer tokens and the viewer
 * page are both gated on status='live'), so Go live is just the status flip +
 * recording start. On a live show the same auto-stage doubles as the
 * crashed-console reconnect.
 *
 * The QR invites the COMPLEMENTARY slot of whatever this console publishes
 * (console=table -> face-cam QR, console=main -> table-cam QR; manage-only
 * offers both, table first). Dual-cam stays possible everywhere but is never
 * required — solo table or solo main both fill the frame for viewers.
 *
 * The companion-cam token rides the URL FRAGMENT of the QR link (never the
 * query string) — fragments don't leave the browser, so the bearer token
 * stays out of server/proxy logs. It is short-lived and dies with the room.
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

/** How this console device broadcasts — see the file header. */
type ConsoleCameraMode = 'main' | 'table' | 'none';
/** The two publishable camera slots (a QR invite always targets one). */
type InviteSlot = 'main' | 'table';

function cameraModeStorageKey(streamId: string): string {
    return `cs_live_camera_mode:${streamId}`;
}

function facingForMode(mode: 'main' | 'table'): 'user' | 'environment' {
    return mode === 'main' ? 'user' : 'environment';
}

/**
 * Phone-first default: a handheld device makes a better TABLE cam than a face
 * cam — the streamer goes live with just that phone, rear camera on the
 * cards. Desktops default to the classic face-cam console. UA first; the
 * coarse-pointer + narrow-viewport check catches UA-less browsers.
 */
function isPhoneLikeDevice(): boolean {
    if (typeof window === 'undefined') return false;
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
    return (
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches &&
        window.innerWidth < 900
    );
}

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
    // Companion-cam handoff (inline block, auto-fetched once staged, slot =
    // the COMPLEMENT of what this console publishes). The QR is derived from
    // `link` and NOTHING else — a failed token fetch shows the 'error' state
    // (visible retry), never a QR of some fallback URL.
    const [camInvite, setCamInvite] = useState<
        | { slot: InviteSlot; phase: 'loading' }
        | { slot: InviteSlot; phase: 'error'; message: string }
        | { slot: InviteSlot; phase: 'ready'; qr: string; link: string }
        | null
    >(null);
    // ─── Camera mode (the file-header model) ───
    // null until restored/chosen — staging waits on it.
    const [cameraMode, setCameraMode] = useState<ConsoleCameraMode | null>(null);
    const [modeChooserOpen, setModeChooserOpen] = useState(false);
    const modeInitRef = useRef(false);
    // Manage-only consoles offer BOTH invite QRs; table first.
    const [inviteSlotChoice, setInviteSlotChoice] = useState<InviteSlot>('table');
    const [settleResult, setSettleResult] = useState<number | null>(null);
    const [chatInput, setChatInput] = useState('');
    const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

    // ─── Audience poll (latest; the console also shows the closed result) ───
    const [poll, setPoll] = useState<LivePollRow | null>(null);
    // Realtime handlers compare against the CURRENT poll without re-binding
    // the channel on every tally tick.
    const pollRef = useRef<LivePollRow | null>(null);
    useEffect(() => {
        pollRef.current = poll;
    }, [poll]);
    const [showPollForm, setShowPollForm] = useState(false);
    const [pollQuestion, setPollQuestion] = useState('');
    const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
    const [creatingPoll, setCreatingPoll] = useState(false);
    const [closingPoll, setClosingPoll] = useState(false);

    // ─── Viewer framing (streams.layout) ───
    // Local-first: the panel edits this state and autosaves; the Realtime echo
    // of our own PATCH merges into `stream` but never fights the panel.
    const [layout, setLayout] = useState<StreamLayout>({});
    // Source of truth during rapid drag updates (state lags pointermove).
    const layoutRef = useRef<StreamLayout>({});
    const layoutSeededRef = useRef(false);
    const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const feedDragRef = useRef<{
        slot: 'main' | 'table';
        pointerId: number;
        lastX: number;
        lastY: number;
    } | null>(null);
    // Split-divider drag between the two stacked feeds.
    const ratioDragRef = useRef<number | null>(null);
    const stackRef = useRef<HTMLDivElement | null>(null);

    // Add-lot form.
    const [showAddLot, setShowAddLot] = useState(false);
    const [lotName, setLotName] = useState('');
    const [lotType, setLotType] = useState<BreakType>('random_pack');
    const [lotSpots, setLotSpots] = useState('10');
    const [lotPriceThb, setLotPriceThb] = useState('100');
    const [lotPacks, setLotPacks] = useState('1');
    const [lotProductType, setLotProductType] = useState<(typeof PRODUCT_TYPES)[number]>('box');
    // Presales: sell this lot's spots while the show is still scheduled.
    const [lotPresale, setLotPresale] = useState(false);
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
        remoteIdentities,
        remoteFeeds,
        disconnect,
        audioDropped,
    } = useLiveKitRoom();

    const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);
    const [previewStarting, setPreviewStarting] = useState(false);

    // Native-shell escape hatch, reached only AFTER capture actually fails.
    // The binary carries android.permission.CAMERA and the WebView grants
    // getUserMedia (the in-app scanner proves it), so the console runs the
    // normal sequence everywhere — an upfront native block stranded devices
    // that work. The console asks for the MIC too, and RECORD_AUDIO landed
    // only after v17; on an older binary the audio leg denies and takes the
    // whole capture down with it, which is worth saying plainly. A video-only
    // probe tells that case apart from a genuine camera denial.
    const [nativeFallback, setNativeFallback] = useState<'camera' | 'mic' | null>(null);

    const noteNativeFallback = useCallback(async () => {
        if (!isNativeShell()) return;
        let kind: 'camera' | 'mic' = 'camera';
        try {
            const probe = await navigator.mediaDevices.getUserMedia({ video: true });
            for (const track of probe.getTracks()) track.stop();
            kind = 'mic'; // Camera alone is fine — the mic is what failed.
        } catch {
            // Camera is blocked too; the generic browser handoff applies.
        }
        setNativeFallback(kind);
    }, []);

    // Every camera-failure site funnels through here: classify for the
    // in-panel message, then (native shell only) resolve the browser handoff.
    const noteCameraFailure = useCallback(
        (err: unknown): CameraIssue => {
            const issue = classifyCameraError(err);
            setCameraIssue(issue);
            void noteNativeFallback();
            return issue;
        },
        [noteNativeFallback],
    );

    const clearCameraIssue = useCallback(() => {
        setCameraIssue(null);
        setNativeFallback(null);
    }, []);

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
        // Seed the framing panel ONCE from the stored layout — later loadDetail
        // calls (add-lot refresh) must not clobber in-progress edits.
        if (!layoutSeededRef.current) {
            layoutSeededRef.current = true;
            const stored = (data.stream as LiveStreamRow)?.layout;
            const seeded: StreamLayout = {};
            const mainCrop = clampCrop(stored?.main);
            const tableCrop = clampCrop(stored?.table);
            const storedRatio = clampRatio(stored?.ratio);
            if (mainCrop) seeded.main = mainCrop;
            if (tableCrop) seeded.table = tableCrop;
            if (storedRatio != null) seeded.ratio = storedRatio;
            layoutRef.current = seeded;
            setLayout(seeded);
        }
        setPageState('ready');
        return data.stream as LiveStreamRow;
    }, [streamId]);

    // Latest poll (any status) — fails soft pre-migration ({poll: null}).
    const loadPoll = useCallback(async () => {
        try {
            const res = await fetch(`/api/live/streams/${streamId}/polls`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.poll) setPoll(data.poll);
        } catch {
            // Realtime (or the next refetch) will catch us up.
        }
    }, [streamId]);

    useEffect(() => {
        if (!streamId) return;
        void loadDetail();
        void loadPoll();
    }, [streamId, loadDetail, loadPoll]);

    // Camera-mode step: restore the per-stream choice, or open the chooser on
    // the first visit. sessionStorage (not local) on purpose — the right mode
    // is a per-session, per-device fact (the same account may console from a
    // phone today and a desktop tomorrow).
    useEffect(() => {
        if (pageState !== 'ready' || !stream || modeInitRef.current) return;
        modeInitRef.current = true;
        if (stream.status === 'ended' || stream.status === 'cancelled') return;
        let stored: string | null = null;
        try {
            stored = sessionStorage.getItem(cameraModeStorageKey(streamId));
        } catch {
            // Storage unavailable — fall through to the chooser.
        }
        if (stored === 'main' || stored === 'table' || stored === 'none') {
            setCameraMode(stored);
        } else {
            setModeChooserOpen(true);
        }
    }, [pageState, stream, streamId]);

    // Tolerant re-sync used after a Realtime gap (backgrounded WebView,
    // channel error). Unlike loadDetail it never flips pageState — a
    // transient failure mid-show must not 404 the console.
    const refetchDetail = useCallback(async () => {
        try {
            void loadPoll();
            const res = await fetch(`/api/live/streams/${streamId}`);
            if (!res.ok) return;
            const data = await res.json();
            setStream(data.stream);
            setLots((data.items ?? []).sort((a: LiveLotRow, b: LiveLotRow) => a.position - b.position));
            setSpots(data.spots ?? []);
        } catch {
            // Realtime (or the next visibility flip) will catch us up.
        }
    }, [streamId, loadPoll]);

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
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'stream_polls', filter: `stream_id=eq.${streamId}` },
                (payload) => {
                    const row = payload.new as LivePollRow;
                    if (!row?.id) return;
                    if (pollRef.current?.id === row.id) {
                        setPoll((prev) => (prev && prev.id === row.id ? { ...prev, ...row } : prev));
                    } else if (!pollRef.current || row.created_at >= pollRef.current.created_at) {
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

    // ─── Camera preview (before go-live) ───
    // The camera is requested the moment the mode is known so the seller sees
    // the feed and resolves the permission prompt EARLY — not in the middle
    // of pressing Go live. The mode picks the physical camera (front for the
    // face cam, rear for the table cam); the console device carries the mic
    // in both camera modes. Manage-only never touches getUserMedia. Runs in
    // the native shell too; only a real failure routes to the browser
    // handoff. Skipped once the show has ended.
    const beginPreview = useCallback(async () => {
        if (previewStarting) return;
        if (cameraMode !== 'main' && cameraMode !== 'table') return;
        setPreviewStarting(true);
        try {
            await startPreview({ facingMode: facingForMode(cameraMode), audio: true });
            clearCameraIssue();
        } catch (err) {
            noteCameraFailure(err);
        } finally {
            setPreviewStarting(false);
        }
    }, [previewStarting, cameraMode, startPreview, clearCameraIssue, noteCameraFailure]);

    // The show ending (locally or via realtime) releases the previewed camera.
    useEffect(() => {
        if (stream?.status === 'ended' || stream?.status === 'cancelled') stopPreview();
    }, [stream?.status, stopPreview]);

    // ─── Layout panel: crop editing + debounced autosave ───
    const persistLayout = useCallback(
        (next: StreamLayout) => {
            if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
            layoutSaveTimer.current = setTimeout(() => {
                void fetch(`/api/live/streams/${streamId}/layout`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(next),
                }).catch(() => {
                    // Framing is cosmetic; the next adjustment retries.
                });
            }, 400);
        },
        [streamId],
    );

    useEffect(
        () => () => {
            if (layoutSaveTimer.current) clearTimeout(layoutSaveTimer.current);
        },
        [],
    );

    const cropOf = useCallback(
        (slot: 'main' | 'table'): FeedCrop => clampCrop(layout[slot]) ?? DEFAULT_CROP,
        [layout],
    );

    const updateCrop = useCallback(
        (slot: 'main' | 'table', patch: Partial<FeedCrop>) => {
            const cur = clampCrop(layoutRef.current[slot]) ?? DEFAULT_CROP;
            const next: StreamLayout = {
                ...layoutRef.current,
                [slot]: clampCrop({ ...cur, ...patch }) ?? DEFAULT_CROP,
            };
            layoutRef.current = next;
            setLayout(next);
            persistLayout(next);
        },
        [persistLayout],
    );

    // Drag-to-reposition: dragging moves the CONTENT with the pointer, so the
    // visible window (x/y) moves the opposite way. At zoom z the window spans
    // 1/z of the feed, so a full x-sweep (0 -> 1) is rect.width * (z - 1)
    // on-screen pixels — that's the divisor that makes the pan track 1:1.
    const beginFeedDrag = useCallback(
        (slot: 'main' | 'table') => (e: React.PointerEvent<HTMLDivElement>) => {
            const zoom = (clampCrop(layoutRef.current[slot]) ?? DEFAULT_CROP).zoom;
            if (zoom <= 1) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            feedDragRef.current = { slot, pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
        },
        [],
    );

    const moveFeedDrag = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const d = feedDragRef.current;
            if (!d || e.pointerId !== d.pointerId) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const crop = clampCrop(layoutRef.current[d.slot]) ?? DEFAULT_CROP;
            if (crop.zoom <= 1 || rect.width === 0 || rect.height === 0) return;
            const dx = -(e.clientX - d.lastX) / (rect.width * (crop.zoom - 1));
            const dy = -(e.clientY - d.lastY) / (rect.height * (crop.zoom - 1));
            d.lastX = e.clientX;
            d.lastY = e.clientY;
            updateCrop(d.slot, { x: crop.x + dx, y: crop.y + dy });
        },
        [updateCrop],
    );

    const endFeedDrag = useCallback(() => {
        feedDragRef.current = null;
    }, []);

    // ─── Split-ratio divider (face cam's share of the stacked height) ───
    // Same local-first + debounced-save flow as the crops; clampRatio bounds
    // the drag to 0.2..0.8 so neither feed can be squeezed into a sliver.
    const splitRatio = clampRatio(layout.ratio) ?? DEFAULT_RATIO;

    const updateRatio = useCallback(
        (value: number) => {
            const next: StreamLayout = {
                ...layoutRef.current,
                ratio: clampRatio(value) ?? DEFAULT_RATIO,
            };
            layoutRef.current = next;
            setLayout(next);
            persistLayout(next);
        },
        [persistLayout],
    );

    const beginRatioDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        ratioDragRef.current = e.pointerId;
    }, []);

    const moveRatioDrag = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (ratioDragRef.current !== e.pointerId) return;
            const rect = stackRef.current?.getBoundingClientRect();
            if (!rect || rect.height === 0) return;
            updateRatio((e.clientY - rect.top) / rect.height);
        },
        [updateRatio],
    );

    const endRatioDrag = useCallback(() => {
        ratioDragRef.current = null;
    }, []);

    // The escape hatch when in-app capture fails: copy the console URL and
    // reopen it in Chrome, which can always reach camera + mic.
    const copyConsoleLink = useCallback(async () => {
        const link = `${window.location.origin}/live/broadcast/${streamId}`;
        try {
            await navigator.clipboard.writeText(link);
            showToast(t('live.console.linkCopied') || 'Link copied', 'success');
        } catch {
            showToast(t('live.console.copyError') || 'Could not copy the link', 'error');
        }
    }, [streamId, showToast, t]);

    // ─── Go live (also the reconnect path when already live) ───
    // True while this device has successfully published its camera in this
    // page session — distinguishes a self-reconnect after a socket blip (no
    // warning) from a fresh console taking over a show another device is
    // broadcasting (must warn: LiveKit reuses the per-slot identity, so
    // joining EVICTS whichever device currently holds the slot).
    const publishedHereRef = useRef(false);

    // ─── Stage (automatic once the mode is known) ───
    // Joins the room with the mode's token ('table_cam' / 'main_cam' /
    // subscribe-only 'monitor'), so the companion-cam QR, the monitor tiles
    // and the Layout panel all work before go-live. On a 'scheduled' show
    // viewers can't see any of it — their tokens (and the viewer page's join)
    // are gated on status='live'.
    const [staging, setStaging] = useState(false);

    const stageCameras = useCallback(async () => {
        if (staging || connected || !cameraMode) return;
        setStaging(true);
        try {
            const role =
                cameraMode === 'main'
                    ? 'main_cam'
                    : cameraMode === 'table'
                        ? 'table_cam'
                        : 'monitor';
            const res = await fetch(`/api/live/streams/${streamId}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role }),
            });
            const data = await res.json();
            if (!res.ok || !data.token || !data.url) {
                showToast(
                    data.error || t('live.console.stageError') || 'Could not stage the cameras',
                    'error',
                );
                return;
            }
            await connect(data.url, data.token);
            if (cameraMode !== 'none') {
                try {
                    // Adopts the preview's tracks when they're up (no re-prompt).
                    await publishCamera({ facingMode: facingForMode(cameraMode), audio: true });
                    publishedHereRef.current = true;
                    clearCameraIssue();
                } catch (err) {
                    showToast(cameraIssueText(noteCameraFailure(err)), 'error');
                }
            }
        } catch {
            showToast(t('live.console.stageError') || 'Could not stage the cameras', 'error');
        } finally {
            setStaging(false);
        }
    }, [staging, connected, cameraMode, streamId, connect, publishCamera, cameraIssueText, clearCameraIssue, noteCameraFailure, showToast, t]);

    // Auto-stage once the mode is known: request the camera (preview resolves
    // the permission prompt first — publishCamera then adopts its tracks, no
    // re-prompt; manage-only skips capture entirely), then join + publish per
    // the mode, all with zero further clicks. Runs for 'scheduled' AND 'live'
    // (the live case is the crashed-console reconnect), in the native shell
    // as well as the browser, and stops once the show has ended. A failed
    // stage degrades gracefully: Go live also connects + publishes.
    useEffect(() => {
        if (pageState !== 'ready' || !cameraMode) return;
        const status = stream?.status;
        if (!status || status === 'ended' || status === 'cancelled') return;
        void (async () => {
            await beginPreview();
            await stageCameras();
        })();
        // beginPreview/stageCameras/localVideo/connected are deliberately not
        // deps: both callbacks no-op when their work is done or in flight, and
        // a denied camera prompt must not re-fire on every render — retry is
        // the seller's button. cameraMode IS a dep: a mode switch tears down
        // and must re-stage.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageState, stream?.status, cameraMode]);

    // Selecting a mode (first-visit chooser or the header's Camera-mode
    // button). A change after staging tears the session down and re-stages —
    // the slot rides the token identity, so switching needs a fresh token +
    // connection, and the auto-stage effect above re-runs off cameraMode.
    const applyCameraMode = useCallback(
        async (mode: ConsoleCameraMode) => {
            setModeChooserOpen(false);
            try {
                sessionStorage.setItem(cameraModeStorageKey(streamId), mode);
            } catch {
                // Persistence is a convenience — the choice still applies now.
            }
            if (mode === cameraMode) {
                // Re-picking the current mode doubles as a manual retry when
                // an earlier stage failed (the auto-stage effect is one-shot).
                if (!connected) {
                    await beginPreview();
                    await stageCameras();
                }
                return;
            }
            publishedHereRef.current = false;
            setCamInvite(null);
            setInviteSlotChoice('table');
            clearCameraIssue();
            await disconnect();
            stopPreview();
            setCameraMode(mode);
        },
        [streamId, cameraMode, connected, beginPreview, stageCameras, clearCameraIssue, disconnect, stopPreview],
    );

    const doGoLive = useCallback(async () => {
        if (goingLive) return;
        setGoingLive(true);
        try {
            const res = await fetch(`/api/live/streams/${streamId}/go-live`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showToast(data.error || t('live.console.goLiveError') || 'Could not go live', 'error');
                return;
            }
            setStream((prev) => (prev ? { ...prev, status: 'live' } : prev));
            // Idempotent when the console staged pre-live: this device is
            // already in the room per its mode, so go-live was just the
            // status flip + recording start — reconnecting here would tear
            // down the very feed that was framed. Otherwise re-run the stage:
            // it mints the MODE's own token (the go-live response token is
            // always 'main' — a backward-compat leftover this console no
            // longer uses) and publishes the mode's camera, or none at all
            // for a manage-only console.
            const alreadyPublishing = connected && publishedHereRef.current && !!localVideo;
            if (cameraMode === 'none') {
                if (!connected) await stageCameras();
            } else if (!alreadyPublishing) {
                if (!connected) {
                    await stageCameras();
                } else if (cameraMode) {
                    try {
                        // Adopts the preview's tracks when up (no re-prompt).
                        await publishCamera({ facingMode: facingForMode(cameraMode), audio: true });
                        publishedHereRef.current = true;
                        clearCameraIssue();
                    } catch (err) {
                        showToast(cameraIssueText(noteCameraFailure(err)), 'error');
                    }
                }
            }
        } catch {
            showToast(t('live.console.goLiveError') || 'Could not go live', 'error');
        } finally {
            setGoingLive(false);
        }
    }, [goingLive, streamId, cameraMode, connected, localVideo, stageCameras, publishCamera, cameraIssueText, clearCameraIssue, noteCameraFailure, showToast, t]);

    const goLive = useCallback(() => {
        // Displacement guard: the show is live but not from this session, and
        // this console is about to publish a slot another device is (or was)
        // holding — slot-aware, so a table-mode console warns about a
        // competing ':table', never about the face cam it invited itself.
        // Remote identities catch a competing publisher while we're in the
        // room; the status-vs-connection mismatch catches the fresh-console
        // case, where the room can't be inspected before joining (a
        // same-identity join evicts on connect, which is exactly the
        // displacement to warn about). Manage-only publishes nothing and can
        // never displace.
        const publishSlot =
            cameraMode === 'main' || cameraMode === 'table' ? cameraMode : null;
        const slotHeldElsewhere =
            publishSlot !== null &&
            stream?.status === 'live' &&
            !publishedHereRef.current &&
            (remoteIdentities.some((id) => id.endsWith(`:${publishSlot}`)) || !connected);
        if (slotHeldElsewhere) {
            setConfirm({
                message:
                    publishSlot === 'table'
                        ? t('live.console.takeoverWarningTable') ||
                          'Another device is broadcasting as the table camera. Take over?'
                        : t('live.console.takeoverWarning') ||
                          'Another device is broadcasting as the main camera. Take over?',
                confirmLabel: t('live.console.takeover') || 'Take over',
                run: doGoLive,
            });
            return;
        }
        void doGoLive();
    }, [cameraMode, stream?.status, remoteIdentities, connected, doGoLive, t]);

    // Camera-only retry for the live-but-not-publishing state (publishCamera
    // failed after go-live, e.g. a denied permission the seller then granted).
    // The Go live button is disabled once live + connected, so without this
    // the seller would be stuck broadcasting a black screen.
    const [retryingCamera, setRetryingCamera] = useState(false);
    const retryCamera = useCallback(async () => {
        if (retryingCamera || (cameraMode !== 'main' && cameraMode !== 'table')) return;
        setRetryingCamera(true);
        try {
            await publishCamera({ facingMode: facingForMode(cameraMode), audio: true });
            publishedHereRef.current = true;
            clearCameraIssue();
        } catch (err) {
            showToast(cameraIssueText(noteCameraFailure(err)), 'error');
        } finally {
            setRetryingCamera(false);
        }
    }, [retryingCamera, cameraMode, publishCamera, cameraIssueText, clearCameraIssue, noteCameraFailure, showToast]);

    // ─── Companion-cam QR ───
    // The block opens immediately in a loading state and the token is fetched
    // then — a mid-show failure is shown IN the block with a retry, not as a
    // transient toast the seller misses (which is how sellers ended up
    // improvising with the browser's own share-QR of the console URL and
    // displacing their live feed from the second phone).
    const openCamInvite = useCallback(
        async (slot: InviteSlot) => {
            setCamInvite({ slot, phase: 'loading' });
            try {
                const res = await fetch(`/api/live/streams/${streamId}/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: slot === 'main' ? 'main_cam' : 'table_cam' }),
                });
                const data = await res.json();
                if (!res.ok || !data.token || !data.url) {
                    setCamInvite({
                        slot,
                        phase: 'error',
                        message:
                            data.error ||
                            t('live.console.camLinkError') ||
                            'Could not create the camera link',
                    });
                    return;
                }
                // Token + wss URL in the FRAGMENT — see the file header for
                // why. (The token is a base64url JWT, already fragment-safe
                // verbatim; app/live/cam/[id] parses exactly this
                // #t=...&u=...&s=... shape.) a=1 asks the face-cam phone to
                // carry the mic — only when a manage-only console invites it,
                // i.e. no console device has a mic; any other combination
                // would open a second mic next to the console's and feed back.
                const audioFlag = slot === 'main' && cameraMode === 'none' ? '&a=1' : '';
                const link = `${window.location.origin}/live/cam/${streamId}#t=${data.token}&u=${encodeURIComponent(data.url)}&s=${slot}${audioFlag}`;
                const qr = await QRCode.toDataURL(link, { width: 480, margin: 1 });
                setCamInvite({ slot, phase: 'ready', qr, link });
            } catch {
                setCamInvite({
                    slot,
                    phase: 'error',
                    message: t('live.console.camLinkError') || 'Could not create the camera link',
                });
            }
        },
        [streamId, cameraMode, t],
    );

    // Fallback for phones that can't scan (or whose OS routes the scan into
    // the native app): the exact same cam link, copyable.
    const copyCamInviteLink = useCallback(async () => {
        if (camInvite?.phase !== 'ready') return;
        try {
            await navigator.clipboard.writeText(camInvite.link);
            showToast(t('live.console.linkCopied') || 'Link copied', 'success');
        } catch {
            showToast(t('live.console.copyError') || 'Could not copy the link', 'error');
        }
    }, [camInvite, showToast, t]);

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
                    // The server drops the flag unless the show is scheduled.
                    presaleEnabled: lotPresale && stream?.status === 'scheduled',
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showToast(data.error || t('live.console.createLotError') || 'Could not create the lot', 'error');
                return;
            }
            setLotName('');
            setLotPresale(false);
            setShowAddLot(false);
            await loadDetail();
        } catch {
            showToast(t('live.console.createLotError') || 'Could not create the lot', 'error');
        } finally {
            setCreatingLot(false);
        }
    }, [creatingLot, lotType, lotSpots, lotPriceThb, lotPacks, lotName, lotProductType, lotPresale, stream?.status, streamId, loadDetail, showToast, t]);

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

    // ─── Audience poll ───
    const createPoll = useCallback(async () => {
        if (creatingPoll) return;
        const question = pollQuestion.trim();
        // Blank option rows are dropped; the route assigns keys a-d in order.
        const labels = pollOptions.map((o) => o.trim()).filter(Boolean);
        if (!question || labels.length < 2) return;
        setCreatingPoll(true);
        try {
            const res = await fetch(`/api/live/streams/${streamId}/polls`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, options: labels }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.poll) {
                showToast(
                    data.code === 'POLL_ALREADY_OPEN'
                        ? t('live.poll.alreadyOpen') || 'A poll is already open — close it first'
                        : data.error || t('live.poll.createError') || 'Could not start the poll',
                    'error',
                );
                return;
            }
            setPoll(data.poll);
            setShowPollForm(false);
            setPollQuestion('');
            setPollOptions(['', '']);
        } catch {
            showToast(t('live.poll.createError') || 'Could not start the poll', 'error');
        } finally {
            setCreatingPoll(false);
        }
    }, [creatingPoll, pollQuestion, pollOptions, streamId, showToast, t]);

    const closePoll = useCallback(async () => {
        const target = pollRef.current;
        if (!target || closingPoll || target.status !== 'open') return;
        setClosingPoll(true);
        try {
            const res = await fetch(`/api/live/polls/${target.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'close' }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.poll) {
                showToast(data.error || t('live.poll.closeError') || 'Could not close the poll', 'error');
                return;
            }
            setPoll(data.poll);
        } catch {
            showToast(t('live.poll.closeError') || 'Could not close the poll', 'error');
        } finally {
            setClosingPoll(false);
        }
    }, [closingPoll, showToast, t]);

    // ─── Sticker reactions: the console floats the audience's taps over the
    //     monitor tile so the breaker feels the room without watching chat. ───
    const { floats: stickerFloats, spawn: spawnSticker, remove: removeSticker } = useFloatingStickers();
    useStickerBroadcast(streamId, pageState === 'ready' && stream?.status === 'live', spawnSticker);

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

    // ─── Slot presence: which camera slots are live, local or remote ───
    // The console's own publish fills its mode's slot; the complementary
    // slot(s) arrive as remote participants. Participant presence (identity
    // suffix) flips the flags; the subscribed track may trail presence by a
    // beat, so remote tiles show a spinner until the track lands.
    const publishSlot: InviteSlot | null =
        cameraMode === 'main' || cameraMode === 'table' ? cameraMode : null;
    const remoteMainConnected = remoteIdentities.some((id) => id.endsWith(':main'));
    const remoteTableConnected = remoteIdentities.some((id) => id.endsWith(':table'));
    const remoteMainTrack = remoteFeeds.video.main ?? null;
    const remoteTableTrack = remoteFeeds.video.table ?? null;

    // The QR invites the COMPLEMENTARY slot of whatever this console
    // publishes; a manage-only console offers both (table first, toggleable).
    // A slot that's already connected is never re-invited.
    const desiredInviteSlot: InviteSlot | null = (() => {
        if (publishSlot === 'main') return remoteTableConnected ? null : 'table';
        if (publishSlot === 'table') return remoteMainConnected ? null : 'main';
        if (cameraMode !== 'none') return null;
        const choiceConnected =
            inviteSlotChoice === 'main' ? remoteMainConnected : remoteTableConnected;
        if (!choiceConnected) return inviteSlotChoice;
        const other: InviteSlot = inviteSlotChoice === 'table' ? 'main' : 'table';
        const otherConnected = other === 'main' ? remoteMainConnected : remoteTableConnected;
        return otherConnected ? null : other;
    })();

    // The companion-cam QR is fetched the moment the console is in the room
    // with an uninvited slot open — the second phone is scannable with zero
    // clicks. A same-slot invite already up (loading, ready OR error — the
    // error state keeps its in-QR retry button) stops the effect; clearing on
    // connect below re-arms it, so a companion phone dropping mid-show gets a
    // FRESH token, not a stale one.
    useEffect(() => {
        if (!connected || !desiredInviteSlot) return;
        if (stream?.status === 'ended' || stream?.status === 'cancelled') return;
        if (camInvite?.slot === desiredInviteSlot) return;
        void openCamInvite(desiredInviteSlot);
    }, [connected, desiredInviteSlot, camInvite, stream?.status, openCamInvite]);

    useEffect(() => {
        if (!camInvite) return;
        const inviteConnected =
            camInvite.slot === 'main' ? remoteMainConnected : remoteTableConnected;
        if (inviteConnected) setCamInvite(null);
    }, [camInvite, remoteMainConnected, remoteTableConnected]);

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
    // Pre-live staging: in the room (per the mode) while still 'scheduled'.
    const isStaged = connected && !isLive && !isEnded;

    // Monitor tiles: a slot renders when this console publishes it (even
    // pre-video — the placeholder + retry lives inside the tile) or a remote
    // device holds it. Both -> the viewer's stacked arrangement; ONE -> that
    // feed fills the frame (single-cam shows are first-class); none -> the
    // whole-area empty state.
    const mainTileShown = !isEnded && (publishSlot === 'main' || remoteMainConnected);
    const tableTileShown = !isEnded && (publishSlot === 'table' || remoteTableConnected);
    const bothTilesShown = mainTileShown && tableTileShown;
    const mainTileTrack = publishSlot === 'main' ? localVideo : remoteMainTrack;
    const tableTileTrack = publishSlot === 'table' ? localVideo : remoteTableTrack;

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
                        onClick={() => router.push('/live/studio')}
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
                        <ShareShowButton
                            title={stream.title}
                            sellerName={stream.seller?.display_name}
                            path={`/live/${streamId}`}
                            status={stream.status}
                            scheduledAt={stream.scheduled_at}
                            presaleOpen={lots.some(
                                (l) =>
                                    (l.status === 'queued' || l.status === 'active') &&
                                    l.presale_enabled === true,
                            )}
                            className="inline-flex w-10 h-10 rounded-xl glass border-white/10 items-center justify-center text-slate-300 active:scale-90 transition-all"
                        />
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
                            <span
                                className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${
                                    isStaged
                                        ? 'bg-brand-green/15 text-brand-green'
                                        : 'bg-white/10 text-slate-300'
                                }`}
                            >
                                {isEnded
                                    ? t('live.viewer.ended') || 'Show ended'
                                    : isStaged
                                        ? cameraMode === 'none'
                                            ? t('live.console.manageStaged') ||
                                              'Console connected — ready to go live'
                                            : t('live.console.camerasStaged') ||
                                              'Cameras staged — ready to go live'
                                        : staging
                                            ? t('live.console.stagingCameras') || 'Staging...'
                                            : t('live.console.notLiveYet') || 'Not live yet'}
                            </span>
                        )}
                        {!isEnded && (
                            <button onClick={goLive} disabled={goingLive || staging || (isLive && connected)} className={btnPrimary}>
                                {goingLive
                                    ? t('live.console.goingLive') || 'Starting...'
                                    : isLive
                                        ? t('live.console.reconnect') || 'Reconnect'
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
                    {/* ─── Column 1: camera monitor + companion-cam QR + stats ─── */}
                    <div className="space-y-4">
                        <div className={sectionCls}>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">
                                    {t('live.console.layout') || 'Layout'}
                                </h2>
                                {!isEnded && (
                                    <button onClick={() => setModeChooserOpen(true)} className={btnGhost}>
                                        <i className="fa-solid fa-camera-rotate mr-1.5"></i>
                                        {t('live.console.mode.change') || 'Camera mode'}
                                    </button>
                                )}
                            </div>
                            {/* The camera came up but the mic was refused, so this
                                device is publishing video-only (see captureTracks in
                                useLiveKitRoom). Said out loud and kept on screen: a
                                breaker who doesn't know is talking to nobody, and the
                                first sign would otherwise be a viewer complaining. */}
                            {audioDropped && !isEnded && (
                                <div className="mb-3 rounded-xl bg-amber-400/10 border border-amber-400/30 px-3 py-2.5 flex items-start gap-2.5">
                                    <i className="fa-solid fa-microphone-slash text-amber-300 text-sm mt-0.5"></i>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-amber-200 leading-snug">
                                            {t('live.console.micOffTitle') ||
                                                'Broadcasting without sound'}
                                        </p>
                                        <p className="text-[11px] text-amber-200/70 mt-0.5 leading-relaxed">
                                            {t('live.console.micOffDesc') ||
                                                'Your microphone was blocked, so viewers see your video but hear nothing. Update the app, or open this console in Chrome for sound.'}
                                        </p>
                                    </div>
                                </div>
                            )}
                            {/* The panel mirrors the VIEWER's arrangement (stacked at
                                `splitRatio` when both feeds are up, a solo feed filling
                                the frame otherwise) through the same CroppedTrackVideo
                                the viewer page renders, so the seller frames exactly
                                what viewers receive. Un-mirrored on purpose — WYSIWYG
                                beats the selfie flip here. */}
                            <div className="relative aspect-[9/12] bg-black rounded-xl overflow-hidden">
                                {nativeFallback && !isEnded ? (
                                    /* Capture failed inside the app shell — a dead
                                       viewfinder here would read as a bug. Name the
                                       mic case explicitly (an older binary without
                                       RECORD_AUDIO), and offer the browser escape. */
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-5">
                                        <i className="fa-solid fa-arrow-up-right-from-square text-brand-cyan text-2xl mb-3"></i>
                                        <p className="text-sm font-bold text-white leading-snug">
                                            {nativeFallback === 'mic'
                                                ? t('live.console.micTitle') ||
                                                  'Microphone needs the latest app update'
                                                : t('live.console.inAppTitle') ||
                                                  "Couldn't start the camera in the app"}
                                        </p>
                                        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                                            {nativeFallback === 'mic'
                                                ? t('live.console.micDesc') ||
                                                  'Open this console in Chrome to broadcast now, or update the app and try again.'
                                                : t('live.console.inAppDesc') ||
                                                  "Open this show's console in Chrome to broadcast. Viewing and buying in the app work as usual."}
                                        </p>
                                        {/* Retry stays in-app: the seller may have just
                                            granted the OS prompt they first dismissed,
                                            which needs no browser bounce at all. */}
                                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                                            <button
                                                onClick={() => void (connected ? retryCamera() : beginPreview())}
                                                disabled={retryingCamera || previewStarting}
                                                className={btnGhost}
                                            >
                                                {retryingCamera || previewStarting
                                                    ? t('live.payment.processing') || 'Processing...'
                                                    : t('live.console.retryCamera')}
                                            </button>
                                            <button onClick={() => void copyConsoleLink()} className={btnGhost}>
                                                <i className="fa-solid fa-copy mr-1.5"></i>
                                                {t('live.console.copyLink') || 'Copy console link'}
                                            </button>
                                        </div>
                                    </div>
                                ) : mainTileShown || tableTileShown ? (
                                    <div ref={stackRef} className="absolute inset-0 flex flex-col">
                                        {(['main', 'table'] as const)
                                            .filter((slot) =>
                                                slot === 'main' ? mainTileShown : tableTileShown,
                                            )
                                            .map((slot) => {
                                                const isLocalSlot = publishSlot === slot;
                                                const tileTrack =
                                                    slot === 'main' ? mainTileTrack : tableTileTrack;
                                                const remoteTrack =
                                                    slot === 'main' ? remoteMainTrack : remoteTableTrack;
                                                const height = !bothTilesShown
                                                    ? '100%'
                                                    : slot === 'main'
                                                        ? `${splitRatio * 100}%`
                                                        : `${(1 - splitRatio) * 100}%`;
                                                return (
                                                    <div
                                                        key={slot}
                                                        className={`relative touch-none ${
                                                            bothTilesShown && slot === 'table'
                                                                ? 'border-t border-white/10 '
                                                                : ''
                                                        }${tileTrack && cropOf(slot).zoom > 1 ? 'cursor-move' : ''}`}
                                                        style={{ height }}
                                                        onPointerDown={beginFeedDrag(slot)}
                                                        onPointerMove={moveFeedDrag}
                                                        onPointerUp={endFeedDrag}
                                                        onPointerCancel={endFeedDrag}
                                                    >
                                                        {tileTrack ? (
                                                            /* Remote tiles render muted (their audio
                                                               playing here would feed back into the
                                                               console's mic) with broadcaster-only
                                                               receive stats: what the companion
                                                               phone's publish actually delivers over
                                                               the network (the console is itself a
                                                               subscriber of that hop). */
                                                            <>
                                                                <CroppedTrackVideo
                                                                    track={tileTrack}
                                                                    crop={layout[slot] ?? null}
                                                                    slot={slot}
                                                                    className="absolute inset-0"
                                                                />
                                                                {!isLocalSlot && (
                                                                    <TrackStatsBadge
                                                                        track={remoteTrack}
                                                                        className="absolute bottom-1.5 left-1.5"
                                                                    />
                                                                )}
                                                            </>
                                                        ) : isLocalSlot ? (
                                                            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                                                                <i className="fa-solid fa-video-slash text-slate-600 text-xl mb-2"></i>
                                                                <p className="text-[11px] text-slate-500 leading-relaxed">
                                                                    {cameraIssue
                                                                        ? cameraIssueText(cameraIssue)
                                                                        : previewStarting
                                                                            ? t('live.console.previewStarting') || 'Starting camera...'
                                                                            : t('live.console.noCamera')}
                                                                </p>
                                                                {!isEnded && (cameraIssue || (isLive && connected)) && (
                                                                    <button
                                                                        onClick={() => void (connected ? retryCamera() : beginPreview())}
                                                                        disabled={retryingCamera || previewStarting}
                                                                        className={`${btnGhost} mt-2`}
                                                                    >
                                                                        {retryingCamera || previewStarting
                                                                            ? t('live.payment.processing') || 'Processing...'
                                                                            : t('live.console.retryCamera')}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan"></i>
                                                            </div>
                                                        )}
                                                        {isLocalSlot && localVideo && !connected && !isEnded && (
                                                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-slate-200 text-[10px] font-black uppercase tracking-widest">
                                                                {t('live.console.preview') || 'Preview'}
                                                            </span>
                                                        )}
                                                        {!isLocalSlot && (
                                                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-brand-green text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-brand-green animate-pulse"></span>
                                                                {slot === 'main'
                                                                    ? t('live.console.mainCamConnected') || 'Face cam connected'
                                                                    : t('live.console.tableCamConnected') || 'Table cam connected'}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        {/* Draggable split divider — absolute so it costs no
                                            flex height; z-10 keeps its pointer events above
                                            the feeds' pan handlers. Dual-cam only. */}
                                        {bothTilesShown && (
                                            <div
                                                role="separator"
                                                aria-label={
                                                    t('live.console.splitDivider') || 'Drag to resize the split'
                                                }
                                                className="absolute left-0 right-0 z-10 h-6 -translate-y-1/2 flex items-center justify-center cursor-row-resize touch-none"
                                                style={{ top: `${splitRatio * 100}%` }}
                                                onPointerDown={beginRatioDrag}
                                                onPointerMove={moveRatioDrag}
                                                onPointerUp={endRatioDrag}
                                                onPointerCancel={endRatioDrag}
                                            >
                                                <div className="w-14 h-1.5 rounded-full bg-white/70 shadow-[0_0_6px_rgba(0,0,0,0.6)]"></div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                                        <i className="fa-solid fa-video-slash text-slate-600 text-2xl mb-3"></i>
                                        <p className="text-xs text-slate-500 leading-relaxed">
                                            {isEnded
                                                ? t('live.viewer.ended') || 'Show ended'
                                                : cameraMode === 'none'
                                                    ? t('live.console.manageWaiting') ||
                                                      'No cameras connected yet — invite one with the QR code below'
                                                    : t('live.console.notLiveYet') || 'Not live yet'}
                                        </p>
                                    </div>
                                )}
                                {/* Audience sticker reactions, floated over the
                                    monitor so the breaker sees the room react. */}
                                <FloatingStickerLayer floats={stickerFloats} onDone={removeSticker} />
                            </div>
                            {/* Per-feed zoom + reset. Panning is drag-on-the-feed above. */}
                            {!nativeFallback && !isEnded && (mainTileTrack || tableTileTrack) && (
                                <div className="mt-3 space-y-2">
                                    <p className="text-[10px] text-slate-500 leading-relaxed">
                                        {t('live.console.layoutHint') ||
                                            'Drag the divider to resize the split, drag a feed to reposition, slide to zoom — viewers see exactly this framing.'}
                                    </p>
                                    {(
                                        [
                                            ['main', t('live.console.faceCam') || 'Face cam', !!mainTileTrack],
                                            ['table', t('live.console.tableCam') || 'Table cam', !!tableTileTrack],
                                        ] as const
                                    )
                                        .filter(([, , show]) => show)
                                        .map(([slot, label]) => {
                                            const fit = resolveFit(slot, cropOf(slot));
                                            const fitBtn = (value: FeedFit, text: string) => (
                                                <button
                                                    onClick={() => updateCrop(slot, { fit: value })}
                                                    aria-pressed={fit === value}
                                                    className={`px-2 h-6 text-[9px] font-black uppercase tracking-widest transition-colors ${
                                                        fit === value
                                                            ? 'bg-brand-cyan/20 text-brand-cyan'
                                                            : 'text-slate-500 hover:text-slate-300'
                                                    }`}
                                                >
                                                    {text}
                                                </button>
                                            );
                                            return (
                                                <div key={slot} className="flex items-center gap-2">
                                                    <span className="w-16 shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-500">
                                                        {label}
                                                    </span>
                                                    <input
                                                        type="range"
                                                        min={1}
                                                        max={3}
                                                        step={0.05}
                                                        value={cropOf(slot).zoom}
                                                        onChange={(e) =>
                                                            updateCrop(slot, { zoom: parseFloat(e.target.value) })
                                                        }
                                                        aria-label={label}
                                                        className="flex-1 accent-brand-cyan"
                                                    />
                                                    {/* Fill = cover-crop the slot; Fit = full FOV,
                                                        letterboxed over a blurred backdrop. */}
                                                    <div className="shrink-0 flex rounded-md overflow-hidden border border-white/10">
                                                        {fitBtn('cover', t('live.console.fitFill') || 'Fill')}
                                                        {fitBtn('contain', t('live.console.fitContain') || 'Fit')}
                                                    </div>
                                                    <button
                                                        onClick={() => updateCrop(slot, { ...DEFAULT_CROP })}
                                                        className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
                                                    >
                                                        {t('live.console.layoutReset') || 'Reset'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                </div>
                            )}
                            {/* Companion-cam QR, INLINE and automatic: minted the
                                moment the console is in the room (staged OR live)
                                with an uninvited slot open — always the COMPLEMENT
                                of what this console publishes; manage-only offers
                                both slots (table first). Collapses once the invited
                                cam connects; a drop re-mints a fresh token (see the
                                auto-QR effect). */}
                            {(isLive || isStaged) && desiredInviteSlot && (
                                <div className="mt-3 rounded-xl bg-black/20 border border-white/10 p-3 text-center">
                                    <p className="flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                        <i className="fa-solid fa-qrcode"></i>
                                        {desiredInviteSlot === 'main'
                                            ? t('live.console.faceCam') || 'Face cam'
                                            : t('live.console.tableCam') || 'Table cam'}
                                    </p>
                                    {cameraMode === 'none' &&
                                        !remoteMainConnected &&
                                        !remoteTableConnected && (
                                            <div className="mt-2 flex justify-center rounded-lg overflow-hidden border border-white/10 w-fit mx-auto">
                                                {(['table', 'main'] as const).map((slot) => (
                                                    <button
                                                        key={slot}
                                                        onClick={() => setInviteSlotChoice(slot)}
                                                        aria-pressed={desiredInviteSlot === slot}
                                                        className={`px-3 h-7 text-[9px] font-black uppercase tracking-widest transition-colors ${
                                                            desiredInviteSlot === slot
                                                                ? 'bg-brand-cyan/20 text-brand-cyan'
                                                                : 'text-slate-500 hover:text-slate-300'
                                                        }`}
                                                    >
                                                        {slot === 'main'
                                                            ? t('live.console.faceCam') || 'Face cam'
                                                            : t('live.console.tableCam') || 'Table cam'}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    {camInvite?.phase === 'ready' && camInvite.slot === desiredInviteSlot ? (
                                        <>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={camInvite.qr}
                                                alt={desiredInviteSlot === 'main' ? 'Face cam QR' : 'Table cam QR'}
                                                className="w-full max-w-[220px] mx-auto mt-2 rounded-xl"
                                            />
                                            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                                                {desiredInviteSlot === 'main'
                                                    ? t('live.console.mainCamHint') ||
                                                      'Scan with your second phone to publish the face camera.'
                                                    : t('live.console.tableCamHint') ||
                                                      'Scan with your second phone to publish the overhead table camera.'}
                                            </p>
                                            <button
                                                onClick={() => void copyCamInviteLink()}
                                                className="mt-2 w-full flex items-center gap-2 rounded-lg bg-black/30 border border-white/10 px-2.5 py-2 text-left active:scale-[0.99] transition-transform"
                                            >
                                                <i className="fa-solid fa-copy text-slate-400 text-[10px] shrink-0"></i>
                                                <span className="flex-1 text-[9px] text-slate-400 break-all leading-snug line-clamp-3">
                                                    {camInvite.link}
                                                </span>
                                            </button>
                                        </>
                                    ) : camInvite?.phase === 'error' && camInvite.slot === desiredInviteSlot ? (
                                        <div className="py-4">
                                            <i className="fa-solid fa-triangle-exclamation text-brand-red text-xl"></i>
                                            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                                                {camInvite.message}
                                            </p>
                                            <button
                                                onClick={() => void openCamInvite(desiredInviteSlot)}
                                                className={`${btnGhost} mt-3`}
                                            >
                                                {t('live.console.retry') || 'Retry'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="py-6">
                                            <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-xl"></i>
                                            <p className="text-[10px] text-slate-400 mt-2">
                                                {t('live.console.camLinkLoading') || 'Creating the camera link...'}
                                            </p>
                                        </div>
                                    )}
                                </div>
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
                                        <div className="block">
                                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                                                {t('live.console.itemType') || 'Format'}
                                            </span>
                                            <CustomSelect
                                                value={lotType}
                                                onChange={(v) => setLotType(v as BreakType)}
                                                ariaLabel={t('live.console.itemType') || 'Format'}
                                                triggerClassName={inputCls}
                                                options={BREAK_TYPES.map((bt) => ({
                                                    value: bt,
                                                    label: t(`live.types.${bt}`),
                                                }))}
                                            />
                                        </div>
                                        <div className="block">
                                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                                                {t('live.console.productType') || 'Product type'}
                                            </span>
                                            <CustomSelect
                                                value={lotProductType}
                                                onChange={(v) =>
                                                    setLotProductType(v as (typeof PRODUCT_TYPES)[number])
                                                }
                                                ariaLabel={t('live.console.productType') || 'Product type'}
                                                triggerClassName={inputCls}
                                                options={PRODUCT_TYPES.map((pt) => ({
                                                    value: pt,
                                                    label: t(`live.console.productTypes.${pt}`),
                                                }))}
                                            />
                                        </div>
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
                                    {/* Presales: only offered while the show is still
                                        scheduled — a live show's lots sell regardless. */}
                                    {stream.status === 'scheduled' && (
                                        <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-xl bg-black/20 border border-white/10 p-3">
                                            <input
                                                type="checkbox"
                                                checked={lotPresale}
                                                onChange={(e) => setLotPresale(e.target.checked)}
                                                className="mt-0.5 w-4 h-4 shrink-0 accent-brand-cyan"
                                            />
                                            <span>
                                                <span className="block text-xs font-bold text-white">
                                                    {t('live.console.presaleToggle') || 'Open presales'}
                                                </span>
                                                <span className="block text-[10px] text-slate-500 leading-relaxed mt-0.5">
                                                    {t('live.console.presaleHint') ||
                                                        'Buyers can buy spots on this lot before the show goes live.'}
                                                </span>
                                            </span>
                                        </label>
                                    )}
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
                                                {lot.presale_enabled && stream.status === 'scheduled' && (
                                                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-cyan text-[9px] font-black uppercase tracking-widest">
                                                        {t('live.console.presaleChip') || 'Presale'}
                                                    </span>
                                                )}
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

                    {/* ─── Column 3: poll + chat + moderation ─── */}
                    <div className="space-y-4">
                        <div className={sectionCls}>
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">
                                    {t('live.poll.title') || 'Poll'}
                                </h2>
                                {!isEnded && (!poll || poll.status === 'closed') && (
                                    <button onClick={() => setShowPollForm((v) => !v)} className={btnGhost}>
                                        <i className="fa-solid fa-square-poll-vertical mr-1.5"></i>
                                        {t('live.poll.ask') || 'Ask a poll'}
                                    </button>
                                )}
                            </div>

                            {showPollForm && !isEnded && (!poll || poll.status === 'closed') && (
                                <div className="mb-4 bg-black/20 rounded-xl p-3 space-y-2.5">
                                    <input
                                        value={pollQuestion}
                                        onChange={(e) => setPollQuestion(e.target.value)}
                                        maxLength={200}
                                        placeholder={
                                            t('live.poll.questionPlaceholder') ||
                                            'What should we ask the room?'
                                        }
                                        className={inputCls}
                                    />
                                    {pollOptions.map((opt, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <input
                                                value={opt}
                                                onChange={(e) =>
                                                    setPollOptions((prev) =>
                                                        prev.map((p, j) => (j === i ? e.target.value : p)),
                                                    )
                                                }
                                                maxLength={80}
                                                placeholder={`${t('live.poll.option') || 'Option'} ${i + 1}`}
                                                className={inputCls}
                                            />
                                            {pollOptions.length > 2 && (
                                                <button
                                                    onClick={() =>
                                                        setPollOptions((prev) => prev.filter((_, j) => j !== i))
                                                    }
                                                    aria-label={t('live.poll.removeOption') || 'Remove'}
                                                    className="w-8 h-8 shrink-0 rounded-lg bg-white/10 text-slate-400 text-xs active:scale-95 transition-all"
                                                >
                                                    <i className="fa-solid fa-xmark"></i>
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <div className="flex gap-2">
                                        {pollOptions.length < 4 && (
                                            <button
                                                onClick={() => setPollOptions((prev) => [...prev, ''])}
                                                className={btnGhost}
                                            >
                                                <i className="fa-solid fa-plus mr-1.5"></i>
                                                {t('live.poll.addOption') || 'Add option'}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => void createPoll()}
                                            disabled={
                                                creatingPoll ||
                                                !pollQuestion.trim() ||
                                                pollOptions.filter((o) => o.trim()).length < 2
                                            }
                                            className={`${btnPrimary} flex-1`}
                                        >
                                            {creatingPoll
                                                ? t('live.poll.starting') || 'Starting...'
                                                : t('live.poll.start') || 'Start poll'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {poll ? (
                                <div>
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
                                                : t('live.poll.closedChip') || 'Closed'}
                                        </span>
                                        <span className="ml-auto text-[10px] text-slate-400 font-bold tabular-nums">
                                            {pollTotalVotes(poll)} {t('live.poll.votes') || 'votes'}
                                        </span>
                                    </div>
                                    <p className="text-sm font-bold text-white leading-snug mb-2 break-words">
                                        {poll.question}
                                    </p>
                                    <PollOptionBars poll={poll} />
                                    {poll.status === 'open' && (
                                        <button
                                            onClick={() => void closePoll()}
                                            disabled={closingPoll}
                                            className={`${btnGhost} w-full mt-3 bg-amber-500/20 text-amber-300`}
                                        >
                                            {closingPoll
                                                ? t('live.payment.processing') || 'Processing...'
                                                : t('live.poll.close') || 'Close poll'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                !showPollForm && (
                                    <p className="text-xs text-slate-500 leading-relaxed">
                                        {t('live.poll.empty') ||
                                            'Ask the room a question — results update live.'}
                                    </p>
                                )
                            )}
                        </div>

                        <div className={`${sectionCls} flex flex-col max-h-[70vh]`}>
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
            </div>

            {/* ─── Camera-mode chooser (first visit per stream + the header
                 switch). Selecting stages immediately; picking a different
                 mode mid-session tears down and re-stages (applyCameraMode). ─── */}
            {modeChooserOpen && !isEnded && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 p-5">
                        <p className="text-sm font-black text-white uppercase tracking-wide">
                            {t('live.console.mode.title') || 'How will you broadcast from this device?'}
                        </p>
                        <div className="mt-3 space-y-2">
                            {(() => {
                                const recommended: ConsoleCameraMode = isPhoneLikeDevice()
                                    ? 'table'
                                    : 'main';
                                const order: ConsoleCameraMode[] =
                                    recommended === 'table'
                                        ? ['table', 'main', 'none']
                                        : ['main', 'table', 'none'];
                                const copy: Record<
                                    ConsoleCameraMode,
                                    { icon: string; title: string; desc: string }
                                > = {
                                    table: {
                                        icon: 'fa-camera',
                                        title:
                                            t('live.console.mode.tableTitle') ||
                                            'Use this device as the camera',
                                        desc:
                                            t('live.console.mode.tableDesc') ||
                                            'The rear camera shows your table — go live with just this phone.',
                                    },
                                    main: {
                                        icon: 'fa-user',
                                        title:
                                            t('live.console.mode.mainTitle') ||
                                            'This device is the face cam',
                                        desc:
                                            t('live.console.mode.mainDesc') ||
                                            'The front camera shows you — add a table cam by QR anytime.',
                                    },
                                    none: {
                                        icon: 'fa-sliders',
                                        title:
                                            t('live.console.mode.noneTitle') ||
                                            'Manage only — no camera',
                                        desc:
                                            t('live.console.mode.noneDesc') ||
                                            'Run the show from here; other devices publish the cameras via QR.',
                                    },
                                };
                                return order.map((mode) => (
                                    <button
                                        key={mode}
                                        onClick={() => void applyCameraMode(mode)}
                                        className={`w-full text-left rounded-xl border p-3 transition-colors ${
                                            cameraMode === mode
                                                ? 'border-brand-cyan/50 bg-brand-cyan/5'
                                                : 'border-white/10 bg-black/20 hover:border-brand-cyan/40'
                                        }`}
                                    >
                                        <span className="flex items-center gap-2.5">
                                            <i
                                                className={`fa-solid ${copy[mode].icon} text-brand-cyan text-sm w-5 text-center shrink-0`}
                                            ></i>
                                            <span className="text-sm font-bold text-white">
                                                {copy[mode].title}
                                            </span>
                                            {mode === recommended && (
                                                <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-cyan text-[9px] font-black uppercase tracking-widest">
                                                    {t('live.console.mode.recommended') || 'Recommended'}
                                                </span>
                                            )}
                                        </span>
                                        <span className="block text-[11px] text-slate-400 leading-relaxed mt-1">
                                            {copy[mode].desc}
                                        </span>
                                    </button>
                                ));
                            })()}
                        </div>
                        {/* Cancel exists only when a mode is already active —
                            the first visit must pick one before staging. */}
                        {cameraMode !== null && (
                            <button
                                onClick={() => setModeChooserOpen(false)}
                                className={`${btnGhost} w-full mt-3`}
                            >
                                {t('live.console.cancel') || 'Cancel'}
                            </button>
                        )}
                    </div>
                </div>
            )}

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

        </main>
    );
}
