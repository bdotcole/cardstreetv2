import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOrderDisputeAlert } from '@/lib/courier';
import { DISPUTE_REASONS, REPORT_WINDOW_DAYS, canReportOrder, type DisputeReason } from '@/lib/orderDisputes';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * POST /api/orders/[id]/report -- the buyer's "report a problem" path behind the
 * CardStreet Guarantee.
 *
 * What it does, in order:
 *   1. Files a support ticket (category 'Order') so the existing admin console and
 *      reply thread carry the conversation.
 *   2. Moves the order to status 'disputed'. That status alone halts the money
 *      side: release-funds only selects delivered/completed, and
 *      /api/orders/complete only accepts shipped..delivered.
 *   3. Emails the founder. The seller is not messaged automatically: the founder
 *      decides, with the seller's Stripe-verified identity in hand.
 *
 * Reportable: shipped, in_transit, out_for_delivery (not received) at any time;
 * delivered or completed within REPORT_WINDOW_DAYS of delivery. Buyer only.
 *
 * Fails soft before migration 20260907_order_disputes.sql: the order update
 * retries with status only (42703 = undefined column) and the ticket retries
 * under 'General' (23514 = check violation).
 */

type Reason = DisputeReason;
const REASONS = DISPUTE_REASONS;
// English labels for the ticket and the founder alert (internal surfaces).
const REASON_LABEL: Record<Reason, string> = {
    not_received: 'Item not received',
    not_as_described: 'Not as described',
    damaged: 'Arrived damaged',
    other: 'Other problem',
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = await checkRateLimit(`report:${user.id}:1d`, { windowSeconds: 86400, max: 10 });
    if (!rl.allowed) {
        return NextResponse.json({ error: 'Too many reports today', code: 'RATE_LIMITED' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const reason: Reason | null = REASONS.includes(body?.reason) ? body.reason : null;
    const details = typeof body?.details === 'string' ? body.details.trim().slice(0, 2000) : '';
    if (!reason) {
        return NextResponse.json({ error: 'A reason is required', code: 'INVALID_REASON' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: order } = await admin
        .from('orders')
        .select('id, buyer_id, seller_id, status, delivered_at, completed_at, listing_id, total_amount')
        .eq('id', id)
        .maybeSingle();
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.buyer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (order.status === 'disputed') return NextResponse.json({ ok: true, alreadyOpen: true });
    if (!canReportOrder(order)) {
        const closed = order.status === 'delivered' || order.status === 'completed';
        return NextResponse.json(
            closed
                ? { error: `The report window (${REPORT_WINDOW_DAYS} days after delivery) has closed`, code: 'WINDOW_CLOSED' }
                : { error: 'This order cannot be reported yet', code: 'NOT_REPORTABLE' },
            { status: 400 },
        );
    }

    let itemName = '';
    if (order.listing_id) {
        const { data: listing } = await admin.from('listings').select('card_data').eq('id', order.listing_id).maybeSingle();
        itemName = ((listing?.card_data as { name?: string } | null)?.name ?? '').toString();
    }

    const shortId = id.slice(0, 8).toUpperCase();
    const subject = `[Order #${shortId}] ${REASON_LABEL[reason]}`;
    const description = [
        `Order: ${id}`,
        itemName ? `Item: ${itemName}` : null,
        `Amount: ${Number(order.total_amount || 0).toLocaleString()} THB`,
        `Reason: ${REASON_LABEL[reason]}`,
        details ? `Details: ${details}` : null,
    ].filter(Boolean).join('\n');

    let ticketId: string | null = null;
    let ins = await admin.from('support_tickets')
        .insert({ user_id: user.id, subject, description, category: 'Order' })
        .select('id').single();
    if (ins.error && ins.error.code === '23514') {
        ins = await admin.from('support_tickets')
            .insert({ user_id: user.id, subject, description, category: 'General' })
            .select('id').single();
    }
    if (ins.error) console.error('[Orders/Report] ticket insert failed:', ins.error);
    else ticketId = ins.data.id;

    const now = new Date().toISOString();
    let upd = await admin.from('orders')
        .update({
            status: 'disputed',
            dispute_reason: reason,
            dispute_details: details || null,
            dispute_opened_at: now,
            dispute_ticket_id: ticketId,
            status_before_dispute: order.status,
            updated_at: now,
        })
        .eq('id', id).eq('status', order.status)
        .select('id').maybeSingle();
    if (upd.error && upd.error.code === '42703') {
        upd = await admin.from('orders')
            .update({ status: 'disputed', updated_at: now })
            .eq('id', id).eq('status', order.status)
            .select('id').maybeSingle();
    }
    if (upd.error) {
        console.error('[Orders/Report] order update failed:', upd.error);
        return NextResponse.json({ error: upd.error.message }, { status: 500 });
    }
    if (!upd.data) {
        return NextResponse.json({ error: 'Order changed while reporting, refresh and try again', code: 'STATE_CHANGED' }, { status: 409 });
    }

    // Best effort: the report is already on file.
    try {
        const [{ data: buyer }, { data: seller }] = await Promise.all([
            admin.from('profiles').select('display_name, username').eq('id', order.buyer_id).maybeSingle(),
            admin.from('profiles').select('display_name, username').eq('id', order.seller_id).maybeSingle(),
        ]);
        await sendOrderDisputeAlert({
            orderId: id,
            shortId,
            reason: REASON_LABEL[reason],
            details,
            itemName,
            amountThb: Number(order.total_amount || 0),
            buyer: buyer?.username || buyer?.display_name || order.buyer_id,
            seller: seller?.username || seller?.display_name || order.seller_id,
            ticketId,
        });
    } catch (e) {
        console.error('[Orders/Report] alert failed:', e);
    }

    return NextResponse.json({ ok: true, ticketId });
}
