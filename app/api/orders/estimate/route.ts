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
 *
 * Auth: caller must be the buyer.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
    estimateRate,
    isRegionError,
    fallbackShippingSatang,
    estimateParcelWeightGrams,
    estimateParcelDimsCm,
} from '@/lib/flashExpress';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
    BUYER_PROFILE_INCOMPLETE_TOAST,
    BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
} from '@/lib/profileValidation';

const EstimateBodySchema = z.object({
    items: z
        .array(
            z.object({
                id: z.string().min(1),
            }),
        )
        .min(1)
        .max(50),
});

export async function POST(req: Request) {
    try {
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsed = EstimateBodySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid estimate request', details: parsed.error.flatten() },
                { status: 400 },
            );
        }
        const { items } = parsed.data;

        const supabase = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        // ─── Gate: buyer must have a complete shipping profile ───
        // Matches the gate in /api/orders/checkout so the estimate UI can't
        // imply a buyer is allowed to proceed when they're not.
        const { data: buyerProfileGate, error: buyerProfileErr } = await supabase
            .from('profiles')
            .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
            .eq('id', user.id)
            .single<Record<string, string | null>>();

        if (buyerProfileErr || !buyerProfileGate) {
            return NextResponse.json(
                { error: 'Buyer profile not found' },
                { status: 404 },
            );
        }

        const buyerCompleteness = checkBuyerProfileComplete(buyerProfileGate);
        if (!buyerCompleteness.complete) {
            return NextResponse.json(
                {
                    error: BUYER_PROFILE_INCOMPLETE_TOAST,
                    code: BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
                    missing: buyerCompleteness.missing,
                },
                { status: 400 },
            );
        }

        // Re-derive seller + price from the DB. Estimate must match what we
        // will actually charge at /api/orders/checkout.
        const { data: listings } = await supabase
            .from('listings')
            .select('id, seller_id, price, status')
            .in('id', items.map(i => i.id));

        if (!listings || listings.length !== items.length) {
            return NextResponse.json({ error: 'One or more listings no longer exist' }, { status: 400 });
        }
        if (listings.some(l => l.status !== 'active')) {
            return NextResponse.json({ error: 'One or more listings are no longer available' }, { status: 409 });
        }

        const sellerIds = [...new Set(listings.map(l => l.seller_id))];

        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('id, province, state, district, postcode, stripe_account_id, stripe_region, stripe_charges_enabled')
            .in('id', sellerIds);

        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('province, state, district, postcode')
            .eq('id', user.id)
            .single();

        // Per-seller shipping. One charge per seller, regardless of how many
        // of their cards are in the cart — matches /api/orders/checkout.
        const sellerShipping = new Map<string, number>();
        const sellerShippingIsFallback = new Map<string, boolean>();

        for (const sellerId of sellerIds) {
            const sellerProfile = sellerProfiles?.find(p => p.id === sellerId);
            const cardCount = listings.filter(l => l.seller_id === sellerId).length;
            let baseSatang: number;
            let isFallback: boolean;
            try {
                const quote = await estimateRate({
                    srcProvinceName: sellerProfile?.province || 'กรุงเทพมหานคร',
                    srcCityName: sellerProfile?.state || sellerProfile?.district || 'เขตบางรัก',
                    srcPostalCode: sellerProfile?.postcode || '10500',
                    dstProvinceName: buyerProfile?.province || 'กรุงเทพมหานคร',
                    dstCityName: buyerProfile?.state || buyerProfile?.district || 'เขตบางรัก',
                    dstPostalCode: buyerProfile?.postcode || '10110',
                    weight: estimateParcelWeightGrams(cardCount),
                    ...estimateParcelDimsCm(cardCount),
                });
                baseSatang = quote.estimatePrice + quote.upCountryAmount;
                isFallback = false;
            } catch (err) {
                baseSatang = fallbackShippingSatang(sellerProfile?.province, buyerProfile?.province);
                isFallback = true;
                if (isRegionError(err)) {
                    console.warn(
                        `[Orders/Estimate] Flash region mismatch for seller ${sellerId} — fallback ฿${baseSatang / 100}`,
                    );
                } else {
                    console.error(`[Orders/Estimate] Flash estimate error for seller ${sellerId} — using fallback ฿${baseSatang / 100}:`, err);
                }
            }
            // Matches /api/orders/checkout exactly so the shown total equals the
            // charged total.
            sellerShipping.set(sellerId, baseSatang / 100);
            sellerShippingIsFallback.set(sellerId, isFallback);
        }

        const subtotal = listings.reduce((sum, l) => sum + Number(l.price || 0), 0);
        const shipping = Array.from(sellerShipping.values()).reduce((s, n) => s + n, 0);
        const total = subtotal + shipping;
        const shippingIsEstimate = Array.from(sellerShippingIsFallback.values()).some(Boolean);

        // For Thailand direct charges the buyer's card must be tokenized in the
        // SELLER's connected-account context (Stripe.js `stripeAccount`), or the
        // PaymentIntent that /api/checkout creates on that account rejects the
        // platform-scoped PaymentMethod. Only single-seller TH carts qualify
        // (matches the direct-charge constraint in /api/checkout); otherwise we
        // return null and the client tokenizes on the platform (US legacy).
        let sellerStripeAccountId: string | null = null;
        // True unless we can positively see a single-seller TH cart whose seller
        // hasn't finished Stripe verification (charges_enabled still false).
        // Sellers can list before verifying (list-first), so the buyer UI uses
        // this flag to block the pay step up front — an unverified seller's
        // listing is browsable but not purchasable until they verify. The
        // authoritative block is server-side in /api/orders/checkout.
        let sellerPayoutReady = true;
        if (sellerIds.length === 1) {
            const seller = sellerProfiles?.find(p => p.id === sellerIds[0]) as
                | { stripe_account_id?: string | null; stripe_region?: string | null; stripe_charges_enabled?: boolean | null }
                | undefined;
            if (seller?.stripe_region === 'th') {
                const ready = !!(seller.stripe_account_id && seller.stripe_charges_enabled);
                sellerPayoutReady = ready;
                if (ready) sellerStripeAccountId = seller.stripe_account_id!;
            }
        }

        return NextResponse.json({
            success: true,
            subtotal,
            shipping,
            total,
            // True if any seller's shipping line uses the fallback (Flash didn't
            // return a real rate). UI should flag the total as "approx" so the
            // buyer knows it may shift slightly at checkout.
            shippingIsEstimate,
            // Connected account to bind Stripe.js to for a direct charge, or null
            // when tokenizing on the platform. See PaymentModal.
            sellerStripeAccountId,
            // False only for a single-seller TH cart whose seller hasn't finished
            // Stripe verification yet. PaymentModal blocks the pay step on this.
            sellerPayoutReady,
            perSellerShipping: Object.fromEntries(sellerShipping),
            perSellerShippingIsFallback: Object.fromEntries(sellerShippingIsFallback),
        });
    } catch (err: any) {
        console.error('[Orders/Estimate] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to estimate order total' },
            { status: 500 },
        );
    }
}
