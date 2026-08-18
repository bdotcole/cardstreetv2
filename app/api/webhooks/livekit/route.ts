/**
 * POST /api/webhooks/livekit — LiveKit egress callbacks.
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
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/** Matches the 30-day retention the schema documents (streams.vod_expires_at). */
const VOD_RETENTION_DAYS = 30;

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

        console.log(`[LiveKit/Webhook] VOD saved for stream ${data.id}`);
        return NextResponse.json({ ok: true, streamId: data.id });
    } catch (err) {
        console.error('[LiveKit/Webhook] handler error:', err);
        return NextResponse.json({ ok: false }, { status: 500 });
    }
}
