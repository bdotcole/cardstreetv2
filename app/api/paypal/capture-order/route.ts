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
        const { orderID } = await req.json();

        if (!orderID) {
            return NextResponse.json(
                { error: 'Order ID is required' },
                { status: 400 }
            );
        }

        const accessToken = await getAccessToken();

        const response = await fetch(
            `${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const captureData = await response.json();

        if (!response.ok) {
            throw new Error(captureData.message || 'Failed to capture PayPal order');
        }

        // Check if payment was successful
        const captureStatus = captureData.status;
        if (captureStatus === 'COMPLETED') {
            return NextResponse.json({
                success: true,
                status: captureStatus,
                transactionId: captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id,
            });
        } else {
            return NextResponse.json({
                success: false,
                status: captureStatus,
                message: 'Payment not completed',
            });
        }
    } catch (error: any) {
        console.error('PayPal Capture Order Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to capture PayPal order' },
            { status: 500 }
        );
    }
}
