import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import {
    estimateRateWithCityFallback,
    fallbackShippingSatang,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
} from '@/lib/flashExpress';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fans out a synchronous Flash rate quote per seller — cap per user so a
    // loop can't drain the Flash quota. 30/min never limits a real buyer.
    const rl = await checkRateLimit(`shipcalc:${user.id}:1m`, { windowSeconds: 60, max: 30 });
    if (!rl.allowed) {
        return NextResponse.json(
            { error: 'Too many requests. Please wait a moment and try again.' },
            { status: 429, headers: { 'Retry-After': '30' } },
        );
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

        // Fetch seller profiles for origin. Cross-user read → service-role client:
        // the base table is locked to own-row SELECT and the origin address is not
        // in the public_profiles view.
        const { data: sellerProfiles } = await createAdminClient()
            .from('profiles')
            .select('*')
            .in('id', sellerIds);

        let totalShippingFee = 0;
        const breakdown: Record<string, number> = {};

        for (const sellerId of sellerIds) {
            const seller = sellerProfiles?.find(p => p.id === sellerId);
            // Cart items carry the Card snapshot — sealed products quote at
            // their real weight. Display-only estimate; checkout re-derives
            // from the DB.
            const sellerItems = items
                .filter((i: any) => i.sellerId === sellerId)
                .map((i: any) => ({
                    isSealed: i.card?.isSealed === true,
                    productType: i.card?.productType ?? null,
                }));

            // Base shipping in satang: live Flash quote when the seller has an
            // address (estimatePrice already includes fuel; upCountryAmount is
            // the additive upcountry premium), province-aware fallback otherwise.
            // Matches /api/orders/estimate and /api/orders/checkout.
            let baseSatang: number;
            if (!seller?.postcode) {
                baseSatang = fallbackShippingSatang(seller?.province, buyerProfile.province);
            } else {
                try {
                    const quote = await estimateRateWithCityFallback({
                        srcProvinceName: seller.province || 'กรุงเทพมหานคร',
                        srcCityName: seller.state || seller.district || 'เขตบางรัก', // Amphoe/Khet
                        srcPostalCode: seller.postcode,
                        dstProvinceName: buyerProfile.province || 'กรุงเทพมหานคร',
                        dstCityName: buyerProfile.state || buyerProfile.district || 'เขตบางรัก',
                        dstPostalCode: buyerProfile.postcode,
                        weight: estimateParcelWeightGramsForItems(sellerItems),
                        ...estimateParcelDimsCmForItems(sellerItems),
                    });
                    baseSatang = quote.estimatePrice + quote.upCountryAmount;
                    if (quote.usedCanonicalCity) {
                        console.warn(`[Shipping Calculate] Canonical-city retry used for seller ${sellerId} — ฿${baseSatang / 100}`);
                    }
                } catch (err) {
                    console.error(`[Shipping Calculate] Flash Express error for seller ${sellerId} — using fallback:`, err);
                    // Province-aware fallback (฿40 intra-Bangkok, ฿90 otherwise)
                    baseSatang = fallbackShippingSatang(seller?.province, buyerProfile.province);
                }
            }

            const rate = baseSatang / 100;
            totalShippingFee += rate;
            breakdown[sellerId as string] = rate;
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
