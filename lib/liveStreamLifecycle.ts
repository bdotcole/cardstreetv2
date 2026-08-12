/**
 * Ending a live stream — the single implementation (server-only).
 *
 * Two callers: the broadcaster's own POST /api/live/streams/[id]/end, and the
 * abandonment watchdog cron. They must stay identical, because the thing being
 * ended is a billing surface: a room-composite egress charges by the minute for
 * as long as it runs, so an end path that flips the row but leaves the egress
 * alive is worse than not ending at all.
 *
 * NEVER import from a 'use client' module — lib/livekit.ts reads the API secret.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { stopRoomRecording } from '@/lib/livekit';

export const VOD_RETENTION_DAYS = 30;

// A show must be at least this old before the watchdog will judge it abandoned.
// Covers the gap between go-live and the first camera actually publishing —
// staging can legitimately leave a room briefly empty right after the flip.
export const MIN_AGE_BEFORE_JUDGING_MS = 20 * 60 * 1000;

// Absolute ceiling. Applies even with publishers present, because a forgotten
// tab pointed at a dark room publishes happily forever. Longer than any real
// break; the record for this platform is well under an hour.
export const MAX_LIVE_MS = 12 * 60 * 60 * 1000;

export type StreamFate = 'too_young' | 'still_active' | 'abandoned' | 'past_max_age';

/**
 * Should the watchdog end this live stream? Pure, so the policy is testable
 * without a database or a LiveKit account.
 *
 * `activity` is null when LiveKit could not be reached. Unknown must never end
 * a show — a control-plane outage would otherwise mass-end the platform — so
 * only the absolute age cap survives that case.
 *
 * A room that still EXISTS is left alone even at zero publishers: LiveKit only
 * reaps a room after `emptyTimeout`, so "exists but empty" means it emptied
 * moments ago, which is exactly what a reconnecting broadcaster looks like.
 */
export function decideStreamFate(
    ageMs: number,
    activity: { exists: boolean; numPublishers: number } | null,
): StreamFate {
    if (ageMs > MAX_LIVE_MS) return 'past_max_age';
    if (ageMs < MIN_AGE_BEFORE_JUDGING_MS) return 'too_young';
    if (activity === null) return 'still_active';
    return activity.exists ? 'still_active' : 'abandoned';
}

export interface EndStreamResult {
    /** False when the CAS lost — someone else ended it first. */
    ended: boolean;
    /** True when the stop call landed, false when it failed, null when there was no egress. */
    egressStopped: boolean | null;
    vodExpiresAt: string | null;
}

/**
 * Flip a live stream to ended and stop its recording.
 *
 * Order matters: the status CAS runs FIRST so two concurrent callers can't both
 * proceed, and only the CAS winner touches the egress. Stopping first would let
 * the loser of the race stop a recording the winner still believes is running.
 *
 * The egress stop stays best-effort — a stream must be endable even when
 * LiveKit is unreachable — but the outcome is reported rather than swallowed so
 * the watchdog's orphan sweep can retry a failed stop on its next pass.
 */
export async function endLiveStream(
    admin: SupabaseClient,
    stream: { id: string; livekit_egress_id: string | null },
): Promise<EndStreamResult> {
    const now = new Date();
    const vodExpiresAt = new Date(
        now.getTime() + VOD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: flipped, error } = await admin
        .from('streams')
        .update({
            status: 'ended',
            ended_at: now.toISOString(),
            vod_expires_at: vodExpiresAt,
        })
        .eq('id', stream.id)
        .eq('status', 'live')
        .select('id');

    if (error) throw new Error(`status flip failed: ${error.message}`);
    if (!flipped || flipped.length === 0) {
        return { ended: false, egressStopped: null, vodExpiresAt: null };
    }

    let egressStopped: boolean | null = null;
    if (stream.livekit_egress_id) {
        egressStopped = await stopRoomRecording(stream.livekit_egress_id);
    }

    return { ended: true, egressStopped, vodExpiresAt };
}
