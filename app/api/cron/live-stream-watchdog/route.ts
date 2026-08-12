/**
 * Live-stream abandonment watchdog — hourly.
 *
 * A show only ends when the broadcaster taps "end". A closed browser, a killed
 * app, or a dead phone leaves streams.status='live' forever, and with it a
 * room-composite egress that LiveKit bills BY THE MINUTE and writes to S3
 * without bound. Nothing else reaps it. This cron is that reaper.
 *
 * Two independent sweeps, because they fail in different directions:
 *
 *   1. ABANDONED STREAMS — rows still 'live' whose LiveKit room has no
 *      publishers. Ends them through the shared lifecycle helper, which stops
 *      the egress.
 *
 *   2. ORPHANED EGRESSES — recordings still running for a room whose stream is
 *      no longer live. This is the sweep that actually protects the bill:
 *      stopRoomRecording is best-effort, so a stop that failed at end-time
 *      (LiveKit blip, timeout) leaves an egress running with a correctly-ended
 *      row in front of it, invisible to sweep 1 forever.
 *
 * Emptiness is judged by LiveKit, not by us. LiveKit closes a room once it has
 * been empty for `emptyTimeout`, so a room that no longer exists has been empty
 * for a while — that is the durable signal, and it needs no extra column and no
 * state carried between cron runs. A room that still exists with 0 publishers
 * only just emptied (or is mid-reconnect) and is deliberately left for the next
 * pass; one blip must not kill a live show with buyers in it.
 *
 * Fail-safe throughout: when LiveKit cannot be reached, publisher counts are
 * unknown, and unknown never ends a stream. Only the absolute age cap applies
 * then, so a control-plane outage can't mass-end the platform's shows.
 *
 * Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` (same as the others).
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { decideStreamFate, endLiveStream } from '@/lib/liveStreamLifecycle';
import {
    getRoomActivity,
    listActiveEgresses,
    roomNameForStream,
    stopRoomRecording,
} from '@/lib/livekit';

export const runtime = 'nodejs';
export const maxDuration = 60;
const TIME_BUDGET_MS = 50_000;

// The age thresholds and the end-or-leave policy live in
// lib/liveStreamLifecycle.ts (decideStreamFate) so they can be unit-tested
// without a database or a LiveKit account.

// Rows scanned per run. Far above any plausible concurrent-show count; exists
// so a runaway query can't blow the time budget.
const SCAN_LIMIT = 200;

interface LiveStreamRow {
    id: string;
    seller_id: string;
    started_at: string | null;
    created_at: string;
    livekit_room: string | null;
    livekit_egress_id: string | null;
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const startedAt = Date.now();
    const overBudget = () => Date.now() - startedAt > TIME_BUDGET_MS;

    const summary = {
        scanned: 0,
        endedAbandoned: 0,
        endedMaxAge: 0,
        leftAlone: 0,
        orphanEgressesStopped: 0,
        orphanEgressStopFailures: 0,
        livekitUnavailable: false,
        errors: [] as string[],
    };

    // ─── Sweep 1: streams still 'live' ───
    const { data: liveStreams, error } = await admin
        .from('streams')
        .select('id, seller_id, started_at, created_at, livekit_room, livekit_egress_id')
        .eq('status', 'live')
        .limit(SCAN_LIMIT)
        .returns<LiveStreamRow[]>();

    if (error) {
        Sentry.captureException(new Error(`live-stream-watchdog query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    summary.scanned = liveStreams?.length ?? 0;
    const now = Date.now();
    // Rooms belonging to a still-live stream — sweep 2 must not touch these.
    const liveRooms = new Set<string>();

    for (const stream of liveStreams ?? []) {
        if (overBudget()) break;

        const room = stream.livekit_room || roomNameForStream(stream.id);
        // started_at should always be set on a live row; created_at is the
        // conservative fallback so a NULL can't read as "infinitely old".
        const since = Date.parse(stream.started_at ?? stream.created_at);
        const ageMs = Number.isNaN(since) ? 0 : now - since;

        // Skip the LiveKit round-trip when age alone already decides it.
        const preCheck = decideStreamFate(ageMs, null);
        const activity =
            preCheck === 'past_max_age' || preCheck === 'too_young'
                ? null
                : await getRoomActivity(room);
        if (activity === null && preCheck === 'still_active') summary.livekitUnavailable = true;

        const fate = decideStreamFate(ageMs, activity);
        const pastMaxAge = fate === 'past_max_age';

        if (fate === 'too_young' || fate === 'still_active') {
            liveRooms.add(room);
            summary.leftAlone++;
            continue;
        }

        try {
            const result = await endLiveStream(admin, stream);
            if (!result.ended) {
                // Lost the CAS — the broadcaster ended it mid-sweep. Its room is
                // no longer live, so leave it out of liveRooms and let sweep 2
                // clean up any egress that outlived it.
                summary.leftAlone++;
                continue;
            }
            if (pastMaxAge) summary.endedMaxAge++;
            else summary.endedAbandoned++;

            if (result.egressStopped === false) {
                // Row is ended but the recording is still billing. Sweep 2 picks
                // it up below, in this same run.
                summary.errors.push(`stream ${stream.id}: egress stop failed, left for orphan sweep`);
            }
            console.log(
                `[LiveWatchdog] ended stream ${stream.id} (${pastMaxAge ? 'max age' : 'abandoned'}, ` +
                `age ${Math.round(ageMs / 60000)}m)`,
            );
        } catch (err: any) {
            summary.errors.push(`stream ${stream.id}: ${err?.message ?? err}`);
        }
    }

    // ─── Sweep 2: egresses running for no live stream ───
    // Runs even when sweep 1 found nothing — that is the whole point, since an
    // orphan by definition has no live row pointing at it.
    if (!overBudget()) {
        const active = await listActiveEgresses();
        if (active === null) {
            summary.livekitUnavailable = true;
        } else {
            for (const eg of active) {
                if (overBudget()) break;
                if (liveRooms.has(eg.roomName)) continue;

                const stopped = await stopRoomRecording(eg.egressId);
                if (stopped) {
                    summary.orphanEgressesStopped++;
                    console.log(
                        `[LiveWatchdog] stopped orphaned egress ${eg.egressId} (room ${eg.roomName})`,
                    );
                } else {
                    summary.orphanEgressStopFailures++;
                }
            }
        }
    }

    // An orphan that resists stopping is money leaking with no self-healing
    // path left, so it pages rather than sitting in a log line.
    if (summary.orphanEgressStopFailures > 0) {
        Sentry.captureMessage('Live egress orphan could not be stopped — billing continues', {
            level: 'error',
            tags: { handler: 'live-stream-watchdog' },
            extra: { summary },
        });
    }

    return NextResponse.json({ ok: true, ...summary, elapsedMs: Date.now() - startedAt });
}
