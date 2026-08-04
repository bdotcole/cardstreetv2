/**
 * GET /api/live/streams/[id] — stream detail + lots + spots.
 *
 * Beta viewers and the stream's own seller (who may hold only the
 * 'live_broadcast' grant) both pass. Unlisted streams resolve here — that IS
 * the link-only distribution model; only the public feed excludes them.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireViewerOrSeller } from '@/lib/liveBreaks';

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireViewerOrSeller(id);
        if (ctx instanceof NextResponse) return ctx;

        const admin = createAdminClient();

        const { data: stream, error: streamErr } = await admin
            .from('streams')
            .select('*, seller:profiles!streams_seller_id_fkey(display_name, avatar_url)')
            .eq('id', id)
            .single();

        if (streamErr || !stream) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const [{ data: items }, { data: spots }] = await Promise.all([
            admin
                .from('stream_items')
                .select('*')
                .eq('stream_id', id)
                .order('position', { ascending: true })
                .order('created_at', { ascending: true }),
            admin
                .from('break_spots')
                .select(
                    'id, stream_item_id, spot_number, price, status, held_by, ' +
                    'hold_expires_at, buyer_id, order_id, sold_at, assigned_packs',
                )
                .eq('stream_id', id)
                .order('spot_number', { ascending: true }),
        ]);

        return NextResponse.json({
            stream,
            items: items ?? [],
            spots: spots ?? [],
        });
    } catch (err: any) {
        console.error('[Live/Stream] GET error:', err);
        return NextResponse.json({ error: err.message || 'Failed to load stream' }, { status: 500 });
    }
}
