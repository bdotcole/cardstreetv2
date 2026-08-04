/**
 * POST /api/live/streams/[id]/moderate — broadcaster moderation:
 * ban / unban a user, soft-delete a message, freeze/unfreeze chat.
 *
 * Only the stream's seller moderates (a stream_moderators role is a
 * fast-follow per the parity spec). Deletes are soft — rows stay as dispute
 * evidence next to the VOD; the SELECT policy already hides them.
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBroadcaster } from '@/lib/liveBreaks';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        const body = await req.json().catch(() => ({}));
        const action = body?.action;
        const admin = createAdminClient();

        switch (action) {
            case 'ban': {
                const targetId = typeof body?.userId === 'string' ? body.userId : null;
                if (!targetId) {
                    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
                }
                if (targetId === stream.seller_id) {
                    return NextResponse.json({ error: 'Cannot ban the broadcaster' }, { status: 400 });
                }
                const reason =
                    typeof body?.reason === 'string' && body.reason.trim().length > 0
                        ? body.reason.trim().slice(0, 300)
                        : null;
                // Re-banning is a no-op, not an error (PK on stream_id+user_id).
                const { error } = await admin
                    .from('stream_chat_bans')
                    .upsert(
                        { stream_id: stream.id, user_id: targetId, banned_by: user.id, reason },
                        { onConflict: 'stream_id,user_id', ignoreDuplicates: true },
                    );
                if (error) {
                    console.error('[Live/Moderate] ban failed:', error.message);
                    return NextResponse.json({ error: 'Failed to ban user' }, { status: 500 });
                }
                return NextResponse.json({ success: true, action, userId: targetId });
            }

            case 'unban': {
                const targetId = typeof body?.userId === 'string' ? body.userId : null;
                if (!targetId) {
                    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
                }
                const { error } = await admin
                    .from('stream_chat_bans')
                    .delete()
                    .eq('stream_id', stream.id)
                    .eq('user_id', targetId);
                if (error) {
                    console.error('[Live/Moderate] unban failed:', error.message);
                    return NextResponse.json({ error: 'Failed to unban user' }, { status: 500 });
                }
                return NextResponse.json({ success: true, action, userId: targetId });
            }

            case 'delete_message': {
                const messageId = typeof body?.messageId === 'string' ? body.messageId : null;
                if (!messageId) {
                    return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
                }
                // Scoped to this stream so a broadcaster can't delete messages
                // in someone else's room by id.
                const { data: deleted, error } = await admin
                    .from('stream_chat_messages')
                    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
                    .eq('id', messageId)
                    .eq('stream_id', stream.id)
                    .is('deleted_at', null)
                    .select('id');
                if (error) {
                    console.error('[Live/Moderate] delete failed:', error.message);
                    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
                }
                if (!deleted || deleted.length === 0) {
                    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
                }
                return NextResponse.json({ success: true, action, messageId });
            }

            case 'chat_toggle': {
                const next = !stream.chat_disabled;
                const { error } = await admin
                    .from('streams')
                    .update({ chat_disabled: next })
                    .eq('id', stream.id);
                if (error) {
                    console.error('[Live/Moderate] chat toggle failed:', error.message);
                    return NextResponse.json({ error: 'Failed to toggle chat' }, { status: 500 });
                }
                return NextResponse.json({ success: true, action, chatDisabled: next });
            }

            default:
                return NextResponse.json(
                    { error: "action must be 'ban', 'unban', 'delete_message' or 'chat_toggle'" },
                    { status: 400 },
                );
        }
    } catch (err: any) {
        console.error('[Live/Moderate] error:', err);
        return NextResponse.json({ error: err.message || 'Moderation failed' }, { status: 500 });
    }
}
