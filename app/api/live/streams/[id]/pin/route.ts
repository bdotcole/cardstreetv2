/**
 * POST /api/live/streams/[id]/pin — set (or replace) the stream's pinned
 * message; body {message}. DELETE — clear it. Broadcaster-only.
 *
 * The pin rides streams.pinned_message, so delivery to viewers is the
 * postgres_changes subscription they already hold — this route only writes.
 */

import { NextResponse } from 'next/server';
import { requireBroadcaster } from '@/lib/liveBreaks';
import { createAdminClient } from '@/lib/supabase/admin';

const PIN_MAX_CHARS = 200;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;

        const body = await req.json().catch(() => ({}));
        const message = typeof body?.message === 'string' ? body.message.trim() : '';
        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        const admin = createAdminClient();
        const { error } = await admin
            .from('streams')
            .update({
                pinned_message: message.slice(0, PIN_MAX_CHARS),
                pinned_at: new Date().toISOString(),
            })
            .eq('id', ctx.stream.id);

        if (error) {
            // 42703 = column absent until 20260822_stream_pinned_message runs.
            if (error.code === '42703') {
                return NextResponse.json(
                    { error: 'Pinned messages are not enabled yet', code: 'SCHEMA_MISSING' },
                    { status: 503 },
                );
            }
            console.error('[Live/Pin] update failed:', error.message);
            return NextResponse.json({ error: 'Could not pin the message' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[Live/Pin] error:', err);
        return NextResponse.json({ error: 'Could not pin the message' }, { status: 500 });
    }
}

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;

        const admin = createAdminClient();
        const { error } = await admin
            .from('streams')
            .update({ pinned_message: null, pinned_at: null })
            .eq('id', ctx.stream.id);

        if (error && error.code !== '42703') {
            console.error('[Live/Pin] clear failed:', error.message);
            return NextResponse.json({ error: 'Could not unpin' }, { status: 500 });
        }
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error('[Live/Pin] error:', err);
        return NextResponse.json({ error: 'Could not unpin' }, { status: 500 });
    }
}
