/**
 * POST /api/orders/cancel-unshipped
 *
 * The buyer ASKS to cancel an order the seller has not shipped. It files a
 * support ticket that names the order; the team reviews it and refunds from
 * the admin order page (Cancel and refund -> lib/orderRefunds). It moves no
 * money and changes no order.
 *
 * Until 2026-11-12 this route refunded on the spot. The founder turned that
 * off: a cancellation is a request, reviewed by a person, the way a buyer
 * writing to support already was. (The path keeps its name so pages loaded
 * before the change still reach a route that answers.)
 *
 * Allowed once every order in the checkout is still unshipped (no Flash scan,
 * no handoff) and BUYER_CANCEL_AFTER_DAYS have passed since payment
 * (lib/orderDisputes). One open request per checkout: asking again answers
 * `alreadyOpen` instead of filing a second ticket.
 *
 * Body: { transferGroup: string }
 * Auth: cookie session; the caller must be the buyer.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedArray } from '@/lib/utils/embed';
import { BUYER_CANCEL_AFTER_DAYS, canBuyerCancelUnshipped, isUnshippedOrder, buyerCancelDate } from '@/lib/orderDisputes';
import { checkRateLimit } from '@/lib/rateLimit';
import { notifySupportInbox } from '@/lib/supportEmail';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SUBJECT_TAIL = 'Cancellation request (not shipped)';

interface OrderRow {
    id: string;
    buyer_id: string;
    seller_id: string | null;
    status: string;
    created_at: string;
    total_amount: number | string | null;
    break_spot_id: string | null;
    shipping_labels: unknown;
    listing: { card_data: { name?: string } | null } | { card_data: { name?: string } | null }[] | null;
}

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const transferGroup = typeof body?.transferGroup === 'string' ? body.transferGroup.trim() : '';
    if (!transferGroup) {
        return NextResponse.json({ error: 'transferGroup is required', code: 'NO_GROUP' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
        .from('orders')
        .select('id, buyer_id, seller_id, status, created_at, total_amount, break_spot_id, shipping_labels(tracking_number, status, handed_off_at), listing:listings(card_data)')
        .eq('transfer_group', transferGroup)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const orders = (data ?? []) as unknown as OrderRow[];
    if (orders.length === 0) return NextResponse.json({ error: 'Order not found', code: 'NOT_FOUND' }, { status: 404 });
    if (orders.some((o) => o.buyer_id !== user.id)) {
        return NextResponse.json({ error: 'Not your order', code: 'FORBIDDEN' }, { status: 403 });
    }

    const labelOf = (o: { shipping_labels: unknown }) => embedArray(o.shipping_labels as any)[0] as any;
    if (!orders.every((o) => isUnshippedOrder(o, labelOf(o)))) {
        return NextResponse.json(
            { error: 'This parcel has already left. If it does not arrive, report a problem with the order.', code: 'NOT_UNSHIPPED' },
            { status: 409 },
        );
    }
    if (!orders.every((o) => canBuyerCancelUnshipped(o, labelOf(o)))) {
        const availableAt = orders.map((o) => buyerCancelDate(o.created_at)?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
        return NextResponse.json(
            { error: `You can ask to cancel once the seller has had ${BUYER_CANCEL_AFTER_DAYS} days to ship`, code: 'TOO_EARLY', availableAt: availableAt ? new Date(availableAt).toISOString() : null },
            { status: 409 },
        );
    }

    // The ticket is keyed on the checkout's first order, the same way the
    // admin order page finds tickets ("Order: <id>" in the description).
    const first = orders[0];
    const shortId = first.id.slice(0, 8).toUpperCase();
    const subject = `[Order #${shortId}] ${SUBJECT_TAIL}`;

    const { data: open } = await admin
        .from('support_tickets')
        .select('id')
        .eq('user_id', user.id)
        .eq('subject', subject)
        .in('status', ['Open', 'In Progress'])
        .limit(1);
    if (open && open.length > 0) {
        return NextResponse.json({ ok: true, alreadyOpen: true, ticketId: open[0].id });
    }

    const rl = await checkRateLimit(`cancel-request:${user.id}:1d`, { windowSeconds: 86400, max: 10 });
    if (!rl.allowed) {
        return NextResponse.json({ error: 'Too many requests today', code: 'RATE_LIMITED' }, { status: 429 });
    }

    const nameOf = (o: OrderRow) => {
        const listing = Array.isArray(o.listing) ? o.listing[0] : o.listing;
        return (listing?.card_data?.name ?? '').toString();
    };
    const total = orders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const days = Math.floor((Date.now() - Date.parse(first.created_at)) / 864e5);
    const description = [
        ...orders.map((o) => `Order: ${o.id}${nameOf(o) ? ` (${nameOf(o)})` : ''}`),
        `Amount: ${total.toLocaleString()} THB`,
        `The buyer asks to cancel and be refunded: paid ${days} days ago and the seller has not shipped.`,
        'To approve: open the order in the admin order lookup and press Cancel and refund, then answer this ticket.',
    ].join('\n');

    let ins = await admin.from('support_tickets')
        .insert({ user_id: user.id, subject, description, category: 'Order' })
        .select('id').single();
    if (ins.error && ins.error.code === '23514') {
        ins = await admin.from('support_tickets')
            .insert({ user_id: user.id, subject, description, category: 'General' })
            .select('id').single();
    }
    if (ins.error) {
        console.error('[Orders/CancelRequest] ticket insert failed:', ins.error);
        return NextResponse.json({ error: 'Could not send the request' }, { status: 500 });
    }

    const ticketId = ins.data.id as string;
    after(() => notifySupportInbox(ticketId, { kind: 'new' }));

    return NextResponse.json({ ok: true, ticketId });
}
