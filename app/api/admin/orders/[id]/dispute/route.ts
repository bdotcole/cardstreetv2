import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/adminAuth';

/**
 * POST /api/admin/orders/[id]/dispute -- close a buyer's problem report.
 *
 * outcome:
 *   'refunded'  the buyer was made whole (the refund itself is issued in the Stripe
 *               dashboard on the seller's connected account, or paid from CardStreet
 *               funds); the order becomes 'cancelled' and an order_refunds row records it.
 *   'rejected'  the report did not hold; the order returns to the status it had
 *               before the report.
 *   'resolved'  settled another way (partial refund, replacement); the order also
 *               returns to its prior status.
 *
 * The linked ticket is marked Resolved and the note becomes the admin reply so the
 * buyer sees the decision in their support thread.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdmin();
    if (gate) return gate;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const outcome = ['refunded', 'rejected', 'resolved'].includes(body?.outcome) ? body.outcome as string : null;
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 5000) : '';
    if (!outcome) return NextResponse.json({ error: 'outcome must be refunded, rejected, or resolved' }, { status: 400 });

    const cookieSupabase = await createServerClient();
    const { data: { user: adminUser } } = await cookieSupabase.auth.getUser();

    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
        .from('orders')
        .select('id, status, completed_at, delivered_at, status_before_dispute, dispute_ticket_id')
        .eq('id', id)
        .maybeSingle();
    if (orderError && orderError.code !== '42703') {
        return NextResponse.json({ error: orderError.message }, { status: 500 });
    }
    // Pre-migration the dispute columns do not exist; fall back to the plain row.
    const row = order ?? (await admin.from('orders').select('id, status, completed_at, delivered_at').eq('id', id).maybeSingle()).data as any;
    if (!row) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (row.status !== 'disputed') return NextResponse.json({ error: 'Order is not disputed', code: 'NOT_DISPUTED' }, { status: 409 });

    const now = new Date().toISOString();
    const restored = row.status_before_dispute || (row.completed_at ? 'completed' : 'delivered');
    const newStatus = outcome === 'refunded' ? 'cancelled' : restored;

    let upd = await admin.from('orders')
        .update({ status: newStatus, dispute_outcome: outcome, dispute_resolved_at: now, updated_at: now })
        .eq('id', id).eq('status', 'disputed')
        .select('id').maybeSingle();
    if (upd.error && upd.error.code === '42703') {
        upd = await admin.from('orders')
            .update({ status: newStatus, updated_at: now })
            .eq('id', id).eq('status', 'disputed')
            .select('id').maybeSingle();
    }
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    if (!upd.data) return NextResponse.json({ error: 'Order changed underneath you', code: 'STATE_CHANGED' }, { status: 409 });

    if (outcome === 'refunded') {
        const { error: refundError } = await admin.from('order_refunds')
            .insert({ order_id: id, note: note || 'Refunded under the CardStreet Guarantee', refunded_by: adminUser?.id ?? null });
        if (refundError) console.error('[Admin/Dispute] order_refunds insert failed:', refundError);
    }

    if (row.dispute_ticket_id) {
        const reply = note || `Resolved: ${outcome}`;
        await admin.from('support_tickets')
            .update({ status: 'Resolved', admin_reply: reply, replied_by: adminUser?.id ?? null, replied_at: now })
            .eq('id', row.dispute_ticket_id);
        // Thread row fails soft pre-20260724 migration; the legacy columns carry the reply.
        await admin.from('support_ticket_messages')
            .insert({ ticket_id: row.dispute_ticket_id, sender_id: adminUser?.id ?? null, sender_role: 'admin', body: reply });
    }

    return NextResponse.json({ ok: true, status: newStatus, outcome });
}
