/**
 * POST /api/paypal/create-order
 *
 * Creates a PayPal order for a previously-created transfer_group of
 * pending_payment orders. Amount is computed server-side from the orders
 * table — the client cannot influence it.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

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
        // ─── Auth ───
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const transferGroup: string | undefined = body?.transferGroup;
        const requestedCurrency: string = typeof body?.currency === 'string' ? body.currency : 'THB';

        if (!transferGroup) {
            return NextResponse.json(
                { error: 'transferGroup is required (create orders via /api/orders/checkout first)' },
                { status: 400 }
            );
        }

        // ─── Authoritative amount from DB ───
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: orders, error: ordersErr } = await admin
            .from('orders')
            .select('id, buyer_id, status, total_amount, shipping_fee')
            .eq('transfer_group', transferGroup);

        if (ordersErr || !orders || orders.length === 0) {
            return NextResponse.json({ error: 'No orders for this transfer_group' }, { status: 404 });
        }
        if (!orders.every(o => o.buyer_id === user.id)) {
            return NextResponse.json({ error: 'You are not the buyer for these orders' }, { status: 403 });
        }
        if (!orders.every(o => o.status === 'pending_payment')) {
            return NextResponse.json({ error: 'Orders are not in a payable state' }, { status: 409 });
        }

        const totalSatang = orders.reduce(
            (sum, o) =>
                sum +
                Math.round(Number(o.total_amount || 0) * 100) +
                Math.round(Number(o.shipping_fee || 0) * 100),
            0,
        );
        const amount = (totalSatang / 100).toFixed(2);

        // PayPal doesn't support THB; the merchant has chosen to settle in USD
        // for now. If the buyer's chosen currency is THB we mirror that fallback;
        // otherwise honor what they sent.
        const currencyCode = requestedCurrency === 'THB' ? 'USD' : requestedCurrency;

        const accessToken = await getAccessToken();

        const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                // Bind PayPal's request idempotency to our transfer_group so a
                // double-tap or network retry won't create two PayPal orders.
                'PayPal-Request-Id': `cs-checkout-${transferGroup}`,
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [{
                    amount: { currency_code: currencyCode, value: amount },
                    description: 'CardStreet TCG Purchase',
                    custom_id: transferGroup,
                }],
            }),
        });

        const order = await response.json();
        if (!response.ok) {
            throw new Error(order.message || 'Failed to create PayPal order');
        }

        return NextResponse.json({ orderID: order.id });
    } catch (error: any) {
        console.error('[PayPal Create Order] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create PayPal order' },
            { status: 500 }
        );
    }
}
