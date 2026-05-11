
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    httpClient: Stripe.createFetchHttpClient()
});

export async function POST(req: Request) {
    try {
        const { amount, currency, token, metadata } = await req.json();

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === 'development'
            ? 'http://localhost:3000'
            : 'https://cardstreet.app');

        // The transfer_group MUST be provided by the orders/checkout route (created before payment).
        // This links the PaymentIntent to the pending orders in the database.
        const transferGroup = metadata?.transfer_group;
        if (!transferGroup) {
            return NextResponse.json(
                { error: 'transfer_group is required — create orders before initiating payment' },
                { status: 400 }
            );
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to subunits (Cents/Stang)
            currency: currency.toLowerCase(),
            payment_method: token, // Stripe PaymentMethod ID from client
            confirm: true,
            return_url: `${baseUrl}/?payment_status=complete`,
            metadata: {
                ...metadata,
                transfer_group: transferGroup,
                buyer_id: metadata?.buyer_id || '',
            },
            transfer_group: transferGroup,
        });

        return NextResponse.json({
            status: paymentIntent.status,
            id: paymentIntent.id,
            transfer_group: transferGroup,
        });
    } catch (error: any) {
        console.error('[Checkout] Stripe PaymentIntent Error:', error);
        return NextResponse.json(
            { error: error.message || 'Payment processing failed' },
            { status: 500 }
        );
    }
}
