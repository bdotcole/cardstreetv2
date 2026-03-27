import { NextResponse } from 'next/server';
import { sendSoldNotification } from '@/lib/courier';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
    console.log("Starting Courier Test Route...");
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: users } = await supabase.from('profiles').select('id, email').limit(1);
    
    if (!users || users.length === 0) {
        return NextResponse.json({ error: "No user found to test with." });
    }
    
    const sellerId = users[0].id;
    console.log(`Testing with user ID: ${sellerId}`);

    const mockOrder = {
        id: "mock_order_12345",
        total_amount: "500.00"
    };

    try {
        await sendSoldNotification(sellerId, mockOrder);
        return NextResponse.json({ success: true, message: `Dispatched sold notification to ${sellerId}` });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
