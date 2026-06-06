import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { estimateRate } from '@/lib/flashExpress';

const FALLBACK_RATE_THB = 40;

export async function POST(request: NextRequest) {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { items } = await request.json();

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'No items provided' }, { status: 400 });
        }

        // Get unique sellers
        const sellerIds = [...new Set(items.map((item: any) => item.sellerId))];

        // Fetch buyer profile for destination
        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (!buyerProfile?.postcode) {
            return NextResponse.json({ error: 'Buyer address incomplete' }, { status: 400 });
        }

        // Fetch seller profiles for origin
        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', sellerIds);

        let totalShippingFee = 0;
        const breakdown: Record<string, number> = {};

        for (const sellerId of sellerIds) {
            const seller = sellerProfiles?.find(p => p.id === sellerId);
            
            if (!seller?.postcode) {
                totalShippingFee += FALLBACK_RATE_THB;
                breakdown[sellerId as string] = FALLBACK_RATE_THB;
                continue;
            }

            try {
                // Call Flash Express to get real-time quote
                const quote = await estimateRate({
                    srcProvinceName: seller.province || 'กรุงเทพมหานคร',
                    srcCityName: seller.state || seller.district || 'เขตบางรัก', // Amphoe/Khet
                    srcPostalCode: seller.postcode,
                    dstProvinceName: buyerProfile.province || 'กรุงเทพมหานคร',
                    dstCityName: buyerProfile.state || buyerProfile.district || 'เขตบางรัก',
                    dstPostalCode: buyerProfile.postcode,
                    weight: 500, // Standard weight for trading card package
                    width: 10,
                    length: 15,
                    height: 2
                });

                // Convert cents to THB
                const rate = (quote.estimatePrice + quote.upCountryAmount) / 100;
                totalShippingFee += rate;
                breakdown[sellerId as string] = rate;
            } catch (err) {
                console.error(`[Shipping Calculate] Flash Express error for seller ${sellerId}:`, err);
                // Fallback to flat rate
                totalShippingFee += FALLBACK_RATE_THB;
                breakdown[sellerId as string] = FALLBACK_RATE_THB;
            }
        }

        return NextResponse.json({
            success: true,
            totalShippingFee,
            currency: 'THB',
            breakdown
        });

    } catch (error: any) {
        console.error('[Shipping Calculate] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
