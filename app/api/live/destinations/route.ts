/**
 * GET  /api/live/destinations — the broadcaster's saved multistream endpoints
 *                               (never the keys: hint only).
 * POST /api/live/destinations — save a new one { platform, label?, rtmpUrl?, streamKey }.
 *
 * Broadcaster-level (live_broadcast grant), not per-stream: a seller's
 * Facebook / YouTube keys are the same every show. Keys are encrypted at rest
 * (lib/streamKeyCrypto.ts) and resolved only at go-live; see
 * lib/streamDestinations.ts for the model.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { isMissingTableError } from '@/lib/liveBreaks';
import { encryptStreamKey, streamKeyHint } from '@/lib/streamKeyCrypto';
import {
    DESTINATION_COLS,
    listDestinations,
    toPublicDestination,
    type DestinationRow,
} from '@/lib/streamDestinations';
import {
    DESTINATION_LABEL_MAX,
    DESTINATIONS_PER_SELLER_MAX,
    isDestinationPlatform,
    normalizeRtmpUrl,
    normalizeStreamKey,
    PLATFORM_PRESETS,
} from '@/lib/streamDestinationPresets';

const WRITE_WINDOW_SECONDS = 60;
const WRITE_MAX_PER_WINDOW = 30;

export async function GET() {
    try {
        const gate = await requireBeta('live_broadcast');
        if (gate instanceof NextResponse) return gate;

        const { rows, unavailable } = await listDestinations(gate.user.id);
        return NextResponse.json({
            destinations: rows.map(toPublicDestination),
            // True before 20260916_stream_destinations.sql is applied — the
            // console says so instead of showing an empty list.
            unavailable,
        });
    } catch (err) {
        console.error('[Live/Destinations] GET error:', err);
        return NextResponse.json({ error: 'Failed to load destinations' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const gate = await requireBeta('live_broadcast');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const { allowed } = await checkRateLimit(`live-dest:${user.id}`, {
            windowSeconds: WRITE_WINDOW_SECONDS,
            max: WRITE_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json(
                { error: 'Slow down a moment', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const platform = body?.platform;
        if (!isDestinationPlatform(platform)) {
            return NextResponse.json({ error: 'Unknown platform', code: 'INVALID_PLATFORM' }, { status: 400 });
        }
        const preset = PLATFORM_PRESETS[platform];

        const rtmpUrl = normalizeRtmpUrl(
            typeof body?.rtmpUrl === 'string' && body.rtmpUrl.trim() ? body.rtmpUrl : preset.serverUrl,
        );
        if (!rtmpUrl) {
            return NextResponse.json(
                { error: 'Enter a valid rtmp:// or rtmps:// server URL', code: 'INVALID_URL' },
                { status: 400 },
            );
        }
        const streamKey = normalizeStreamKey(body?.streamKey);
        if (!streamKey) {
            return NextResponse.json(
                { error: 'Enter the stream key exactly as the platform shows it', code: 'INVALID_KEY' },
                { status: 400 },
            );
        }
        const label = (
            typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : preset.label
        ).slice(0, DESTINATION_LABEL_MAX);

        const encrypted = encryptStreamKey(streamKey);
        if (!encrypted) {
            // No secret to encrypt with — refuse rather than store plaintext.
            return NextResponse.json(
                { error: 'Stream keys cannot be saved on this server', code: 'NO_SECRET' },
                { status: 503 },
            );
        }

        const admin = createAdminClient();
        const { count, error: countErr } = await admin
            .from('stream_destinations')
            .select('id', { count: 'exact', head: true })
            .eq('seller_id', user.id);
        if (countErr) {
            if (isMissingTableError(countErr)) {
                return NextResponse.json(
                    { error: 'Multistream is not set up yet', code: 'MIGRATION_PENDING' },
                    { status: 503 },
                );
            }
            console.error('[Live/Destinations] count failed:', countErr.message);
            return NextResponse.json({ error: 'Failed to save destination' }, { status: 500 });
        }
        if ((count ?? 0) >= DESTINATIONS_PER_SELLER_MAX) {
            return NextResponse.json(
                { error: `Up to ${DESTINATIONS_PER_SELLER_MAX} destinations`, code: 'LIMIT' },
                { status: 409 },
            );
        }

        const { data: row, error: insertErr } = await admin
            .from('stream_destinations')
            .insert({
                seller_id: user.id,
                platform,
                label,
                rtmp_url: rtmpUrl,
                stream_key_enc: encrypted,
                key_hint: streamKeyHint(streamKey),
                enabled: true,
            })
            .select(DESTINATION_COLS)
            .single<DestinationRow>();
        if (insertErr || !row) {
            console.error('[Live/Destinations] insert failed:', insertErr?.message);
            return NextResponse.json({ error: 'Failed to save destination' }, { status: 500 });
        }

        return NextResponse.json({ success: true, destination: toPublicDestination(row) });
    } catch (err) {
        console.error('[Live/Destinations] POST error:', err);
        return NextResponse.json({ error: 'Failed to save destination' }, { status: 500 });
    }
}
