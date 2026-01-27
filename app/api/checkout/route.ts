
import { NextResponse } from 'next/server';
import Omise from 'omise';

const omise = Omise({
    publicKey: process.env.NEXT_PUBLIC_OMISE_PUBLIC_KEY!,
    secretKey: process.env.OMISE_SECRET_KEY!,
});

export async function POST(req: Request) {
    try {
        const { amount, currency, token, source, metadata } = await req.json();

        const charge = await omise.charges.create({
            amount: Math.round(amount * 100), // Convert to subunits (Stang/Cents)
            currency,
            card: token, // For Credit Card
            source,      // For PromptPay/TrueMoney/InternetBanking
            metadata,
            return_uri: `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('.supabase.co', '.vercel.app') || 'http://localhost:3000'}/marketplace?payment_status=complete` // Simplistic return URL
        });

        return NextResponse.json(charge);
    } catch (error: any) {
        console.error('Omise Charge Error:', error);
        return NextResponse.json(
            { error: error.message || 'Payment processing failed using Omise' },
            { status: 500 }
        );
    }
}
