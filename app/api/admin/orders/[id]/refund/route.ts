/**
 * POST /api/admin/orders/[id]/refund
 *
 * The admin's Cancel and refund button (app/admin/orders/_OrderPane). Runs
 * lib/orderRefunds for this order, or for its whole checkout, and records
 * the outcome on order_refunds. `alreadyRefunded` says the money went back
 * through the Stripe dashboard already (PromptPay refunds sometimes do), so
 * only the bookkeeping and the notices run.
 *
 * Body: { note?: string, scope?: 'order' | 'checkout', alreadyRefunded?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/adminAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { refundAndCancelOrders } from '@/lib/orderRefunds';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const gate = await requireAdminUser();
    if (gate instanceof NextResponse) return gate;
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const scope: 'order' | 'checkout' = body?.scope === 'checkout' ? 'checkout' : 'order';
    const alreadyRefunded = body?.alreadyRefunded === true;

    const admin = createAdminClient();
    let orderIds = [id];
    if (scope === 'checkout') {
        const { data: order } = await admin.from('orders').select('transfer_group').eq('id', id).maybeSingle<{ transfer_group: string | null }>();
        if (order?.transfer_group) {
            const { data: siblings } = await admin
                .from('orders')
                .select('id, status')
                .eq('transfer_group', order.transfer_group)
                .not('status', 'in', '(cancelled,completed,pending,pending_payment)');
            orderIds = (siblings ?? []).map((s: { id: string }) => s.id);
            if (orderIds.length === 0) orderIds = [id];
        }
    }

    try {
        const result = await refundAndCancelOrders(admin, {
            orderIds,
            source: 'admin',
            actorId: gate.user.id,
            note: note || (alreadyRefunded ? 'Refunded in the Stripe dashboard' : 'Cancelled and refunded by admin'),
            skipStripe: alreadyRefunded,
        });
        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        }
        return NextResponse.json(result);
    } catch (err: any) {
        console.error('[Admin/Orders/Refund] Error:', err);
        return NextResponse.json({ error: err?.message || 'Refund failed' }, { status: 500 });
    }
}
