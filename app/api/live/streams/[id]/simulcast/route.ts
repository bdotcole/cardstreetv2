/**
 * GET  /api/live/streams/[id]/simulcast — where this show is being pushed and
 *      how each output is doing (broadcaster only).
 * POST /api/live/streams/[id]/simulcast — { action: 'add' | 'remove',
 *      destinationId, orientation?, overlay? } — start or stop pushing to one
 *      saved destination MID-SHOW.
 *
 * Status truth is LiveKit's: the GET refreshes the per-output results from
 * the egress on every call while the show is live (the console polls it),
 * so a dropped webhook cannot leave the panel stale. 'add' updates the running
 * egress in place; if the egress is gone (never started, or it died) a fresh
 * one is started with this destination — the VOD file output rides along
 * again, so recording resumes too.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { isMissingTableError, requireBroadcaster } from '@/lib/liveBreaks';
import { EgressStatus } from 'livekit-server-sdk';
import {
    getEgressSnapshot,
    roomNameForStream,
    startRoomEgress,
    updateEgressStreamUrls,
} from '@/lib/livekit';
import {
    DESTINATION_COLS,
    listSimulcastTargets,
    markSimulcastTarget,
    overlayTemplateUrl,
    recordSimulcastTargets,
    resolveTarget,
    syncSimulcastTargetsFromEgress,
    type DestinationRow,
    type SimulcastTargetRow,
} from '@/lib/streamDestinations';

const WRITE_WINDOW_SECONDS = 60;
const WRITE_MAX_PER_WINDOW = 20;

function shapeTarget(row: SimulcastTargetRow) {
    return {
        id: row.id,
        destinationId: row.destination_id,
        platform: row.platform,
        label: row.label,
        status: row.status,
        error: row.error,
        startedAt: row.started_at,
        endedAt: row.ended_at,
    };
}

function egressStatusName(status: EgressStatus): string {
    return EgressStatus[status] ?? String(status);
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { stream } = ctx;

        const listed = await listSimulcastTargets(stream.id);
        const { unavailable } = listed;
        let rows = listed.rows;
        let egress: { active: boolean; status: string } | null = null;
        if (stream.status === 'live' && stream.livekit_egress_id) {
            const snapshot = await getEgressSnapshot(stream.livekit_egress_id);
            if (snapshot) {
                egress = { active: snapshot.active, status: egressStatusName(snapshot.status) };
                if (!unavailable) {
                    rows = await syncSimulcastTargetsFromEgress(
                        stream.id,
                        snapshot.streamResults,
                        !snapshot.active,
                    );
                }
            }
        }
        return NextResponse.json({ targets: rows.map(shapeTarget), egress, unavailable });
    } catch (err) {
        console.error('[Live/Simulcast] GET error:', err);
        return NextResponse.json({ error: 'Failed to load multistream status' }, { status: 500 });
    }
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        const { allowed } = await checkRateLimit(`live-simulcast:${user.id}`, {
            windowSeconds: WRITE_WINDOW_SECONDS,
            max: WRITE_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json({ error: 'Slow down a moment', code: 'RATE_LIMITED' }, { status: 429 });
        }

        if (stream.status !== 'live') {
            return NextResponse.json(
                { error: 'Destinations start with the show — go live first', code: 'NOT_LIVE' },
                { status: 409 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const action = body?.action;
        const destinationId = typeof body?.destinationId === 'string' ? body.destinationId : '';
        if ((action !== 'add' && action !== 'remove') || !destinationId) {
            return NextResponse.json({ error: 'action must be add or remove with a destinationId' }, { status: 400 });
        }

        const admin = createAdminClient();
        const { data: destination, error: destErr } = await admin
            .from('stream_destinations')
            .select(DESTINATION_COLS)
            .eq('id', destinationId)
            .eq('seller_id', user.id)
            .maybeSingle<DestinationRow>();
        if (destErr) {
            if (isMissingTableError(destErr)) {
                return NextResponse.json({ error: 'Multistream is not set up yet', code: 'MIGRATION_PENDING' }, { status: 503 });
            }
            console.error('[Live/Simulcast] destination load failed:', destErr.message);
            return NextResponse.json({ error: 'Failed to update multistream' }, { status: 500 });
        }
        if (!destination) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const target = resolveTarget(destination);
        if (!target) {
            return NextResponse.json(
                { error: 'This destination needs its stream key entered again', code: 'KEY_UNREADABLE' },
                { status: 409 },
            );
        }

        const egressId = stream.livekit_egress_id;
        const snapshot = egressId ? await getEgressSnapshot(egressId) : null;
        const egressActive = !!snapshot?.active;

        if (action === 'remove') {
            if (egressId && egressActive) {
                const result = await updateEgressStreamUrls(egressId, [], [target.url]);
                if (!result.ok) {
                    return NextResponse.json({ error: result.error, code: 'LIVEKIT' }, { status: 409 });
                }
            }
            await markSimulcastTarget(stream.id, target.urlHash, 'removed');
            const { rows } = await listSimulcastTargets(stream.id);
            return NextResponse.json({ success: true, targets: rows.map(shapeTarget) });
        }

        // add
        if (egressId && egressActive) {
            // Already pushing there? LiveKit refuses duplicate URLs; say so
            // cleanly instead of surfacing its error.
            const alreadyLive = (snapshot?.streamResults ?? []).some(
                (s) => s.url === target.url && s.status === 0,
            );
            if (!alreadyLive) {
                const result = await updateEgressStreamUrls(egressId, [target.url], []);
                if (!result.ok) {
                    return NextResponse.json({ error: result.error, code: 'LIVEKIT' }, { status: 409 });
                }
            }
            await recordSimulcastTargets(stream.id, [target]);
        } else {
            // No running egress to attach to: start one carrying this
            // destination (and the VOD file output, so recording resumes).
            const orientation: 'portrait' | 'landscape' =
                body?.orientation === 'landscape' ? 'landscape' : 'portrait';
            const overlay = body?.overlay !== false;
            const room = stream.livekit_room || roomNameForStream(stream.id);
            const newEgressId = await startRoomEgress(room, {
                rtmpUrls: [target.url],
                orientation,
                templateBaseUrl: overlay ? overlayTemplateUrl() : null,
            });
            if (!newEgressId) {
                return NextResponse.json(
                    { error: 'LiveKit could not start the stream output', code: 'EGRESS_FAILED' },
                    { status: 502 },
                );
            }
            await admin.from('streams').update({ livekit_egress_id: newEgressId }).eq('id', stream.id);
            await recordSimulcastTargets(stream.id, [target]);
        }

        const { rows } = await listSimulcastTargets(stream.id);
        return NextResponse.json({ success: true, targets: rows.map(shapeTarget) });
    } catch (err) {
        console.error('[Live/Simulcast] POST error:', err);
        return NextResponse.json({ error: 'Failed to update multistream' }, { status: 500 });
    }
}
