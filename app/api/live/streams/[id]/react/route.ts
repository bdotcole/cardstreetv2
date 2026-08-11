/**
 * POST /api/live/streams/[id]/react — send an ephemeral sticker reaction.
 *
 * Nothing persists: the route validates + rate-limits, then relays the
 * sticker to Supabase Realtime's broadcast REST endpoint
 * (POST {SUPABASE_URL}/realtime/v1/api/broadcast, body
 * {messages:[{topic, event, payload, private}]}, apikey = service key,
 * 202 on success — verified against the installed @supabase/realtime-js
 * RealtimeChannel.httpSend, which is exactly that call, so we use it instead
 * of hand-rolling the fetch). Viewers + the console subscribe to the
 * `stream-react:{streamId}` broadcast channel and float incoming stickers.
 *
 * Beta posture: the channel itself is public-broadcast (no rows, no RLS),
 * but sends require the 'live_streams' grant here and carry only a sticker
 * key + the sender's public display name.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { isStickerKey } from '@/components/live/stickers';

const REACT_WINDOW_SECONDS = 10;
const REACT_MAX_PER_WINDOW = 20;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const admin = createAdminClient();
        const { data: stream } = await admin
            .from('streams')
            .select('id, status')
            .eq('id', id)
            .maybeSingle<{ id: string; status: string }>();
        if (!stream) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (stream.status !== 'live') {
            return NextResponse.json(
                { error: 'Stream is not live', code: 'STREAM_NOT_LIVE' },
                { status: 409 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const sticker = body?.sticker;
        if (!isStickerKey(sticker)) {
            return NextResponse.json({ error: 'Invalid sticker' }, { status: 400 });
        }

        // Taps are meant to be rapid-fire; the ceiling only stops scripts.
        const { allowed } = await checkRateLimit(`live-react:${user.id}`, {
            windowSeconds: REACT_WINDOW_SECONDS,
            max: REACT_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json(
                { error: 'Reacting too fast — slow down', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }

        const { data: profile } = await admin
            .from('profiles')
            .select('display_name')
            .eq('id', user.id)
            .maybeSingle<{ display_name: string | null }>();

        try {
            await admin
                .channel(`stream-react:${stream.id}`)
                .httpSend('sticker', { sticker, from: profile?.display_name ?? null });
        } catch (err) {
            console.error('[Live/React] broadcast failed:', err);
            return NextResponse.json({ error: 'Failed to send reaction' }, { status: 502 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[Live/React] error:', err);
        return NextResponse.json({ error: 'Failed to send reaction' }, { status: 500 });
    }
}
