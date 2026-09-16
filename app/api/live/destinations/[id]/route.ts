/**
 * PATCH  /api/live/destinations/[id] — { enabled?, label?, rtmpUrl?, streamKey? }
 * DELETE /api/live/destinations/[id]
 *
 * Ownership is the seller_id column; a foreign id gets the same 404 as a
 * nonexistent one. A new streamKey re-encrypts and refreshes the hint — the
 * path for a rotated Facebook key or Instagram's per-broadcast pair.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { isMissingTableError } from '@/lib/liveBreaks';
import { encryptStreamKey, streamKeyHint } from '@/lib/streamKeyCrypto';
import {
    DESTINATION_COLS,
    toPublicDestination,
    type DestinationRow,
} from '@/lib/streamDestinations';
import {
    DESTINATION_LABEL_MAX,
    normalizeRtmpUrl,
    normalizeStreamKey,
} from '@/lib/streamDestinationPresets';

const WRITE_WINDOW_SECONDS = 60;
const WRITE_MAX_PER_WINDOW = 30;

async function loadOwned(id: string, sellerId: string): Promise<DestinationRow | null | 'unavailable'> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('stream_destinations')
        .select(DESTINATION_COLS)
        .eq('id', id)
        .eq('seller_id', sellerId)
        .maybeSingle<DestinationRow>();
    if (error) {
        if (isMissingTableError(error)) return 'unavailable';
        console.error('[Live/Destinations] load failed:', error.message);
        return null;
    }
    return data ?? null;
}

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const gate = await requireBeta('live_broadcast');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;
        const { id } = await params;

        const { allowed } = await checkRateLimit(`live-dest:${user.id}`, {
            windowSeconds: WRITE_WINDOW_SECONDS,
            max: WRITE_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json({ error: 'Slow down a moment', code: 'RATE_LIMITED' }, { status: 429 });
        }

        const existing = await loadOwned(id, user.id);
        if (existing === 'unavailable') {
            return NextResponse.json({ error: 'Multistream is not set up yet', code: 'MIGRATION_PENDING' }, { status: 503 });
        }
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = {};

        if (typeof body?.enabled === 'boolean') patch.enabled = body.enabled;
        if (typeof body?.label === 'string' && body.label.trim()) {
            patch.label = body.label.trim().slice(0, DESTINATION_LABEL_MAX);
        }
        if (typeof body?.rtmpUrl === 'string' && body.rtmpUrl.trim()) {
            const rtmpUrl = normalizeRtmpUrl(body.rtmpUrl);
            if (!rtmpUrl) {
                return NextResponse.json(
                    { error: 'Enter a valid rtmp:// or rtmps:// server URL', code: 'INVALID_URL' },
                    { status: 400 },
                );
            }
            patch.rtmp_url = rtmpUrl;
        }
        if (typeof body?.streamKey === 'string' && body.streamKey.trim()) {
            const streamKey = normalizeStreamKey(body.streamKey);
            if (!streamKey) {
                return NextResponse.json(
                    { error: 'Enter the stream key exactly as the platform shows it', code: 'INVALID_KEY' },
                    { status: 400 },
                );
            }
            const encrypted = encryptStreamKey(streamKey);
            if (!encrypted) {
                return NextResponse.json(
                    { error: 'Stream keys cannot be saved on this server', code: 'NO_SECRET' },
                    { status: 503 },
                );
            }
            patch.stream_key_enc = encrypted;
            patch.key_hint = streamKeyHint(streamKey);
        }
        if (Object.keys(patch).length === 0) {
            return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
        }

        const admin = createAdminClient();
        const { data: row, error } = await admin
            .from('stream_destinations')
            .update(patch)
            .eq('id', id)
            .eq('seller_id', user.id)
            .select(DESTINATION_COLS)
            .single<DestinationRow>();
        if (error || !row) {
            console.error('[Live/Destinations] update failed:', error?.message);
            return NextResponse.json({ error: 'Failed to update destination' }, { status: 500 });
        }
        return NextResponse.json({ success: true, destination: toPublicDestination(row) });
    } catch (err) {
        console.error('[Live/Destinations] PATCH error:', err);
        return NextResponse.json({ error: 'Failed to update destination' }, { status: 500 });
    }
}

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const gate = await requireBeta('live_broadcast');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;
        const { id } = await params;

        const existing = await loadOwned(id, user.id);
        if (existing === 'unavailable') {
            return NextResponse.json({ error: 'Multistream is not set up yet', code: 'MIGRATION_PENDING' }, { status: 503 });
        }
        if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const admin = createAdminClient();
        const { error } = await admin
            .from('stream_destinations')
            .delete()
            .eq('id', id)
            .eq('seller_id', user.id);
        if (error) {
            console.error('[Live/Destinations] delete failed:', error.message);
            return NextResponse.json({ error: 'Failed to delete destination' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[Live/Destinations] DELETE error:', err);
        return NextResponse.json({ error: 'Failed to delete destination' }, { status: 500 });
    }
}
