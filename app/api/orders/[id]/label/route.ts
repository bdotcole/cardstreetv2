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
import { generateLabel } from '@/lib/flashExpress';
import { recoverShipmentForOrder } from '@/lib/flashRecovery';
import { verifyLabelToken } from '@/lib/labelToken';
import { embedArray } from '@/lib/utils/embed';

// Statuses where a Flash label should exist (or be recoverable). 'paid' is
// included so a seller can self-recover an order that was charged but whose
// Flash shipment failed during fulfillment (see the recover-unshipped-orders
// cron, which normally beats them to it).
const LABEL_EXPECTED_STATUSES = ['paid', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery'];

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
            .select('id, seller_id, buyer_id, status, transfer_group, break_spot_id, shipping_labels(tracking_number)')
            .eq('id', orderId)
            .single();

        if (orderErr || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        // Live-break spot orders never get a per-order Flash label — they ship
        // as one consolidated parcel per buyer per lot at stream settle. Refuse
        // both auth paths here (the signed-token path skips the /label/url
        // guard) before the recovery path below can mint a stray waybill.
        if (order.break_spot_id) {
            return NextResponse.json(
                {
                    error: 'This is a live-break order — it ships as part of the break parcel after the show.',
                    code: 'LIVE_BREAK_ORDER',
                },
                { status: 409 }
            );
        }

        // To-one embed: PostgREST returns an object, not an array (see
        // lib/utils/embed.ts) — a raw [0] here left trackingNumber null and
        // forced the recovery re-read on every request.
        const labels = embedArray(order.shipping_labels as { tracking_number: string | null }[] | { tracking_number: string | null } | null);
        let trackingNumber = labels[0]?.tracking_number || null;

        // ─── Recovery path ───
        // If the order has reached a status where a label should exist but
        // shipping_labels has no usable row (e.g. an earlier fulfillment failed
        // to persist), create a Flash shipment now.
        //
        // CAUTION: Flash does NOT treat outTradeNo as an idempotency key — a
        // second createShipment for the same order mints a *brand-new* pno.
        // (Proven by order 26126d8d: two waybills, WFAF97C and WKM1K5C, both
        // live for one outTradeNo.) So creating here when a real waybill
        // already exists elsewhere silently orphans the real one. Fulfillment
        // now persists the pno up front, so this path should almost never fire;
        // we still re-read directly (bypassing the possibly-stale joined SELECT)
        // right before creating, and never overwrite an existing real pno.
        const needsRecovery =
            (!trackingNumber || trackingNumber === 'MANUAL') &&
            LABEL_EXPECTED_STATUSES.includes(order.status);

        if (needsRecovery) {
            console.log(`[Orders/Label] No usable label for order ${orderId} at status ${order.status} — attempting Flash recovery`);
            // Shared with the recover-unshipped-orders cron. Re-reads
            // shipping_labels before minting and never double-mints (Flash does
            // not dedupe on outTradeNo).
            const rec = await recoverShipmentForOrder(admin, {
                id: order.id,
                seller_id: order.seller_id,
                buyer_id: order.buyer_id,
                transfer_group: order.transfer_group,
            });
            if (!rec.ok) {
                if (rec.reason === 'live_break_order') {
                    // Unreachable in practice (the guard above already
                    // refused), kept so the shared helper's defense reads back
                    // as the same 409 if this route's select ever drifts.
                    return NextResponse.json(
                        {
                            error: 'This is a live-break order — it ships as part of the break parcel after the show.',
                            code: 'LIVE_BREAK_ORDER',
                        },
                        { status: 409 }
                    );
                }
                if (rec.reason === 'profile_missing') {
                    return NextResponse.json(
                        { error: 'Seller or buyer profile missing — cannot recover label. Contact support.' },
                        { status: 500 }
                    );
                }
                return NextResponse.json(
                    {
                        error:
                            `Could not retrieve label from Flash: ${rec.error}. ` +
                            `This usually means the seller or buyer address is invalid for Flash, ` +
                            `or Flash production credentials need attention. Contact support.`,
                    },
                    { status: 502 }
                );
            }
            trackingNumber = rec.trackingNumber;
            // A recovered `paid` order never advanced past fulfillment's Flash
            // step — advance it now so buyer delivery tracking picks it up.
            if (order.status === 'paid') {
                await admin
                    .from('orders')
                    .update({ status: 'label_generated', updated_at: new Date().toISOString() })
                    .eq('id', order.id)
                    .eq('status', 'paid');
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
