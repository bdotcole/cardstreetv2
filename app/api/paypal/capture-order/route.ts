/**
 * POST /api/paypal/capture-order
 *
 * Captures a previously-created PayPal order, then triggers the same
 * fulfillment path as the Stripe webhook (idempotent — safe to retry).
 *
 * Security:
 *   - Caller must be authenticated.
 *   - The PayPal order's purchase_unit must carry a custom_id that matches a
 *     transfer_group owned by the caller. The custom_id is set in
 *     /api/paypal/create-order and PayPal returns it unchanged in the capture
 *     payload — the client cannot tamper with it.
 *   - We re-check ownership of the orders before triggering fulfillment.
 */

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { fulfillOrdersByTransferGroup } from '@/lib/fulfillOrder';

const PAYPAL_API_BASE = process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !secret) {
        throw new Error('PayPal credentials are not configured');
    }
    const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');

    const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
        throw new Error(`PayPal auth failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.access_token as string;
}

export async function POST(req: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { orderID } = await req.json();
        if (!orderID || typeof orderID !== 'string') {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
        }

        const accessToken = await getAccessToken();

        const response = await fetch(
            `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    // PayPal-Request-Id makes the capture itself idempotent on
                    // the PayPal side — a double-tap won't capture twice.
                    'PayPal-Request-Id': `cs-capture-${orderID}`,
                },
            },
        );

        const captureData = await response.json();
        if (!response.ok) {
            throw new Error(captureData.message || 'Failed to capture PayPal order');
        }

        if (captureData.status !== 'COMPLETED') {
            return NextResponse.json({
                success: false,
                status: captureData.status,
                message: 'Payment not completed',
            });
        }

        const transactionId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        const transferGroup: string | undefined =
            captureData.purchase_units?.[0]?.custom_id
            || captureData.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;

        if (!transferGroup) {
            // Old client flow that didn't bind a transfer_group. Capture
            // succeeded but we can't fulfill any orders — log so support can
            // reconcile manually.
            console.warn(`[PayPal/Capture] Capture ${orderID} has no transfer_group — cannot trigger fulfillment`);
            Sentry.captureMessage('PayPal capture without transfer_group', {
                level: 'warning',
                tags: { handler: 'paypal-capture' },
                extra: { orderID, transactionId, userId: user.id },
            });
            return NextResponse.json({
                success: true,
                status: captureData.status,
                transactionId,
                fulfillment: { skipped: true, reason: 'no_transfer_group' },
            });
        }

        // Verify the caller owns the orders attached to this transfer_group.
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );
        const { data: ownerCheck } = await admin
            .from('orders')
            .select('buyer_id')
            .eq('transfer_group', transferGroup);

        if (!ownerCheck || ownerCheck.length === 0) {
            return NextResponse.json(
                { error: 'No orders found for this PayPal capture' },
                { status: 404 },
            );
        }
        if (!ownerCheck.every(o => o.buyer_id === user.id)) {
            return NextResponse.json(
                { error: 'You are not the buyer for these orders' },
                { status: 403 },
            );
        }

        // Trigger fulfillment — idempotent. Same CAS guard as the Stripe path.
        const result = await fulfillOrdersByTransferGroup(transferGroup, `paypal_${transactionId || orderID}`);

        return NextResponse.json({
            success: true,
            status: captureData.status,
            transactionId,
            fulfillment: {
                ordersUpdated: result.ordersUpdated,
                trackingNumbers: result.trackingNumbers,
                errors: result.errors,
            },
        });
    } catch (error: any) {
        console.error('PayPal Capture Order Error:', error);
        Sentry.captureException(error, { tags: { handler: 'paypal-capture' } });
        return NextResponse.json(
            { error: error.message || 'Failed to capture PayPal order' },
            { status: 500 },
        );
    }
}
