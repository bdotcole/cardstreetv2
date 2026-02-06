// API Route that Vercel Cron will call hourly
// This route then triggers the Supabase Edge Function

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    // Verify the request is from Vercel Cron
    const authHeader = request.headers.get('authorization');

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Call Supabase Edge Function
        const response = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-portfolio-snapshots`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const result = await response.json();

        return NextResponse.json({
            success: true,
            message: 'Portfolio snapshots created',
            details: result,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('Error triggering portfolio snapshots:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create snapshots' },
            { status: 500 }
        );
    }
}
