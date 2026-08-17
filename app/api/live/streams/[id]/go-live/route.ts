/**
 * POST /api/live/streams/[id]/go-live — flip scheduled -> live (+ start the
 * recording). NO camera slot is required to go live: a solo table cam, a solo
 * face cam or a manage-only console with QR-invited devices are all valid.
 *
 * The status flip is a CAS on 'scheduled' so a double-tap can't double-start
 * the recording. Recording itself is best-effort (see lib/livekit.ts) — a
 * missing egress config never blocks going live.
 *
 * The main-cam token in the response is a backward-compat leftover: the
 * console stages via the token route per its CAMERA MODE (table/main/monitor)
 * before or right after calling this, and ignores the token here — a console
 * in table or manage-only mode must never be handed the ':main' identity.
 */

import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTableError, requireBroadcaster } from '@/lib/liveBreaks';
import { mintPublisherToken, roomNameForStream, startRoomRecording } from '@/lib/livekit';
import { sendShowLiveNotification, sendShowLivePushBlast } from '@/lib/courier';

/**
 * Presale go-live fan-out: notify the distinct buyers of this stream's SOLD
 * spots that the show they reserved a seat in is starting. At flip time sold
 * spots can only be presale purchases, so this is precisely the presale
 * audience. Best-effort end to end — a notify failure must never block (or
 * fail) going live; skips are logged. Returns the notified buyer ids so the
 * app-wide push blast can exclude them (they just got the richer alert).
 */
async function notifyPresaleBuyers(
    admin: ReturnType<typeof createAdminClient>,
    streamId: string,
    sellerId: string,
): Promise<{ buyerIds: string[]; title: string }> {
    let title = 'Live break';
    try {
        const { data: streamRow } = await admin
            .from('streams')
            .select('title')
            .eq('id', streamId)
            .maybeSingle<{ title: string }>();
        title = streamRow?.title || title;

        const { data: soldSpots, error: soldErr } = await admin
            .from('break_spots')
            .select('buyer_id')
            .eq('stream_id', streamId)
            .eq('status', 'sold')
            .not('buyer_id', 'is', null);
        if (soldErr) {
            console.warn('[Live/GoLive] presale notify skipped — spot query failed:', soldErr.message);
            return { buyerIds: [], title };
        }
        const buyerIds = [...new Set((soldSpots ?? []).map(r => r.buyer_id as string))]
            .filter(id => id !== sellerId);
        if (buyerIds.length === 0) return { buyerIds: [], title };

        const results = await Promise.allSettled(
            buyerIds.map(id => sendShowLiveNotification(id, { streamId, title })),
        );
        const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        console.log(`[Live/GoLive] presale notify: ${sent}/${buyerIds.length} dispatched for ${streamId}`);
        return { buyerIds, title };
    } catch (err) {
        console.warn('[Live/GoLive] presale notify skipped:', err);
        return { buyerIds: [], title };
    }
}

/**
 * Reminder fan-out: everyone who tapped "Get notified" on the scheduled
 * landing. They get the full email+push alert (the app-wide blast is
 * push-only, so this is the only path that reaches a web visitor with no
 * install). notified_at is stamped so nobody can be alerted twice for one
 * show. Returns the notified ids for the blast's exclude list.
 */
async function notifyReminderSubscribers(
    admin: ReturnType<typeof createAdminClient>,
    streamId: string,
    sellerId: string,
    title: string,
): Promise<string[]> {
    try {
        const { data: rows, error } = await admin
            .from('stream_reminders')
            .select('id, user_id')
            .eq('stream_id', streamId)
            .is('notified_at', null)
            .returns<{ id: string; user_id: string }[]>();
        if (error) {
            // Absent before 20260820_stream_reminders.sql — nothing to do.
            if (!isMissingTableError(error)) {
                console.warn('[Live/GoLive] reminder notify skipped:', error.message);
            }
            return [];
        }
        const userIds = [...new Set((rows ?? []).map(r => r.user_id))].filter(id => id !== sellerId);
        if (userIds.length === 0) return [];

        // Stamp BEFORE sending: a crash mid-fan-out must not re-alert the
        // whole list on a retry. A missed alert is better than a duplicate.
        await admin
            .from('stream_reminders')
            .update({ notified_at: new Date().toISOString() })
            .in('id', (rows ?? []).map(r => r.id));

        const results = await Promise.allSettled(
            userIds.map(id =>
                sendShowLiveNotification(id, { streamId, title, reason: 'reminder' }),
            ),
        );
        const sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        console.log(`[Live/GoLive] reminder notify: ${sent}/${userIds.length} dispatched for ${streamId}`);
        return userIds;
    } catch (err) {
        console.warn('[Live/GoLive] reminder notify skipped:', err);
        return [];
    }
}

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        const admin = createAdminClient();
        const room = stream.livekit_room || roomNameForStream(stream.id);

        // Reconnect path: the console app crashed or the seller swapped
        // devices mid-show. Re-minting the main-cam token is safe — the same
        // identity resumes the slot — and must not re-flip anything.
        if (stream.status === 'live') {
            const token = await mintPublisherToken(room, user.id, 'main');
            return NextResponse.json({
                success: true,
                alreadyLive: true,
                room,
                token,
                // The wss:// signal URL the client connects to — the client
                // never carries its own LiveKit config.
                url: process.env.LIVEKIT_URL || null,
                cameraSlot: 'main',
                egressId: stream.livekit_egress_id,
            });
        }

        if (stream.status !== 'scheduled') {
            return NextResponse.json(
                { error: `Stream is ${stream.status} and cannot go live` },
                { status: 409 },
            );
        }

        const { data: flipped, error: flipErr } = await admin
            .from('streams')
            .update({
                status: 'live',
                started_at: new Date().toISOString(),
                livekit_room: room,
            })
            .eq('id', stream.id)
            .eq('status', 'scheduled')
            .select('id');

        if (flipErr) {
            console.error('[Live/GoLive] status flip failed:', flipErr.message);
            return NextResponse.json({ error: 'Failed to go live' }, { status: 500 });
        }
        if (!flipped || flipped.length === 0) {
            return NextResponse.json(
                { error: 'Stream state changed — reload and try again' },
                { status: 409 },
            );
        }

        const egressId = await startRoomRecording(room);
        if (egressId) {
            await admin
                .from('streams')
                .update({ livekit_egress_id: egressId })
                .eq('id', stream.id);
        }

        // After the flip only — never on the reconnect path above, so a
        // crashed-console rejoin can't re-notify every presale buyer (or
        // re-blast every app install).
        const { buyerIds, title } = await notifyPresaleBuyers(admin, stream.id, user.id);

        // Reminder subscribers + the app-wide "we're live" PUSH blast (every
        // install with an FCM token, minus the seller, the presale buyers and
        // the reminder subscribers — all already alerted with richer copy).
        // Runs AFTER the response (next/server after()): the breaker's console
        // must go live instantly, not wait on hundreds of Courier sends.
        after(async () => {
            try {
                const reminderIds = await notifyReminderSubscribers(
                    admin,
                    stream.id,
                    user.id,
                    title,
                );
                await sendShowLivePushBlast(
                    { streamId: stream.id, title },
                    [user.id, ...buyerIds, ...reminderIds],
                );
            } catch (err) {
                console.warn('[Live/GoLive] go-live fan-out failed (non-fatal):', err);
            }
        });

        const token = await mintPublisherToken(room, user.id, 'main');

        return NextResponse.json({
            success: true,
            room,
            token,
            url: process.env.LIVEKIT_URL || null,
            cameraSlot: 'main',
            egressId,
        });
    } catch (err: any) {
        console.error('[Live/GoLive] error:', err);
        return NextResponse.json({ error: 'Failed to go live' }, { status: 500 });
    }
}
