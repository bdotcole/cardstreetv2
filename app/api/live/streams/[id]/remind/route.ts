/**
 * POST   /api/live/streams/[id]/remind — "notify me when this show starts".
 * DELETE /api/live/streams/[id]/remind — cancel that.
 *
 * The opt-in the scheduled landing's Get-notified button drives. Delivery
 * happens at the scheduled->live flip (see the go-live route): subscribers
 * get the full email+push alert, not just the app-wide push blast, so a web
 * visitor with no app install is reachable too.
 *
 * Idempotent both ways — the UNIQUE (stream_id, user_id) constraint makes a
 * double-tap a no-op rather than a duplicate alert.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isMissingTableError, requireViewerOrSeller } from '@/lib/liveBreaks';

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireViewerOrSeller(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        // Only a show that hasn't started can be waited on.
        if (stream.status !== 'scheduled') {
            return NextResponse.json(
                { error: 'This show is not upcoming', code: 'NOT_SCHEDULED' },
                { status: 409 },
            );
        }

        const admin = createAdminClient();
        const { error } = await admin
            .from('stream_reminders')
            .upsert(
                { stream_id: stream.id, user_id: user.id },
                { onConflict: 'stream_id,user_id', ignoreDuplicates: true },
            );

        if (error) {
            if (isMissingTableError(error)) {
                console.warn('[Live/Remind] stream_reminders missing (run 20260820_stream_reminders.sql)');
                return NextResponse.json(
                    { error: 'Reminders are not available yet' },
                    { status: 503 },
                );
            }
            console.error('[Live/Remind] upsert failed:', error.message);
            return NextResponse.json({ error: 'Could not set the reminder' }, { status: 500 });
        }

        return NextResponse.json({ success: true, reminderSet: true });
    } catch (err: any) {
        console.error('[Live/Remind] error:', err);
        return NextResponse.json({ error: 'Could not set the reminder' }, { status: 500 });
    }
}

export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireViewerOrSeller(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        const admin = createAdminClient();
        const { error } = await admin
            .from('stream_reminders')
            .delete()
            .eq('stream_id', stream.id)
            .eq('user_id', user.id);

        if (error) {
            if (isMissingTableError(error)) {
                return NextResponse.json({ success: true, reminderSet: false });
            }
            console.error('[Live/Remind] delete failed:', error.message);
            return NextResponse.json({ error: 'Could not cancel the reminder' }, { status: 500 });
        }

        return NextResponse.json({ success: true, reminderSet: false });
    } catch (err: any) {
        console.error('[Live/Remind] error:', err);
        return NextResponse.json({ error: 'Could not cancel the reminder' }, { status: 500 });
    }
}
