'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ConnectionState,
    LocalTrack,
    LocalVideoTrack,
    Participant,
    RemoteTrack,
    Room,
    RoomEvent,
    Track,
    VideoPresets,
    VideoQuality,
    createLocalTracks,
    type AudioCaptureOptions,
    type TrackPublishOptions,
    type VideoCaptureOptions,
} from 'livekit-client';

/**
 * One LiveKit room, three consumers: the viewer (subscribe-only), the console
 * (publishes the 'main' face cam) and the table-cam page (publishes 'table').
 * This hook owns the Room lifecycle and exposes remote tracks KEYED BY CAMERA
 * SLOT, read from participant metadata — the seller's two devices join with
 * ':main'/':table' identity suffixes and a {cameraSlot} metadata blob (see
 * lib/livekit.ts), which is the only thing that distinguishes the feeds.
 */

export type CameraSlot = 'main' | 'table';

// ─── Quality settings ───
// Field feedback: the dual-cam stream worked but looked bad. Three compounding
// defaults were at fault — capture at the library default (720p even for the
// table cam), publishTrack with no options (auto bitrate ~1.7Mbps, no content
// hint), and adaptiveStream measuring attached elements in CSS pixels (so a
// phone's 3x display was served the LOW simulcast layer). The settings below
// raise the ceiling; simulcast keeps that safe — mobile-data viewers are
// automatically served the lower layers, only capable connections get the top.

/**
 * Capture constraints per camera. LiveKit turns the preset into `ideal`
 * getUserMedia constraints, so a device that can't reach the requested
 * resolution silently delivers its best — the 1080p table-cam ask degrades to
 * 720p and below on older phones with no manual fallback needed.
 * - Face cam ('user'): h720@30 — a talking head doesn't need more.
 * - Table cam ('environment'): h1080@30 — cards on the table must survive the
 *   broadcaster's crop/zoom and still be readable in the viewer's stacked tile.
 */
function captureOptionsFor(facingMode: 'user' | 'environment'): VideoCaptureOptions {
    return {
        facingMode,
        resolution:
            facingMode === 'environment'
                ? VideoPresets.h1080.resolution
                : VideoPresets.h720.resolution,
    };
}

/**
 * Face-cam mic processing: the seller talks over an open room — echo/noise
 * cleanup matters, music fidelity does not. (These match the library defaults;
 * explicit so a livekit-client upgrade can't silently change them.)
 */
const AUDIO_CAPTURE: AudioCaptureOptions = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
};

/**
 * Publish options per track. The TOP simulcast layer is the captured track
 * itself (bounded by videoEncoding); videoSimulcastLayers adds the lower
 * rungs, giving 1080p/720p/360p on a 1080p table cam and 720p/360p/180p on the
 * face cam. Bitrate ceilings are ~2x the library presets (1.7M @720p / 3M
 * @1080p) because card fronts are high-frequency detail the encoder smears at
 * the defaults. The ladder derives from the ACTUAL captured size, not the
 * requested one, so a 1080p ask that fell back to 720p doesn't publish a
 * duplicate top layer.
 */
function publishOptionsFor(track: LocalTrack, isTableCam: boolean): TrackPublishOptions {
    if (track.kind !== Track.Kind.Video) {
        // dtx (silence suppression) + red (redundant audio packets) are cheap
        // robustness on mobile networks; explicit for the same reason as
        // AUDIO_CAPTURE.
        return { dtx: true, red: true };
    }
    const settings = track.mediaStreamTrack.getSettings();
    // Portrait phones report swapped width/height — judge by the short side.
    const is1080 = Math.min(settings.width ?? 0, settings.height ?? 0) >= 1080;
    if (isTableCam) {
        // Card readability beats motion smoothness: contentHint 'detail' makes
        // the encoder favor spatial quality over framerate.
        track.mediaStreamTrack.contentHint = 'detail';
    }
    // One-shot field diagnostic (cam page + console): what ACTUALLY left the
    // device — the capture ask is only `ideal`, so an older phone silently
    // delivers less — and which encode ladder that size selected. Read this in
    // the publisher's devtools when triaging fuzzy-viewer reports to rule the
    // capture/publish hop in or out.
    console.info(
        `[LiveKit] publishing ${isTableCam ? 'table' : 'main'} cam: ` +
            `${settings.width ?? '?'}x${settings.height ?? '?'}@${settings.frameRate ?? '?'}fps, ` +
            `ladder=${is1080 ? 'h1080 top (6Mbps) + h720/h360' : 'native top (3.5Mbps) + h360/h180'}`,
    );
    return {
        simulcast: true,
        videoEncoding: is1080
            ? { maxBitrate: 6_000_000, maxFramerate: 30 }
            : { maxBitrate: 3_500_000, maxFramerate: 30 },
        videoSimulcastLayers: is1080
            ? [VideoPresets.h720, VideoPresets.h360]
            : [VideoPresets.h360, VideoPresets.h180],
        // Under congestion the table cam must drop framerate, never resolution
        // — a choppy-but-sharp card beats a smooth blur. The face cam keeps
        // the default balanced trade.
        degradationPreference: isTableCam ? 'maintain-resolution' : 'balanced',
    };
}

/**
 * Viewer-side subscription policy. 'auto' (default) lets adaptiveStream size
 * each subscription to its attached element; 'high' pins the TOP simulcast
 * layer for every remote video track — the desktop viewer uses it, where the
 * feeds fill most of the screen and adaptive element measurement was serving
 * the middle layer (the fuzzy-viewer field report).
 */
export type SubscriptionQuality = 'auto' | 'high';

export interface RemoteFeeds {
    video: Partial<Record<CameraSlot, RemoteTrack>>;
    audio: RemoteTrack[];
}

function slotOfParticipant(p: Participant): CameraSlot | null {
    try {
        const meta = p.metadata ? JSON.parse(p.metadata) : null;
        if (meta?.cameraSlot === 'main' || meta?.cameraSlot === 'table') return meta.cameraSlot;
    } catch {
        // Fall through to the identity suffix.
    }
    if (p.identity.endsWith(':main')) return 'main';
    if (p.identity.endsWith(':table')) return 'table';
    return null;
}

export function useLiveKitRoom() {
    const roomRef = useRef<Room | null>(null);
    const [connectionState, setConnectionState] = useState<ConnectionState>(
        ConnectionState.Disconnected,
    );
    const [remoteFeeds, setRemoteFeeds] = useState<RemoteFeeds>({ video: {}, audio: [] });
    const [participantCount, setParticipantCount] = useState(0);
    // Raw remote identities (':main'/':table' suffixed for publishers) so the
    // console can detect a competing main-camera device before displacing it.
    const [remoteIdentities, setRemoteIdentities] = useState<string[]>([]);
    const [localVideo, setLocalVideo] = useState<LocalVideoTrack | null>(null);

    // Pre-join camera preview: tracks opened BEFORE any room exists so the
    // broadcaster sees themselves (and clears the permission prompt) ahead of
    // go-live. publishCamera() adopts these instead of re-opening the device.
    const previewTracksRef = useRef<LocalTrack[]>([]);
    const previewFacingRef = useRef<'user' | 'environment' | null>(null);
    const previewInFlightRef = useRef(false);
    const disposedRef = useRef(false);
    // Subscription policy (see SubscriptionQuality). A ref, not state — it
    // must be readable inside connect() at Room construction time.
    const qualityRef = useRef<SubscriptionQuality>('auto');

    // Recomputed wholesale on every track/participant event rather than
    // incrementally patched — the event stream has re-orderings (metadata can
    // arrive after the track) and a full scan of a <10-participant room is
    // cheap and cannot drift.
    const syncFromRoom = useCallback(() => {
        const room = roomRef.current;
        if (!room) {
            setRemoteFeeds({ video: {}, audio: [] });
            setParticipantCount(0);
            setRemoteIdentities([]);
            return;
        }
        const video: RemoteFeeds['video'] = {};
        const audio: RemoteTrack[] = [];
        const identities: string[] = [];
        room.remoteParticipants.forEach((p) => {
            identities.push(p.identity);
            const slot = slotOfParticipant(p);
            p.trackPublications.forEach((pub) => {
                // Re-assert the HIGH pin on every track/participant event —
                // a re-subscribe builds a fresh publication whose requested
                // quality resets to the default. setVideoQuality no-ops when
                // the quality is already requested, so this is idempotent.
                if (qualityRef.current === 'high' && pub.kind === Track.Kind.Video) {
                    pub.setVideoQuality(VideoQuality.HIGH);
                }
                const track = pub.track as RemoteTrack | undefined;
                if (!track) return;
                if (track.kind === Track.Kind.Video && slot) video[slot] = track;
                if (track.kind === Track.Kind.Audio) audio.push(track);
            });
        });
        setRemoteFeeds({ video, audio });
        setParticipantCount(room.remoteParticipants.size + 1);
        setRemoteIdentities(identities);
    }, []);

    /**
     * Set the subscription policy. Call BEFORE connect() — the Room's
     * adaptiveStream option is fixed at construction — though an already-open
     * room still gets the HIGH pin applied to its current tracks. Re-asserted
     * automatically as tracks (re)subscribe via syncFromRoom.
     */
    const setSubscriptionQuality = useCallback(
        (mode: SubscriptionQuality) => {
            qualityRef.current = mode;
            if (mode === 'high') syncFromRoom();
        },
        [syncFromRoom],
    );

    const disconnect = useCallback(async () => {
        const room = roomRef.current;
        roomRef.current = null;
        setLocalVideo(null);
        setRemoteFeeds({ video: {}, audio: [] });
        setParticipantCount(0);
        setRemoteIdentities([]);
        setConnectionState(ConnectionState.Disconnected);
        if (room) {
            try {
                await room.disconnect();
            } catch {
                // Already closed — nothing to clean.
            }
        }
    }, []);

    const connect = useCallback(
        async (url: string, token: string) => {
            if (roomRef.current) return roomRef.current;
            const room = new Room({
                // 'auto': adaptiveStream sizes each subscription to the
                // element the track is attached to. The default pixelDensity
                // (1) measures in CSS pixels — a stacked feed tile on a 3x
                // phone display asked for a third of its physical size, so
                // LiveKit served the LOW simulcast layer to every viewer.
                // 'screen' multiplies by devicePixelRatio, and adaptiveStream
                // re-measures on element resize (the console's split-ratio
                // drags).
                //
                // 'high': adaptiveStream must be fully OFF, not merely
                // overridden — when it's on, the element-measured dimensions
                // win the merge against a manual setVideoQuality whenever
                // they're SMALLER than the pinned layer (the library sends the
                // smaller request), which is exactly the desktop-viewer case
                // the pin exists to fix.
                adaptiveStream:
                    qualityRef.current === 'high' ? false : { pixelDensity: 'screen' },
                // dynacast pauses simulcast layers no viewer subscribes to, so
                // the raised capture/bitrate ceiling only costs upload when
                // someone actually receives the top layer.
                dynacast: true,
            });
            roomRef.current = room;

            room
                .on(RoomEvent.ConnectionStateChanged, (state) => {
                    setConnectionState(state);
                    syncFromRoom();
                })
                .on(RoomEvent.TrackSubscribed, syncFromRoom)
                .on(RoomEvent.TrackUnsubscribed, syncFromRoom)
                .on(RoomEvent.ParticipantConnected, syncFromRoom)
                .on(RoomEvent.ParticipantDisconnected, syncFromRoom)
                .on(RoomEvent.ParticipantMetadataChanged, syncFromRoom)
                .on(RoomEvent.Disconnected, () => {
                    // A dead Room must not linger in roomRef — connect()
                    // early-returns while the ref is set, which would strand
                    // the consumer on "Waiting for video" forever after one
                    // network blip. Drop the listeners and the ref so the next
                    // connect() builds a fresh Room; consumers reconnect off
                    // `connected` flipping false.
                    room.removeAllListeners();
                    if (roomRef.current === room) roomRef.current = null;
                    setLocalVideo(null);
                    setConnectionState(ConnectionState.Disconnected);
                    setRemoteFeeds({ video: {}, audio: [] });
                    setParticipantCount(0);
                    setRemoteIdentities([]);
                });

            try {
                await room.connect(url, token);
            } catch (err) {
                roomRef.current = null;
                throw err;
            }
            syncFromRoom();
            return room;
        },
        [syncFromRoom],
    );

    /**
     * Open the camera + mic WITHOUT joining any room, for the pre-go-live
     * preview. Throws the raw getUserMedia error (NotAllowedError /
     * NotFoundError / ...) so the caller can show a specific message.
     * Idempotent: no-ops when a preview is already up or a room owns the
     * camera.
     */
    const startPreview = useCallback(
        async (opts: { facingMode: 'user' | 'environment'; audio: boolean }) => {
            if (previewInFlightRef.current) return;
            if (previewTracksRef.current.length > 0 || roomRef.current) return;
            previewInFlightRef.current = true;
            try {
                const tracks = await createLocalTracks({
                    audio: opts.audio ? AUDIO_CAPTURE : false,
                    // Preview at publish resolution: publishCamera() adopts
                    // these tracks as-is, so the quality ask must happen here.
                    video: captureOptionsFor(opts.facingMode),
                });
                // The page unmounted (or a room appeared) while getUserMedia
                // was pending — don't leave an orphaned camera lock.
                if (disposedRef.current || roomRef.current) {
                    for (const track of tracks) track.stop();
                    return;
                }
                previewTracksRef.current = tracks;
                previewFacingRef.current = opts.facingMode;
                const video =
                    (tracks.find((t) => t.kind === Track.Kind.Video) as
                        | LocalVideoTrack
                        | undefined) ?? null;
                setLocalVideo(video);
            } finally {
                previewInFlightRef.current = false;
            }
        },
        [],
    );

    const stopPreview = useCallback(() => {
        for (const track of previewTracksRef.current) {
            try {
                track.stop();
            } catch {
                // Already stopped.
            }
        }
        previewTracksRef.current = [];
        previewFacingRef.current = null;
        // Only clear the on-screen video when it was the preview's — a
        // published camera keeps rendering through room teardown paths.
        if (!roomRef.current) setLocalVideo(null);
    }, []);

    /**
     * Publish this device's camera (and optionally mic) into the room. The
     * publisher token already fixes which slot this device fills — the hook
     * only chooses which physical camera to open (front for the face cam,
     * rear for the table cam). A running preview's tracks are ADOPTED when
     * they match the requested camera, so go-live doesn't re-prompt or
     * re-open the device; otherwise the preview is stopped first.
     */
    const publishCamera = useCallback(
        async (opts: { facingMode: 'user' | 'environment'; audio: boolean }) => {
            const room = roomRef.current;
            if (!room) throw new Error('Room is not connected');
            let tracks: LocalTrack[];
            if (
                previewTracksRef.current.length > 0 &&
                previewFacingRef.current === opts.facingMode
            ) {
                tracks = previewTracksRef.current;
                previewTracksRef.current = [];
                previewFacingRef.current = null;
                if (!opts.audio) {
                    tracks = tracks.filter((t) => {
                        if (t.kind === Track.Kind.Audio) {
                            try {
                                t.stop();
                            } catch {
                                // Already stopped.
                            }
                            return false;
                        }
                        return true;
                    });
                }
            } else {
                stopPreview();
                tracks = await createLocalTracks({
                    audio: opts.audio ? AUDIO_CAPTURE : false,
                    video: captureOptionsFor(opts.facingMode),
                });
            }
            // The rear camera is the table cam by construction (see the hook
            // doc above) — it carries the per-slot sharpness settings.
            const isTableCam = opts.facingMode === 'environment';
            try {
                for (const track of tracks) {
                    await room.localParticipant.publishTrack(
                        track,
                        publishOptionsFor(track, isTableCam),
                    );
                }
            } catch (err) {
                // A failed publish must not leave orphaned tracks holding the
                // camera lock — a retry needs to re-open the device cleanly.
                for (const track of tracks) {
                    try {
                        track.stop();
                    } catch {
                        // Already stopped.
                    }
                }
                throw err;
            }
            const video =
                (tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined) ??
                null;
            // Verify degradationPreference actually reached the RTCRtpSender —
            // livekit-client applies the publish option via setParameters, but a
            // browser can silently ignore it. Re-assert once if it didn't stick,
            // and log the outcome (one line per publish) for field triage.
            if (isTableCam && video) {
                try {
                    const sender = video.sender;
                    const params = sender?.getParameters();
                    if (sender && params && params.degradationPreference !== 'maintain-resolution') {
                        params.degradationPreference = 'maintain-resolution';
                        await sender.setParameters(params);
                    }
                    console.info(
                        `[LiveKit] table cam sender degradationPreference: ${
                            sender?.getParameters().degradationPreference ?? 'unavailable'
                        }`,
                    );
                } catch {
                    // Diagnostic only — must never fail the publish.
                }
            }
            setLocalVideo(video);
            return video;
        },
        [stopPreview],
    );

    // Neither the room nor a preview may outlive the page — a background
    // WebRTC session (or an unpublished preview track) keeps camera/mic
    // locked and burns mobile battery.
    useEffect(() => {
        disposedRef.current = false;
        return () => {
            disposedRef.current = true;
            for (const track of previewTracksRef.current) {
                try {
                    track.stop();
                } catch {
                    // Already stopped.
                }
            }
            previewTracksRef.current = [];
            void disconnect();
        };
    }, [disconnect]);

    return {
        connect,
        disconnect,
        publishCamera,
        startPreview,
        stopPreview,
        setSubscriptionQuality,
        connectionState,
        connected: connectionState === ConnectionState.Connected,
        remoteFeeds,
        participantCount,
        remoteIdentities,
        localVideo,
    };
}
