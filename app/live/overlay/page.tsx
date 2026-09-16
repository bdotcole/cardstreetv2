'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/client';
import { useLiveKitRoom } from '@/lib/hooks/useLiveKitRoom';
import { TrackAudio } from '@/components/live/TrackVideo';
import { CroppedTrackVideo } from '@/components/live/CroppedTrackVideo';
import { fetchPublicSellers } from '@/lib/publicProfiles';
import {
    clampRatio,
    DEFAULT_RATIO,
    formatSatang,
    isSpotOpenNow,
    type LiveChatMessage,
    type LiveLotRow,
    type LiveSpotRow,
    type LiveStreamRow,
} from '@/components/live/shared';

/**
 * LiveKit egress TEMPLATE — the page LiveKit's headless Chrome records and
 * pushes to Facebook / YouTube / TikTok (and writes to the VOD). Nobody
 * browses here; the egress opens it as
 *   /live/overlay?url=<wss>&token=<recorder token>&layout=portrait|landscape
 * and waits for `START_RECORDING` on the console (LiveKit's custom-template
 * contract) before it starts capturing.
 *
 * What it draws: the broadcaster's two feeds in the broadcaster's own framing
 * (same CroppedTrackVideo + streams.layout as the viewer, so what the seller
 * frames is what every surface shows) with the CardStreet call-to-action
 * burned in — cardstreet.app/watch as text AND as a QR, the lot on the block
 * with price and spots left, the pinned message, and the last few chat lines.
 * That overlay is the whole point of multistreaming: a viewer on Facebook has
 * no buy button, so the frame itself has to tell them where the buy button is.
 *
 * Rules for a page that lives inside an egress:
 *   - no auth, no cookies: identity is the recorder token; data comes from the
 *     public stream detail GET + anon Realtime (RLS opened by
 *     20260822_public_live_viewing.sql).
 *   - stay cheap: no backdrop-filter or heavy animation — the recorder Chrome
 *     has no GPU and every dropped frame goes out to every channel.
 *   - never hang: START_RECORDING is logged on connect, or after a grace
 *     period regardless, so a failed join records the branded frame instead
 *     of stalling the egress.
 *   - keep the platform's own UI clear: TikTok/Instagram draw comments and
 *     buttons over the bottom and right edges, so the CTA sits above a
 *     bottom safe zone and hugs the left.
 *
 * Preview without an egress: /live/overlay?stream=<id>&layout=portrait
 * renders the data layers over a blank stage (no video) for design checks.
 */

const WATCH_URL_TEXT = 'cardstreet.app/watch';
const QR_URL = 'https://cardstreet.app/watch?utm_source=social&utm_medium=overlay_qr&utm_campaign=live_watch';
/** Log START_RECORDING no later than this after mount, connected or not. */
const START_GRACE_MS = 8_000;
/** A dropped recorder connection gets this long to come back before END_RECORDING. */
const END_AFTER_DISCONNECT_MS = 45_000;
const CHAT_LINES = 4;
const CHAT_TAIL_POLL_MS = 20_000;

type Orientation = 'portrait' | 'landscape';

interface TemplateParams {
    url: string | null;
    token: string | null;
    layout: Orientation;
    previewStreamId: string | null;
}

function readParams(): TemplateParams {
    const q = new URLSearchParams(window.location.search);
    return {
        url: q.get('url'),
        token: q.get('token'),
        layout: q.get('layout') === 'landscape' ? 'landscape' : 'portrait',
        previewStreamId: q.get('stream'),
    };
}

/** The room name rides the LiveKit token's `video.room` grant — no extra query param needed. */
function roomFromToken(token: string): string | null {
    try {
        const part = token.split('.')[1] ?? '';
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const payload = JSON.parse(atob(padded)) as { video?: { room?: string } };
        return payload?.video?.room ?? null;
    } catch {
        return null;
    }
}

export default function LiveOverlayTemplatePage() {
    const [params, setParams] = useState<TemplateParams | null>(null);
    const [stream, setStream] = useState<LiveStreamRow | null>(null);
    const [lots, setLots] = useState<LiveLotRow[]>([]);
    const [spots, setSpots] = useState<LiveSpotRow[]>([]);
    const [chat, setChat] = useState<LiveChatMessage[]>([]);
    const [names, setNames] = useState<Map<string, string>>(new Map());
    const [qr, setQr] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    const supabaseRef = useRef(createClient());
    const startedRef = useRef(false);
    const endedRef = useRef(false);
    const wasConnectedRef = useRef(false);

    const { connect, connected, remoteFeeds, setSubscriptionQuality } = useLiveKitRoom();

    useEffect(() => {
        setParams(readParams());
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, []);

    const streamId = useMemo(() => {
        if (!params) return null;
        if (params.previewStreamId) return params.previewStreamId;
        const room = params.token ? roomFromToken(params.token) : null;
        return room?.startsWith('stream_') ? room.slice('stream_'.length) : null;
    }, [params]);

    // ─── Recorder signals ───
    const signalStart = useCallback(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        console.log('START_RECORDING');
    }, []);

    useEffect(() => {
        const timer = setTimeout(signalStart, START_GRACE_MS);
        return () => clearTimeout(timer);
    }, [signalStart]);

    useEffect(() => {
        if (connected) {
            wasConnectedRef.current = true;
            signalStart();
        }
    }, [connected, signalStart]);

    // ─── Join the room (recorder token, subscribe-only) ───
    const [connectAttempt, setConnectAttempt] = useState(0);
    useEffect(() => {
        if (!params?.url || !params.token || connected) return;
        let cancelled = false;
        let retry: ReturnType<typeof setTimeout> | null = null;
        (async () => {
            try {
                setSubscriptionQuality('high');
                await connect(params.url as string, params.token as string);
            } catch {
                if (!cancelled) {
                    retry = setTimeout(
                        () => setConnectAttempt((a) => a + 1),
                        Math.min(2000 * (connectAttempt + 1), 10_000),
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
            if (retry) clearTimeout(retry);
        };
    }, [params, connected, connect, setSubscriptionQuality, connectAttempt]);

    // A recorder connection that drops and stays down means the room is gone:
    // tell the egress to finalize. A blip that reconnects within the window
    // is invisible to the recording.
    useEffect(() => {
        if (connected || !wasConnectedRef.current || endedRef.current) return;
        const timer = setTimeout(() => {
            if (endedRef.current) return;
            endedRef.current = true;
            console.log('END_RECORDING');
        }, END_AFTER_DISCONNECT_MS);
        return () => clearTimeout(timer);
    }, [connected]);

    // ─── Data: public stream detail + chat, then Realtime ───
    const loadDetail = useCallback(async () => {
        if (!streamId) return;
        try {
            const [detailRes, chatRes] = await Promise.all([
                fetch(`/api/live/streams/${streamId}`),
                fetch(`/api/live/streams/${streamId}/chat`),
            ]);
            if (detailRes.ok) {
                const detail = await detailRes.json();
                setStream(detail.stream);
                setLots(detail.items ?? []);
                setSpots(detail.spots ?? []);
            }
            if (chatRes.ok) {
                const data = await chatRes.json();
                setChat(((data.messages ?? []) as LiveChatMessage[]).slice(-40));
            }
        } catch {
            // The next poll or Realtime event catches us up.
        }
    }, [streamId]);

    useEffect(() => {
        void loadDetail();
    }, [loadDetail]);

    // Realtime drops rows now and then (proven mid-show); a slow chat-tail
    // poll keeps the ticker honest without hammering the API.
    useEffect(() => {
        if (!streamId) return;
        const timer = setInterval(() => void loadDetail(), CHAT_TAIL_POLL_MS);
        return () => clearInterval(timer);
    }, [streamId, loadDetail]);

    useEffect(() => {
        if (!streamId) return;
        const supabase = supabaseRef.current;
        const channel = supabase
            .channel(`live-overlay-${streamId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'streams', filter: `id=eq.${streamId}` },
                (payload) =>
                    setStream((prev) => (prev ? { ...prev, ...(payload.new as LiveStreamRow) } : prev)),
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'stream_items', filter: `stream_id=eq.${streamId}` },
                (payload) => {
                    const row = payload.new as LiveLotRow;
                    if (!row?.id) return;
                    setLots((prev) => {
                        const idx = prev.findIndex((l) => l.id === row.id);
                        if (idx === -1) return [...prev, row];
                        const next = [...prev];
                        next[idx] = { ...next[idx], ...row };
                        return next;
                    });
                },
            )
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
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'stream_chat_messages',
                    filter: `stream_id=eq.${streamId}`,
                },
                (payload) => {
                    const msg = payload.new as LiveChatMessage;
                    setChat((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-40)));
                },
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [streamId]);

    // Sender names for chat rows that arrived without one (Realtime rows).
    useEffect(() => {
        const missing = [
            ...new Set(
                chat
                    .filter((m) => !m.is_system && !m.sender?.display_name && !names.has(m.sender_id))
                    .map((m) => m.sender_id),
            ),
        ];
        if (missing.length === 0) return;
        let cancelled = false;
        void fetchPublicSellers(supabaseRef.current, missing)
            .then((sellers) => {
                if (cancelled) return;
                setNames((prev) => {
                    const next = new Map(prev);
                    for (const [id, s] of sellers) next.set(id, s.display_name || 'viewer');
                    for (const id of missing) if (!next.has(id)) next.set(id, 'viewer');
                    return next;
                });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [chat, names]);

    useEffect(() => {
        void QRCode.toDataURL(QR_URL, {
            width: 512,
            margin: 1,
            errorCorrectionLevel: 'M',
            color: { dark: '#0b1020', light: '#ffffff' },
        })
            .then(setQr)
            .catch(() => setQr(null));
    }, []);

    // ─── Derived ───
    const layout: Orientation = params?.layout ?? 'portrait';
    const activeLot = useMemo(() => {
        if (!stream) return null;
        return (
            lots.find((l) => l.id === stream.current_item_id) ??
            lots.find((l) => l.status === 'active') ??
            null
        );
    }, [lots, stream]);
    const lotSpots = useMemo(
        () => (activeLot ? spots.filter((s) => s.stream_item_id === activeLot.id) : []),
        [spots, activeLot],
    );
    const openCount = lotSpots.filter((s) => isSpotOpenNow(s, now)).length;
    const soldCount = lotSpots.filter((s) => s.status === 'sold').length;
    const totalCount = lotSpots.length;
    const priceSatang =
        activeLot?.auction?.current_price ??
        activeLot?.spot_price ??
        activeLot?.price ??
        null;
    const faceRatio = clampRatio(stream?.layout?.ratio) ?? DEFAULT_RATIO;
    const mainTrack = remoteFeeds.video.main ?? null;
    const tableTrack = remoteFeeds.video.table ?? null;
    const feedCount = (mainTrack ? 1 : 0) + (tableTrack ? 1 : 0);
    const isLive = stream?.status === 'live';
    const chatTail = chat.slice(-CHAT_LINES);
    const senderName = (m: LiveChatMessage) =>
        m.sender?.display_name || names.get(m.sender_id) || 'viewer';

    // ─── Feeds (the broadcaster's framing, same component as the viewer) ───
    const feeds = (
        <div className="absolute inset-0 bg-black">
            {feedCount === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-white/40 font-black uppercase tracking-[0.3em]" style={{ fontSize: '2.2vmin' }}>
                        {isLive ? 'LIVE' : 'CardStreet Live'}
                    </p>
                </div>
            ) : feedCount === 1 ? (
                <CroppedTrackVideo
                    track={mainTrack ?? tableTrack}
                    crop={mainTrack ? stream?.layout?.main : stream?.layout?.table}
                    slot={mainTrack ? 'main' : 'table'}
                    defaultFit="cover"
                    className="absolute inset-0"
                />
            ) : layout === 'portrait' ? (
                <div className="absolute inset-0 flex flex-col">
                    <div className="relative" style={{ height: `${faceRatio * 100}%` }}>
                        <CroppedTrackVideo
                            track={mainTrack}
                            crop={stream?.layout?.main}
                            slot="main"
                            className="absolute inset-0"
                        />
                    </div>
                    <div className="relative border-t border-white/10" style={{ height: `${(1 - faceRatio) * 100}%` }}>
                        <CroppedTrackVideo
                            track={tableTrack}
                            crop={stream?.layout?.table}
                            slot="table"
                            className="absolute inset-0"
                        />
                    </div>
                </div>
            ) : (
                // Landscape: the table (the cards) fills the stage, the face
                // cam sits picture-in-picture top-right.
                <>
                    <CroppedTrackVideo
                        track={tableTrack}
                        crop={stream?.layout?.table}
                        slot="table"
                        defaultFit="cover"
                        className="absolute inset-0"
                    />
                    <div
                        className="absolute overflow-hidden rounded-2xl border-2 border-white/30 bg-black"
                        style={{ top: '3%', right: '3%', width: '24%', aspectRatio: '3 / 4' }}
                    >
                        <CroppedTrackVideo
                            track={mainTrack}
                            crop={stream?.layout?.main}
                            slot="main"
                            defaultFit="cover"
                            className="absolute inset-0"
                        />
                    </div>
                </>
            )}
            {remoteFeeds.audio.map((track, i) => (
                <TrackAudio key={track.sid ?? i} track={track} muted={false} />
            ))}
        </div>
    );

    // ─── Overlay pieces ───
    const livePill = (
        <div className="flex items-center gap-[0.6em]" style={{ fontSize: layout === 'portrait' ? '2.4vh' : '2.6vh' }}>
            {isLive && (
                <span className="inline-flex items-center gap-[0.4em] rounded-md bg-[#e11d48] text-white font-black uppercase tracking-widest px-[0.7em] py-[0.25em]">
                    <span className="w-[0.5em] h-[0.5em] rounded-full bg-white animate-pulse"></span>
                    LIVE
                </span>
            )}
            {stream?.seller?.display_name && (
                <span className="inline-flex items-center gap-[0.5em] rounded-md bg-black/60 text-white font-bold px-[0.7em] py-[0.25em] max-w-[60vw] truncate">
                    {stream.seller.avatar_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={stream.seller.avatar_url} alt="" className="w-[1.4em] h-[1.4em] rounded-full object-cover" />
                    )}
                    {stream.seller.display_name}
                </span>
            )}
        </div>
    );

    const lotCard = activeLot && (
        <div className="rounded-2xl bg-black/70 border border-white/15 text-white flex items-center gap-[1em] p-[0.8em]" style={{ fontSize: layout === 'portrait' ? '2.2vh' : '2.4vh' }}>
            {activeLot.card_data?.images?.small && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={activeLot.card_data.images.small}
                    alt=""
                    className="h-[4.2em] w-auto rounded-lg object-cover shrink-0"
                />
            )}
            <div className="min-w-0 flex-1">
                <p className="text-[#22d3ee] font-black uppercase tracking-[0.25em]" style={{ fontSize: '0.6em' }}>
                    {isLive ? 'Now on the block' : 'Next up'}
                </p>
                <p className="font-black leading-tight truncate" style={{ fontSize: '1.05em' }}>
                    {activeLot.card_data?.name || 'Live break'}
                </p>
                <div className="flex items-center gap-[0.8em] mt-[0.2em]" style={{ fontSize: '0.8em' }}>
                    {priceSatang != null && <span className="font-black text-white">{formatSatang(priceSatang)}</span>}
                    {totalCount > 0 && (
                        <span className={openCount > 0 ? 'text-emerald-300 font-bold' : 'text-slate-300 font-bold'}>
                            {openCount > 0 ? `${openCount} of ${totalCount} spots left` : 'Sold out'}
                        </span>
                    )}
                </div>
                {totalCount > 0 && (
                    <div className="mt-[0.45em] h-[0.35em] rounded-full bg-white/15 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-[#22d3ee]"
                            style={{ width: `${Math.round((soldCount / totalCount) * 100)}%` }}
                        ></div>
                    </div>
                )}
            </div>
        </div>
    );

    // The URL is the whole point of the overlay, so its size comes from the
    // width it actually has and it can never be truncated: "cardstreet.app/
    // watch" is ~14 character-widths of a black weight. Portrait: text sits
    // beside the QR in an 82vw card; landscape: the rail is only 30vw wide,
    // so the card stacks (QR above, URL below) to keep the type legible.
    const ctaCard = (
        <div
            className={`rounded-2xl bg-white text-[#0b1020] flex gap-[0.9em] p-[0.7em] shadow-[0_10px_40px_rgba(0,0,0,0.45)] ${
                layout === 'portrait' ? 'items-center' : 'flex-col items-center text-center'
            }`}
            style={{ fontSize: layout === 'portrait' ? '2.6vh' : '2.9vh' }}
        >
            {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={qr}
                    alt=""
                    className={`rounded-lg shrink-0 ${layout === 'portrait' ? 'w-[4.6em] h-[4.6em]' : 'w-[7em] h-[7em]'}`}
                />
            )}
            <div className="min-w-0 flex-1">
                <p className="font-black uppercase tracking-[0.18em] text-[#0891b2] whitespace-nowrap" style={{ fontSize: '0.55em' }}>
                    ซื้อสล็อตสด · Buy spots live
                </p>
                <p
                    className="font-black leading-none tracking-tight whitespace-nowrap"
                    style={{ fontSize: layout === 'portrait' ? '4.8vw' : '1.85vw' }}
                >
                    {WATCH_URL_TEXT}
                </p>
                <p className="font-bold text-slate-600 leading-snug mt-[0.3em]" style={{ fontSize: '0.6em' }}>
                    สแกน QR หรือพิมพ์ลิงก์ · Scan or type the link
                </p>
            </div>
        </div>
    );

    const pinned = stream?.pinned_message && (
        <div className="rounded-xl bg-[#22d3ee] text-[#0b1020] font-black px-[0.8em] py-[0.45em] leading-snug" style={{ fontSize: layout === 'portrait' ? '2.1vh' : '2.3vh' }}>
            <i className="fa-solid fa-thumbtack mr-[0.5em]"></i>
            {stream.pinned_message}
        </div>
    );

    const chatTicker = chatTail.length > 0 && (
        <div className="space-y-[0.35em]" style={{ fontSize: layout === 'portrait' ? '2vh' : '2.2vh' }}>
            {chatTail.map((m) => (
                <p
                    key={m.id}
                    className={`inline-block max-w-full truncate rounded-lg px-[0.7em] py-[0.3em] leading-snug ${
                        m.is_system ? 'bg-[#22d3ee]/20 text-[#a5f3fc] font-bold' : 'bg-black/60 text-white'
                    }`}
                >
                    {!m.is_system && <span className="font-black text-[#22d3ee] mr-[0.5em]">{senderName(m)}</span>}
                    {m.body}
                </p>
            ))}
        </div>
    );

    return (
        <div className="fixed inset-0 overflow-hidden bg-[#05070d] text-white select-none" style={{ pointerEvents: 'none' }}>
            {feeds}

            {/* Top edge: identity. A soft gradient keeps the pill legible over a bright feed. */}
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent" style={{ height: '14%' }}></div>
            <div className="absolute flex items-center justify-between" style={{ top: '2.5%', left: '4%', right: '4%' }}>
                {livePill}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="CardStreet" className="rounded-xl" style={{ height: layout === 'portrait' ? '5vh' : '7vh' }} />
            </div>

            {layout === 'portrait' ? (
                // Portrait: everything stacks bottom-left above the platform's
                // own comment/buttons zone; the right ~14% stays clear.
                <>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" style={{ height: '48%' }}></div>
                    <div className="absolute flex flex-col gap-[1.2vh]" style={{ left: '4%', right: '14%', bottom: '17%' }}>
                        {chatTicker}
                        {pinned}
                        {lotCard}
                        {ctaCard}
                    </div>
                </>
            ) : (
                // Landscape: a right-hand rail under the PIP.
                <>
                    <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-black/70 to-transparent" style={{ width: '40%' }}></div>
                    <div className="absolute flex flex-col gap-[1.4vh]" style={{ right: '3%', width: '30%', top: '40%' }}>
                        {pinned}
                        {lotCard}
                        {ctaCard}
                    </div>
                    <div className="absolute" style={{ left: '3%', bottom: '5%', width: '50%' }}>
                        {chatTicker}
                    </div>
                </>
            )}
        </div>
    );
}
