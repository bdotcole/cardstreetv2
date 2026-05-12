/**
 * POST /api/orders/estimate
 *
 * Returns a shipping + total breakdown for the items in the buyer's cart
 * WITHOUT creating any orders or reserving listings. Mirrors the per-seller
 * shipping calculation in /api/orders/checkout so the displayed total matches
 * what the buyer will actually be charged.
 *
 * Used by PaymentModal on open to show the buyer the real total (subtotal +
 * shipping) before they enter card details. The actual order rows are only
 * inserted when /api/orders/checkout runs at pay time.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { estimateRate, isRegionError } from '@/lib/flashExpress';

const FALLBACK_RATE_THB = 40;

export async function POST(req: Request) {
    try {
        const { items, buyerId } = await req.json();

        if (!items || !items.length || !buyerId) {
            return NextResponse.json(
                { error: 'Missing required fields (items, buyerId)' },
                { status: 400 }
            );
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const sellerIds = [...new Set(items.map((i: any) => i.sellerId))] as string[];

        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('id, province, state, district, postcode')
            .in('id', sellerIds);

        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('province, state, district, postcode')
            .eq('id', buyerId)
            .single();

        // Per-seller shipping. One charge per seller, regardless of how many
        // of their cards are in the cart — matches /api/orders/checkout.
        const sellerShippingMap = new Map<string, number>();

        for (const sellerId of sellerIds) {
            const sellerProfile = sellerProfiles?.find(p => p.id === sellerId);
            try {
                const quote = await estimateRate({
                    srcProvinceName: sellerProfile?.province || 'กรุงเทพมหานคร',
                    srcCityName: sellerProfile?.state || sellerProfile?.district || 'เขตบางรัก',
                    srcPostalCode: sellerProfile?.postcode || '10500',
                    dstProvinceName: buyerProfile?.province || 'กรุงเทพมหานคร',
                    dstCityName: buyerProfile?.state || buyerProfile?.district || 'เขตบางรัก',
                    dstPostalCode: buyerProfile?.postcode || '10110',
                    weight: 500,
                    width: 10,
                    length: 15,
                    height: 2,
                });
                sellerShippingMap.set(sellerId, (quote.estimatePrice + quote.upCountryAmount) / 100);
            } catch (err) {
                if (isRegionError(err)) {
                    console.warn(
                        `[Orders/Estimate] Flash region mismatch for seller ${sellerId} — using ฿${FALLBACK_RATE_THB} fallback`
                    );
                } else {
                    console.error(`[Orders/Estimate] Unexpected Flash error for seller ${sellerId}:`, err);
                }
                sellerShippingMap.set(sellerId, FALLBACK_RATE_THB);
            }
        }

        const subtotal = items.reduce((sum: number, i: any) => sum + (i.price || 0), 0);
        const shipping = Array.from(sellerShippingMap.values()).reduce((s, n) => s + n, 0);
        const total = subtotal + shipping;

        return NextResponse.json({
            success: true,
            subtotal,
            shipping,
            total,
            // Optional per-seller breakdown for UIs that want to show it
            perSellerShipping: Object.fromEntries(sellerShippingMap),
        });
    } catch (err: any) {
        console.error('[Orders/Estimate] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to estimate order total' },
            { status: 500 }
        );
    }
}
