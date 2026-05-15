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
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createShipment, generateLabel } from '@/lib/flashExpress';
import { verifyLabelToken } from '@/lib/labelToken';

// Statuses where a Flash label should exist (or be recoverable).
const LABEL_EXPECTED_STATUSES = ['label_generated', 'shipped', 'in_transit', 'out_for_delivery'];

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id: orderId } = await context.params;

    if (!orderId) {
        return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
    }

    try {
        // Service-role client used for the joined SELECT and any recovery
        // writes below. Authorization is enforced via one of two paths first:
        //   1. Signed token in the query string (used when the request comes
        //      from Android's DownloadManager or any context where cookies
        //      can't be attached — see /api/orders/[id]/label/url which
        //      issues these tokens to authenticated sellers).
        //   2. Cookie-based session as the order's seller (used by
        //      first-party pre-checks + direct web access).
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const sig = req.nextUrl.searchParams.get('sig');
        const expRaw = req.nextUrl.searchParams.get('exp');

        if (sig && expRaw) {
            // Signed-token auth path
            const exp = parseInt(expRaw, 10);
            if (!Number.isFinite(exp) || !verifyLabelToken(orderId, exp, sig)) {
                return NextResponse.json({ error: 'Invalid or expired link' }, { status: 403 });
            }
            // Authorization derives from the signed token alone — caller
            // already proved ownership when /label/url issued the URL.
        } else {
            // Cookie-based auth path
            const supabase = await createClient();
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }

            const { data: orderForAuth, error: orderErr } = await admin
                .from('orders')
                .select('seller_id')
                .eq('id', orderId)
                .single();
            if (orderErr || !orderForAuth) {
                return NextResponse.json({ error: 'Order not found' }, { status: 404 });
            }
            if (orderForAuth.seller_id !== user.id) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const { data: order, error: orderErr } = await admin
            .from('orders')
            .select('id, seller_id, buyer_id, status, shipping_labels(tracking_number)')
            .eq('id', orderId)
            .single();

        if (orderErr || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const labels = order.shipping_labels as { tracking_number: string | null }[] | null;
        let trackingNumber = labels?.[0]?.tracking_number || null;

        // ─── Recovery path ───
        // If the order has reached a status where a label should exist but
        // shipping_labels has no usable row (e.g., earlier fulfillment failed
        // to insert because of the missing courier_tracking_url column), call
        // Flash again with the same outTradeNo. Flash treats outTradeNo as an
        // idempotency key — if a shipment already exists for this order id,
        // it returns the same pno rather than creating a duplicate. If for
        // some reason none exists yet, this creates one. Either way, we end
        // up with a valid pno and a fresh shipping_labels row.
        const needsRecovery =
            (!trackingNumber || trackingNumber === 'MANUAL') &&
            LABEL_EXPECTED_STATUSES.includes(order.status);

        if (needsRecovery) {
            console.log(`[Orders/Label] No tracking number for order ${orderId} at status ${order.status} — attempting Flash recovery`);

            const { data: profiles } = await admin
                .from('profiles')
                .select('id, display_name, phone_number, province, state, district, sub_district, postcode, address')
                .in('id', [order.seller_id, order.buyer_id]);

            const seller = profiles?.find(p => p.id === order.seller_id);
            const buyer = profiles?.find(p => p.id === order.buyer_id);

            if (!seller || !buyer) {
                return NextResponse.json(
                    { error: 'Seller or buyer profile missing — cannot recover label. Contact support.' },
                    { status: 500 }
                );
            }

            try {
                const flashOrder = await createShipment({
                    outTradeNo: order.id,
                    srcName: seller.display_name || 'CardStreet Seller',
                    srcPhone: seller.phone_number || '0000000000',
                    srcProvinceName: seller.province || 'กรุงเทพมหานคร',
                    srcCityName: seller.state || seller.district || 'เขตบางรัก',
                    srcDistrictName: seller.sub_district || seller.district || 'บางรัก',
                    srcPostalCode: seller.postcode || '10500',
                    srcDetailAddress: seller.address || 'CardStreet Platform',
                    dstName: buyer.display_name || 'CardStreet Buyer',
                    dstPhone: buyer.phone_number || '0000000000',
                    dstProvinceName: buyer.province || 'กรุงเทพมหานคร',
                    dstCityName: buyer.state || buyer.district || 'เขตบางรัก',
                    dstDistrictName: buyer.sub_district || buyer.district || 'บางรัก',
                    dstPostalCode: buyer.postcode || '10500',
                    dstDetailAddress: buyer.address || 'CardStreet Platform',
                    weight: 500,
                    expressCategory: 1,
                    articleCategory: 3,
                    remark: 'CardStreet TCG - Handle with care',
                });

                // Persist so future clicks skip the recovery path and so the
                // buyer's Track Orders picks up the tracking link.
                const courierTrackingUrl = `https://www.flashexpress.com/fle/tracking?se=${flashOrder.pno}`;
                const { error: upsertErr } = await admin
                    .from('shipping_labels')
                    .upsert(
                        {
                            order_id: order.id,
                            tracking_number: flashOrder.pno,
                            carrier_name: 'Flash Express',
                            status: 'created',
                            label_url: 'N/A',
                            flash_order_id: flashOrder.outTradeNo,
                            flash_sort_code: flashOrder.sortCode,
                            pickup_id: null,
                            pickup_status: 'pending',
                            courier_tracking_url: courierTrackingUrl,
                        },
                        { onConflict: 'order_id' }
                    );

                if (upsertErr) {
                    // Not fatal for serving the PDF — we still have the pno.
                    // Just means the next click will recover again instead of
                    // hitting the fast path. Log so it can be investigated.
                    console.error('[Orders/Label] Recovery upsert failed:', upsertErr);
                }

                trackingNumber = flashOrder.pno;
            } catch (recoveryErr: any) {
                console.error('[Orders/Label] Flash recovery failed:', recoveryErr);
                return NextResponse.json(
                    {
                        error:
                            `Could not retrieve label from Flash: ${recoveryErr.message}. ` +
                            `This usually means the seller or buyer address is invalid for Flash, ` +
                            `or Flash production credentials need attention. Contact support.`,
                    },
                    { status: 502 }
                );
            }
        }

        if (!trackingNumber || trackingNumber === 'MANUAL') {
            return NextResponse.json(
                {
                    error:
                        trackingNumber === 'MANUAL'
                            ? 'This shipment requires manual handling — support will be in touch.'
                            : 'No shipping label available for this order yet.',
                },
                { status: 404 }
            );
        }

        // Fetch the PDF directly from Flash. Fresh call every time — Flash
        // pre_print is idempotent and ~1s, so on-demand is fine for a button
        // that's clicked rarely.
        const pdfBuffer = await generateLabel(trackingNumber);

        return new Response(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                // attachment (not inline) — Android Capacitor WebView only
                // hands the response to DownloadManager (and thus actually
                // saves the file to the device) when it sees attachment.
                // Web browsers also honor this by triggering a download
                // instead of opening an in-tab preview, which matches the
                // expected "Print Label" flow.
                'Content-Disposition': `attachment; filename="cardstreet-${orderId}-${trackingNumber}.pdf"`,
                'Cache-Control': 'private, max-age=300',
            },
        });
    } catch (err: any) {
        console.error('[Orders/Label] Error:', err);
        Sentry.captureException(err, {
            tags: { handler: 'orders-label' },
            extra: { orderId },
        });
        return NextResponse.json(
            { error: err.message || 'Failed to fetch shipping label' },
            { status: 500 }
        );
    }
}
