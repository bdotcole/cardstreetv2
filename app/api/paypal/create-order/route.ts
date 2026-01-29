import { NextResponse } from 'next/server';

const PAYPAL_API_BASE = process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
    const auth = Buffer.from(
        `${process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString('base64');

    const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });

    const data = await response.json();
    return data.access_token;
}

export async function POST(req: Request) {
    try {
        const { amount, currency } = await req.json();

        const accessToken = await getAccessToken();

        const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [{
                    amount: {
                        currency_code: currency === 'THB' ? 'USD' : currency, // PayPal doesn't support THB directly
                        value: amount.toFixed(2),
                    },
                    description: 'CardStreet TCG Purchase',
                }],
            }),
        });

        const order = await response.json();

        if (!response.ok) {
            throw new Error(order.message || 'Failed to create PayPal order');
        }

        return NextResponse.json({ orderID: order.id });
    } catch (error: any) {
        console.error('PayPal Create Order Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create PayPal order' },
            { status: 500 }
        );
    }
}
