/**
 * POST /api/orders/cancel-unshipped
 *
 * The buyer gives up on a seller who has not shipped. Allowed once every
 * order in the checkout is still unshipped (no Flash scan, no handoff) and
 * BUYER_CANCEL_AFTER_DAYS have passed since payment (lib/orderDisputes).
 * Refunds the whole checkout through lib/orderRefunds: Stripe refund from
 * the seller's balance, orders cancelled, cards out of the collection, both
 * sides notified, a strike on the seller.
 *
 * Body: { transferGroup: string }
 * Auth: cookie session; the caller must be the buyer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedArray } from '@/lib/utils/embed';
import { canBuyerCancelUnshipped, isUnshippedOrder, buyerCancelDate } from '@/lib/orderDisputes';
import { refundAndCancelOrders } from '@/lib/orderRefunds';

export const runtime = 'nodejs';
export const maxDuration = 30;

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
        .select('id, buyer_id, status, created_at, break_spot_id, shipping_labels(tracking_number, status, handed_off_at)')
        .eq('transfer_group', transferGroup);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const orders = (data ?? []) as { id: string; buyer_id: string; status: string; created_at: string; break_spot_id: string | null; shipping_labels: unknown }[];
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
            { error: 'You can cancel once the seller has had four days to ship', code: 'TOO_EARLY', availableAt: availableAt ? new Date(availableAt).toISOString() : null },
            { status: 409 },
        );
    }

    try {
        const result = await refundAndCancelOrders(admin, {
            orderIds: orders.map((o) => o.id),
            source: 'buyer_cancel',
            actorId: user.id,
            note: 'Buyer cancelled an unshipped order',
        });
        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        }
        return NextResponse.json({ success: true, orderIds: result.orderIds, amountThb: result.amountThb });
    } catch (err: any) {
        console.error('[Orders/CancelUnshipped] Error:', err);
        return NextResponse.json({ error: err?.message || 'Could not cancel the order' }, { status: 500 });
    }
}
