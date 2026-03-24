
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

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to subunits (Cents/Stang)
            currency: currency.toLowerCase(),
            payment_method: token, // Stripe PaymentMethod ID from client
            confirm: true,
            return_url: `${baseUrl}/?payment_status=complete`,
            metadata,
        });

        return NextResponse.json({ status: paymentIntent.status, id: paymentIntent.id });
    } catch (error: any) {
        console.error('Stripe Charge Error:', error);
        return NextResponse.json(
            { error: error.message || 'Payment processing failed' },
            { status: 500 }
        );
    }
}
