/**
 * POST /api/webhooks/livekit — LiveKit callbacks: egress (VOD) + participant
 * joins (viewer_peak).
 *
 * Recording is started at go-live (startRoomRecording) and the egress id is
 * stamped on the stream, but the finished FILE only exists once the egress
 * completes — asynchronously, minutes after the show ends. This endpoint is
 * how that URL gets back to us; without it a recording is written to storage
 * and then forgotten, which is precisely the state the platform was in
 * (every stream so far: egress configured = no, vod_url = null).
 *
 * Configure the URL in the LiveKit dashboard (Settings -> Webhooks) as
 * https://cardstreet.app/api/webhooks/livekit. Authenticity is verified with
 * WebhookReceiver, which checks the Authorization JWT against the project's
 * API key/secret — the same pair the server SDK already uses — so an
 * unsigned POST cannot write a vod_url.
 *
 * Idempotent: matching is by egress id and the write is a plain column
 * update, so LiveKit's at-least-once retries converge on the same row.
 */

import { NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordViewerPeak } from '@/lib/liveBreaks';
import { awardEvent, awardFirst } from '@/lib/rewards';
import { EARN } from '@/lib/rewardTiers';

export const runtime = 'nodejs';

/** Matches the 30-day retention the schema documents (streams.vod_expires_at). */
const VOD_RETENTION_DAYS = 30;

/** Award once a user's summed closed sessions in a stream pass 10 minutes. */
const WATCH_AWARD_SECONDS = 600;
/** A single session's credit is clamped (reconnect-churn / clock-skew guard). */
const SESSION_MAX_SECONDS = 6 * 60 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Viewer identities are `${userId}#${uuid}` (lib/livekit.ts). Publishers
 * (`...:main/:table/:monitor`) and guests (`guest#...`) never earn watch time.
 */
function viewerUserId(identity: string | null | undefined): string | null {
    if (!identity) return null;
    if (/:(main|table|monitor)$/.test(identity)) return null;
    const hash = identity.indexOf('#');
    if (hash <= 0) return null;
    const prefix = identity.slice(0, hash);
    return UUID_RE.test(prefix) ? prefix : null;
}

/** Stamp left_at/seconds on one session row. Returns its user + stream. */
async function closeViewSession(
    admin: SupabaseClient,
    identity: string,
): Promise<{ streamId: string; userId: string } | null> {
    const { data: row } = await admin
        .from('stream_view_sessions')
        .select('identity, stream_id, user_id, joined_at, left_at')
        .eq('identity', identity)
        .maybeSingle();
    if (!row || row.left_at) return null;
    const seconds = Math.min(
        SESSION_MAX_SECONDS,
        Math.max(0, Math.round((Date.now() - Date.parse(row.joined_at)) / 1000)),
    );
    const { error } = await admin
        .from('stream_view_sessions')
        .update({ left_at: new Date().toISOString(), seconds })
        .eq('identity', identity)
        .is('left_at', null);
    if (error) return null;
    return { streamId: row.stream_id, userId: row.user_id };
}

/**
 * XP award once a user's CLOSED sessions in a stream total 10+ minutes.
 * Sessions can overlap under reconnect churn (device eviction), so the sum is
 * an upper bound — accepted because this is XP-only (never coins), once per
 * stream (ledger ref = stream id), capped 2 streams/day.
 */
async function maybeAwardWatchTime(admin: SupabaseClient, streamId: string, userId: string): Promise<void> {
    try {
        const { data: sessions } = await admin
            .from('stream_view_sessions')
            .select('seconds')
            .eq('stream_id', streamId)
            .eq('user_id', userId)
            .not('left_at', 'is', null)
            .limit(100);
        const total = ((sessions ?? []) as { seconds: number }[])
            .reduce((sum, s) => sum + Math.max(0, s.seconds || 0), 0);
        if (total < WATCH_AWARD_SECONDS) return;
        await awardEvent(admin, {
            userId,
            rule: EARN.WATCH_10M.rule,
            ref: streamId,
            xp: EARN.WATCH_10M.xp,
            coins: 0,
            dailyCap: EARN.WATCH_10M.dailyCap,
        });
        await awardFirst(admin, userId, 'first_watch');
    } catch { /* XP-only signal — never worth an error */ }
}

export async function POST(req: Request) {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
        console.error('[LiveKit/Webhook] LiveKit keys not configured');
        return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    }

    let event;
    try {
        // The receiver needs the RAW body — parsing it first breaks the
        // signature check.
        const body = await req.text();
        const auth = req.headers.get('authorization') ?? '';
        event = await new WebhookReceiver(apiKey, apiSecret).receive(body, auth);
    } catch (err) {
        console.error('[LiveKit/Webhook] signature verification failed:', err);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    try {
        // Joins update viewer_peak — the accurate path once this webhook is
        // configured (the token route's mint-time bump works without it, but
        // only sees viewers at mint time, not the room's true occupancy).
        // Signed-in viewer joins ALSO open a durable watch-time session —
        // the Collector Pass watch signal is built from these join/leave
        // diffs, never from anything the client claims.
        if (event.event === 'participant_joined') {
            const roomName = event.room?.name;
            if (roomName?.startsWith('stream_')) {
                const streamId = roomName.slice('stream_'.length);
                await recordViewerPeak(streamId, roomName);
                const userId = viewerUserId(event.participant?.identity);
                if (userId) {
                    const admin = createAdminClient();
                    const { error } = await admin.from('stream_view_sessions').upsert(
                        {
                            identity: event.participant!.identity,
                            stream_id: streamId,
                            user_id: userId,
                            joined_at: new Date().toISOString(),
                        },
                        { onConflict: 'identity', ignoreDuplicates: true },
                    );
                    // PGRST205/42P01 = 20260830 migration pending; quiet no-op.
                    if (error && error.code !== 'PGRST205' && error.code !== '42P01') {
                        console.warn('[LiveKit/Webhook] view session open failed:', error.message);
                    }
                }
            }
            return NextResponse.json({ ok: true });
        }

        // Leaves close the session and check the 10-minute award.
        if (event.event === 'participant_left') {
            const roomName = event.room?.name;
            const identity = event.participant?.identity;
            if (roomName?.startsWith('stream_') && identity && viewerUserId(identity)) {
                try {
                    const admin = createAdminClient();
                    const closed = await closeViewSession(admin, identity);
                    if (closed) await maybeAwardWatchTime(admin, closed.streamId, closed.userId);
                } catch { /* fail-soft */ }
            }
            return NextResponse.json({ ok: true });
        }

        // Room teardown closes every session LiveKit never sent a leave for.
        if (event.event === 'room_finished') {
            const roomName = event.room?.name;
            if (roomName?.startsWith('stream_')) {
                try {
                    const admin = createAdminClient();
                    const streamId = roomName.slice('stream_'.length);
                    const { data: open } = await admin
                        .from('stream_view_sessions')
                        .select('identity, user_id')
                        .eq('stream_id', streamId)
                        .is('left_at', null)
                        .limit(500);
                    const users = new Set<string>();
                    for (const s of (open ?? []) as { identity: string; user_id: string }[]) {
                        const closed = await closeViewSession(admin, s.identity);
                        if (closed) users.add(closed.userId);
                    }
                    for (const userId of users) {
                        await maybeAwardWatchTime(admin, streamId, userId);
                    }
                } catch { /* fail-soft */ }
            }
            return NextResponse.json({ ok: true });
        }

        // Only the terminal egress event carries a finished file.
        if (event.event !== 'egress_ended' || !event.egressInfo) {
            return NextResponse.json({ ok: true, ignored: event.event });
        }

        const info = event.egressInfo;
        const egressId = info.egressId;
        if (!egressId) return NextResponse.json({ ok: true, ignored: 'no egress id' });

        // Room-composite egress reports its output under fileResults:
        // `location` is the URL it uploaded THROUGH, `filename` the object key.
        const file = info.fileResults?.[0];
        const location = file?.location || null;
        const filename = file?.filename || null;
        if (!location && !filename) {
            console.warn(`[LiveKit/Webhook] egress ${egressId} ended with no file`);
            return NextResponse.json({ ok: true, ignored: 'no file' });
        }

        // On R2 (and most S3-compatible stores) `location` points at the
        // PRIVATE api endpoint — credentials required, useless as a <video>
        // src. Public reads come from a different host entirely: R2's
        // pub-*.r2.dev domain or a custom domain bound to the bucket. When
        // that base is configured we address the object there instead, which
        // is what makes a VOD actually playable.
        const publicBase = (process.env.LIVEKIT_EGRESS_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
        const vodUrl =
            publicBase && filename
                ? `${publicBase}/${filename.replace(/^\/+/, '')}`
                : location;
        if (!vodUrl) {
            console.warn(`[LiveKit/Webhook] egress ${egressId}: no usable URL`);
            return NextResponse.json({ ok: true, ignored: 'no url' });
        }

        const admin = createAdminClient();
        const { data, error } = await admin
            .from('streams')
            .update({
                vod_url: vodUrl,
                vod_expires_at: new Date(
                    Date.now() + VOD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
                ).toISOString(),
            })
            .eq('livekit_egress_id', egressId)
            .select('id')
            .maybeSingle<{ id: string }>();

        if (error) {
            console.error('[LiveKit/Webhook] vod_url update failed:', error.message);
            // 200 anyway: retrying can't fix a DB error, and a webhook backlog
            // helps nobody. The recording still exists in storage.
            return NextResponse.json({ ok: false });
        }
        if (!data) {
            console.warn(`[LiveKit/Webhook] no stream matches egress ${egressId}`);
            return NextResponse.json({ ok: true, ignored: 'unmatched egress' });
        }

        // Clips marked DURING the show were saved with a null vod_url —
        // the recording did not exist yet. This is the moment it does, so
        // point them at it and they become watchable. Best-effort: a
        // failure here must not cost the stream its vod_url, and the clip
        // page falls back to reading streams.vod_url anyway.
        const { error: clipErr, count } = await admin
            .from('stream_clips')
            .update({ vod_url: vodUrl }, { count: 'exact' })
            .eq('stream_id', data.id)
            .is('vod_url', null);
        if (clipErr) {
            // Absent before 20260820_stream_clips.sql — nothing to backfill.
            if (clipErr.code !== 'PGRST205' && clipErr.code !== '42P01') {
                console.warn('[LiveKit/Webhook] clip backfill failed:', clipErr.message);
            }
        } else if (count) {
            console.log(`[LiveKit/Webhook] ${count} clip(s) linked to the VOD for ${data.id}`);
        }

        console.log(`[LiveKit/Webhook] VOD saved for stream ${data.id}`);
        return NextResponse.json({ ok: true, streamId: data.id });
    } catch (err) {
        console.error('[LiveKit/Webhook] handler error:', err);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
