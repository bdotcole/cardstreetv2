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
    EncodedFileOutput,
    EncodedFileType,
    RoomServiceClient,
    S3Upload,
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
 * Start a room-composite egress recording all publishers (the 30-day VOD is
 * the dispute-evidence trail next to break_opened_at). Best-effort by design:
 * recording is evidence, not a dependency of broadcasting, so a missing egress
 * storage config or a LiveKit error logs and returns null — go-live proceeds.
 */
export async function startRoomRecording(room: string): Promise<string | null> {
    try {
        const { url, apiKey, apiSecret } = getLiveKitConfig();

        const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET;
        const accessKey = process.env.LIVEKIT_EGRESS_S3_ACCESS_KEY;
        const secret = process.env.LIVEKIT_EGRESS_S3_SECRET;
        if (!bucket || !accessKey || !secret) {
            console.warn('[LiveKit] egress S3 env not configured — skipping VOD recording');
            return null;
        }

        const egress = new EgressClient(httpHost(url), apiKey, apiSecret);
        const info = await egress.startRoomCompositeEgress(
            room,
            {
                file: new EncodedFileOutput({
                    fileType: EncodedFileType.MP4,
                    filepath: `live-vods/${room}/{time}.mp4`,
                    output: {
                        case: 's3',
                        value: new S3Upload({
                            bucket,
                            accessKey,
                            secret,
                            // Cloudflare R2 (and most S3-compatible stores)
                            // reject an empty region and expect the literal
                            // 'auto'. Real AWS keeps whatever is configured,
                            // where the region is part of addressing.
                            region:
                                process.env.LIVEKIT_EGRESS_S3_REGION ||
                                (process.env.LIVEKIT_EGRESS_S3_ENDPOINT ? 'auto' : ''),
                            endpoint: process.env.LIVEKIT_EGRESS_S3_ENDPOINT || '',
                            // R2 does not implement per-object ACLs; forcing
                            // path-style addressing keeps the upload URL shape
                            // it expects (bucket in the path, not the host).
                            forcePathStyle: true,
                        }),
                    },
                }),
            },
            // Grid shows both camera slots side by side in the recording.
            { layout: 'grid' },
        );
        return info.egressId || null;
    } catch (err) {
        console.error('[LiveKit] startRoomRecording failed (non-fatal):', err);
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
