/**
 * Server-only LiveKit helpers for live breaks: token minting + room-composite
 * recording. Import ONLY from route handlers / server code — the API secret
 * must never reach a 'use client' module (same rule as lib/supabase/admin.ts).
 *
 * Dual-cam model: one LiveKit room per stream; the seller publishes from TWO
 * devices (console phone = 'main', overhead phone = 'table'). LiveKit evicts
 * an existing participant when a new connection reuses its identity, so each
 * camera slot gets an identity suffix — that is what lets the SAME seller hold
 * two concurrent publisher tokens. The client reads the slot from participant
 * metadata to lay out the two feeds.
 */

import {
    AccessToken,
    EgressClient,
    EgressStatus,
    EncodedFileOutput,
    EncodedFileType,
    EncodingOptionsPreset,
    RoomServiceClient,
    S3Upload,
    StreamOutput,
    StreamProtocol,
} from 'livekit-server-sdk';

export type CameraSlot = 'main' | 'table';

interface LiveKitConfig {
    url: string;
    apiKey: string;
    apiSecret: string;
}

// Lazy, not at module load: routes that never mint a token (e.g. chat) must
// not crash on import in an environment without LiveKit env vars.
function getLiveKitConfig(): LiveKitConfig {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
        throw new Error(
            '[LiveKit] LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must all be set',
        );
    }
    return { url, apiKey, apiSecret };
}

// LIVEKIT_URL is the wss:// signal URL clients connect to; the server APIs
// (egress) want the same host over http(s).
function httpHost(url: string): string {
    return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

export function roomNameForStream(streamId: string): string {
    return `stream_${streamId}`;
}

// Long enough to outlive any realistic show; clients re-request on expiry.
const TOKEN_TTL = '12h';

/** Subscribe-only grant. Chat rides the API + Supabase Realtime, not the
 *  LiveKit data channel, so viewers get no publish surface at all. */
export async function mintViewerToken(room: string, identity: string): Promise<string> {
    const { apiKey, apiSecret } = getLiveKitConfig();
    const at = new AccessToken(apiKey, apiSecret, { identity, ttl: TOKEN_TTL });
    at.addGrant({
        room,
        roomJoin: true,
        canSubscribe: true,
        canPublish: false,
        canPublishData: false,
    });
    return at.toJwt();
}

/** Publisher grant for one of the seller's two camera devices. */
export async function mintPublisherToken(
    room: string,
    identity: string,
    cameraSlot: CameraSlot,
): Promise<string> {
    const { apiKey, apiSecret } = getLiveKitConfig();
    const at = new AccessToken(apiKey, apiSecret, {
        // ':main' / ':table' suffix — see the dual-cam note in the file header.
        identity: `${identity}:${cameraSlot}`,
        ttl: TOKEN_TTL,
        metadata: JSON.stringify({ cameraSlot }),
    });
    at.addGrant({
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });
    return at.toJwt();
}

/**
 * Room-composite egress for a show: ONE egress that records the 30-day VOD
 * (file output, when the S3/R2 env is set) AND pushes the same composite to
 * the seller's social channels (RTMP stream outputs — Facebook Live, YouTube,
 * TikTok, Instagram Live Producer...). One egress, not one per output: it is
 * billed per minute of egress, so multistreaming to five channels costs the
 * same as recording alone.
 *
 * With a template base URL the composite is OUR page (app/live/overlay) —
 * the two camera feeds plus the CardStreet call-to-action (cardstreet.app/watch
 * + QR + the lot on the block) burned into every frame, which is how a viewer
 * on Facebook finds their way to the checkout. Without one LiveKit's built-in
 * grid layout renders the feeds bare. `orientation` sizes the canvas:
 * portrait (1080x1920) is phone-native for TikTok / Instagram / Facebook
 * mobile, landscape (1920x1080) suits YouTube on a TV.
 *
 * Best-effort by design: recording/streaming is not a dependency of
 * broadcasting, so a missing storage config with no destinations skips
 * quietly, and a LiveKit error logs and returns null — go-live proceeds.
 * Stream URLs carry the seller's stream keys: never logged.
 */
export interface RoomEgressOptions {
    /** Full RTMP(S) URLs including stream keys. */
    rtmpUrls?: string[];
    orientation?: 'portrait' | 'landscape';
    /** Absolute https URL of the overlay template; null/undefined = built-in grid. */
    templateBaseUrl?: string | null;
}

function s3FileOutput(room: string): EncodedFileOutput | null {
    const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET;
    const accessKey = process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY;
    const secret = process.env.LIVEKIT_EGRESS_S3_SECRET;
    if (!bucket || !accessKey || !secret) return null;
    return new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: `live-vods/${room}/{time}.mp4`,
        output: {
            case: 's3',
            value: new S3Upload({
                bucket,
                accessKey,
                secret,
                // Cloudflare R2 (and most S3-compatible stores) reject an
                // empty region and expect the literal 'auto'. Real AWS keeps
                // whatever is configured, where the region is part of
                // addressing.
                region:
                    process.env.LIVEKIT_EGRESS_S3_REGION ||
                    (process.env.LIVEKIT_EGRESS_S3_ENDPOINT ? 'auto' : ''),
                endpoint: process.env.LIVEKIT_EGRESS_S3_ENDPOINT || '',
                // R2 does not implement per-object ACLs; forcing path-style
                // addressing keeps the upload URL shape it expects (bucket in
                // the path, not the host).
                forcePathStyle: true,
            }),
        },
    });
}

function presetFor(orientation: 'portrait' | 'landscape'): EncodingOptionsPreset {
    return orientation === 'portrait'
        ? EncodingOptionsPreset.PORTRAIT_H264_1080P_30
        : EncodingOptionsPreset.H264_1080P_30;
}

export async function startRoomEgress(
    room: string,
    opts: RoomEgressOptions = {},
): Promise<string | null> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();

        const file = s3FileOutput(room);
        const rtmpUrls = (opts.rtmpUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0);
        const stream =
            rtmpUrls.length > 0
                ? new StreamOutput({ protocol: StreamProtocol.RTMP, urls: rtmpUrls })
                : null;
        if (!file && !stream) {
            console.warn(
                '[LiveKit] egress S3 env not configured and no stream destinations — skipping egress',
            );
            return null;
        }

        const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
        const egress = new EgressClient(httpHost(url), apiKey, apiSecret);
        const info = await egress.startRoomCompositeEgress(
            room,
            { ...(file ? { file } : {}), ...(stream ? { stream } : {}) },
            opts.templateBaseUrl
                ? {
                      // Our template reads the orientation off the layout
                      // param; the canvas size comes from the preset.
                      layout: orientation,
                      customBaseUrl: opts.templateBaseUrl,
                      encodingOptions: presetFor(orientation),
                  }
                : {
                      // Grid shows both camera slots side by side.
                      layout: 'grid',
                      encodingOptions: presetFor(orientation),
                  },
        );
        console.log(
            `[LiveKit] egress started for ${room}: file=${file ? 'yes' : 'no'} streams=${rtmpUrls.length} template=${opts.templateBaseUrl ? 'overlay' : 'grid'} ${orientation}`,
        );
        return info.egressId || null;
    } catch (err) {
        console.error('[LiveKit] startRoomEgress failed (non-fatal):', err);
        return null;
    }
}

const RTMP_URL_IN_TEXT = /rtmps?:\/\/\S+/gi;

/**
 * Add / remove RTMP outputs on a RUNNING egress — the console's mid-show
 * "start on Facebook" / "stop on YouTube". Returns a message (never the URL)
 * on failure so the console can say why.
 */
export async function updateEgressStreamUrls(
    egressId: string,
    addUrls: string[],
    removeUrls: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();
        const egress = new EgressClient(httpHost(url), apiKey, apiSecret);
        await egress.updateStream(egressId, addUrls, removeUrls);
        return { ok: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // LiveKit echoes the offending URL (key included) in some errors.
        const safe = message.replace(RTMP_URL_IN_TEXT, '<rtmp url>');
        console.error('[LiveKit] updateEgressStreamUrls failed:', safe);
        return { ok: false, error: safe };
    }
}

export interface EgressSnapshot {
    status: EgressStatus;
    /** STARTING or ACTIVE — outputs can still be added. */
    active: boolean;
    streamResults: { url: string; status: number; error: string }[];
}

/** Current state of one egress, or null when LiveKit can't answer (or it's gone). */
export async function getEgressSnapshot(egressId: string): Promise<EgressSnapshot | null> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();
        const egress = new EgressClient(httpHost(url), apiKey, apiSecret);
        const list = await egress.listEgress({ egressId });
        const info = list.find((e) => e.egressId === egressId) ?? list[0];
        if (!info) return null;
        return {
            status: info.status,
            active:
                info.status === EgressStatus.EGRESS_STARTING ||
                info.status === EgressStatus.EGRESS_ACTIVE,
            streamResults: (info.streamResults ?? []).map((s) => ({
                url: s.url,
                status: s.status as number,
                error: s.error ?? '',
            })),
        };
    } catch (err) {
        console.error('[LiveKit] getEgressSnapshot failed:', err);
        return null;
    }
}

/** Stop an egress. Never throws — an already-finished egress errors on stop,
 *  and ending the stream must not fail over it. Returns whether the stop
 *  actually landed, so the watchdog can tell a real failure (billing keeps
 *  running) from an ordinary already-finished one and retry next sweep. */
export async function stopRoomRecording(egressId: string): Promise<boolean> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();
        const egress = new EgressClient(httpHost(url), apiKey, apiSecret);
        await egress.stopEgress(egressId);
        return true;
    } catch (err) {
        console.error('[LiveKit] stopRoomRecording failed (non-fatal):', err);
        return false;
    }
}

/**
 * Publisher count for a room, or null when LiveKit can't answer (unset config,
 * API error). Null is NOT zero — the watchdog must never end a show because
 * the control plane hiccuped, so callers treat null as "unknown, leave alone".
 *
 * A room LiveKit has already reaped reports 0 via listRooms returning nothing.
 * That is the signal worth acting on: LiveKit only closes a room after it has
 * been empty for `emptyTimeout`, so an absent room means "empty for a while"
 * without us having to track emptiness ourselves across cron runs.
 */
export async function getRoomActivity(
    room: string,
): Promise<{ exists: boolean; numPublishers: number } | null> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();
        const svc = new RoomServiceClient(httpHost(url), apiKey, apiSecret);
        const rooms = await svc.listRooms([room]);
        const found = rooms.find((r) => r.name === room);
        if (!found) return { exists: false, numPublishers: 0 };
        return { exists: true, numPublishers: found.numPublishers };
    } catch (err) {
        console.error('[LiveKit] getRoomActivity failed:', err);
        return null;
    }
}

/**
 * Concurrent VIEWER count for a room — participants minus the broadcaster's
 * devices — or null when LiveKit can't answer (unknown, not zero). Broadcaster
 * devices are the ':main'/':table'/':monitor' identity suffixes
 * (mintPublisherToken / the monitor grant); everyone else in the room holds a
 * subscribe-only viewer token.
 */
export async function countRoomViewers(room: string): Promise<number | null> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();
        const svc = new RoomServiceClient(httpHost(url), apiKey, apiSecret);
        const participants = await svc.listParticipants(room);
        return participants.filter((p) => !/:(main|table|monitor)$/.test(p.identity)).length;
    } catch (err) {
        // Includes the room-already-reaped case — indistinguishable from an
        // API fault here, and peak tracking must never invent a zero.
        console.error('[LiveKit] countRoomViewers failed:', err);
        return null;
    }
}

/**
 * Every egress currently running on the account, or null if LiveKit can't be
 * reached. Used by the watchdog to catch recordings that outlived the stream
 * row — stopRoomRecording is best-effort, so a failed stop at end-time leaves
 * an egress billing by the minute with nothing pointing at it.
 */
export async function listActiveEgresses(): Promise<
    { egressId: string; roomName: string }[] | null
> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();
        const egress = new EgressClient(httpHost(url), apiKey, apiSecret);
        const list = await egress.listEgress({ active: true });
        return list.map((e) => ({ egressId: e.egressId, roomName: e.roomName }));
    } catch (err) {
        console.error('[LiveKit] listActiveEgresses failed:', err);
        return null;
    }
}
