/**
 * GET /api/orders/[id]/label
 *
 * Returns the Flash Express shipping label PDF for the given order. Always
 * regenerates fresh from Flash's pre_print endpoint — so it works even when
 * the original upload to Supabase Storage failed (missing bucket, RLS, etc.).
 *
 * Why this exists: lib/fulfillOrder.ts tries to upload the generated PDF to
 * the 'public-assets' bucket and store a public URL on shipping_labels.
 * Several real failure modes (bucket doesn't exist, service-role doesn't have
 * write access) cause the upload to fail silently — leaving label_url as
 * 'N/A'. The seller's UI hid the print button in that case, which meant a
 * paid order with a real Flash tracking number but no way for the seller to
 * actually get the label. This route closes that gap.
 *
 * Auth: seller of the order only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { generateLabel } from '@/lib/flashExpress';

export async function GET(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id: orderId } = await context.params;

    if (!orderId) {
        return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Service-role client to bypass RLS on the join — we do our own
        // authorization check immediately after.
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: order, error: orderErr } = await admin
            .from('orders')
            .select('id, seller_id, shipping_labels(tracking_number)')
            .eq('id', orderId)
            .single();

        if (orderErr || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        if (order.seller_id !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const labels = order.shipping_labels as { tracking_number: string | null }[] | null;
        const trackingNumber = labels?.[0]?.tracking_number;

        if (!trackingNumber || trackingNumber === 'MANUAL') {
            return NextResponse.json(
                { error: 'No shipping label available for this order yet. If this persists, contact support.' },
                { status: 404 }
            );
        }

        // Fetch the PDF directly from Flash. This is a fresh call every time
        // — not cached. Flash pre_print is idempotent and fast (~1s), so
        // serving on demand is fine for a print action that's clicked rarely.
        const pdfBuffer = await generateLabel(trackingNumber);

        return new Response(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="cardstreet-${orderId}-${trackingNumber}.pdf"`,
                'Cache-Control': 'private, max-age=300',
            },
        });
    } catch (err: any) {
        console.error('[Orders/Label] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to fetch shipping label' },
            { status: 500 }
        );
    }
}
