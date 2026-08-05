'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ConnectionState,
    LocalVideoTrack,
    Participant,
    RemoteTrack,
    Room,
    RoomEvent,
    Track,
    createLocalTracks,
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
    const [localVideo, setLocalVideo] = useState<LocalVideoTrack | null>(null);

    // Recomputed wholesale on every track/participant event rather than
    // incrementally patched — the event stream has re-orderings (metadata can
    // arrive after the track) and a full scan of a <10-participant room is
    // cheap and cannot drift.
    const syncFromRoom = useCallback(() => {
        const room = roomRef.current;
        if (!room) {
            setRemoteFeeds({ video: {}, audio: [] });
            setParticipantCount(0);
            return;
        }
        const video: RemoteFeeds['video'] = {};
        const audio: RemoteTrack[] = [];
        room.remoteParticipants.forEach((p) => {
            const slot = slotOfParticipant(p);
            p.trackPublications.forEach((pub) => {
                const track = pub.track as RemoteTrack | undefined;
                if (!track) return;
                if (track.kind === Track.Kind.Video && slot) video[slot] = track;
                if (track.kind === Track.Kind.Audio) audio.push(track);
            });
        });
        setRemoteFeeds({ video, audio });
        setParticipantCount(room.remoteParticipants.size + 1);
    }, []);

    const disconnect = useCallback(async () => {
        const room = roomRef.current;
        roomRef.current = null;
        setLocalVideo(null);
        setRemoteFeeds({ video: {}, audio: [] });
        setParticipantCount(0);
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
            const room = new Room({ adaptiveStream: true, dynacast: true });
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
     * Publish this device's camera (and optionally mic) into the room. The
     * publisher token already fixes which slot this device fills — the hook
     * only chooses which physical camera to open (front for the face cam,
     * rear for the table cam).
     */
    const publishCamera = useCallback(
        async (opts: { facingMode: 'user' | 'environment'; audio: boolean }) => {
            const room = roomRef.current;
            if (!room) throw new Error('Room is not connected');
            const tracks = await createLocalTracks({
                audio: opts.audio,
                video: { facingMode: opts.facingMode },
            });
            for (const track of tracks) {
                await room.localParticipant.publishTrack(track);
            }
            const video =
                (tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined) ??
                null;
            setLocalVideo(video);
            return video;
        },
        [],
    );

    // The room must not outlive the page — a background WebRTC session keeps
    // camera/mic locked and burns mobile battery.
    useEffect(() => {
        return () => {
            void disconnect();
        };
    }, [disconnect]);

    return {
        connect,
        disconnect,
        publishCamera,
        connectionState,
        connected: connectionState === ConnectionState.Connected,
        remoteFeeds,
        participantCount,
        localVideo,
    };
}
