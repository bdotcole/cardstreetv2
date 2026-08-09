/**
 * PATCH /api/live/streams/[id]/layout — the broadcaster's per-feed viewer
 * framing: { main?, table? } each { zoom 1..3, x 0..1, y 0..1 }, plus an
 * optional `ratio` (0.2..0.8 — the face cam's share of the stacked dual-feed
 * height), written to streams.layout. The existing streams Realtime
 * subscription delivers the row update to viewers, which re-crop/re-split
 * live. Stored rows without `ratio` render at the default split.
 *
 * streams.layout is additive (20260807_stream_layout.sql, run manually in the
 * SQL Editor): until the column exists, writes are ACCEPTED but not persisted
 * (console.warn + stored:false) so the console's debounced autosave never
 * surfaces errors mid-show.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';
import { clampCrop, clampRatio, type StreamLayout } from '@/components/live/shared';

const SLOTS = ['main', 'table'] as const;

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return NextResponse.json({ error: 'Invalid layout payload' }, { status: 400 });
        }

        const layout: StreamLayout = {};
        for (const slot of SLOTS) {
            const raw = (body as Record<string, unknown>)[slot];
            if (raw == null) continue;
            const crop = clampCrop(raw);
            if (!crop) {
                return NextResponse.json(
                    { error: `Invalid ${slot} crop — expected { zoom, x, y } numbers` },
                    { status: 400 },
                );
            }
            layout[slot] = crop;
        }

        const rawRatio = (body as Record<string, unknown>).ratio;
        if (rawRatio != null) {
            const ratio = clampRatio(rawRatio);
            if (ratio == null) {
                return NextResponse.json(
                    { error: 'Invalid ratio — expected a number' },
                    { status: 400 },
                );
            }
            layout.ratio = ratio;
        }

        const admin = createAdminClient();
        const { error } = await admin
            .from('streams')
            .update({ layout })
            .eq('id', ctx.stream.id);

        if (error) {
            // PGRST204 (schema cache) / 42703 (Postgres): the layout column
            // isn't migrated yet — degrade to session-only framing.
            if (error.code === 'PGRST204' || error.code === '42703') {
                console.warn(
                    '[Live/Layout] streams.layout column missing — run 20260807_stream_layout.sql; framing not persisted',
                );
                return NextResponse.json({ success: true, stored: false });
            }
            console.error('[Live/Layout] update failed:', error.message);
            return NextResponse.json({ error: 'Failed to save layout' }, { status: 500 });
        }

        return NextResponse.json({ success: true, stored: true, layout });
    } catch (err: any) {
        console.error('[Live/Layout] error:', err);
        return NextResponse.json({ error: 'Failed to save layout' }, { status: 500 });
    }
}
