/**
 * Auction settlement -- turns a 'sold' auction into a payable order on the
 * EXISTING checkout rail. No new Stripe surface: the winner pays through
 * /api/checkout (TH direct charge on the seller's connected account, tiered
 * application_fee_amount, PromptPay + card), and fulfillment/release-funds
 * run untouched.
 *
 * How the reuse works: the whole post-payment pipeline keys off
 * orders.listing_id -> listings.card_data (inventory transfer, sealed parcel
 * weights, order display). So settlement creates a SYNTHETIC listings row that
 * is born status='sold' -- it never appears in any marketplace query (those
 * all filter status='active') and adds no columns -- and hangs the order off
 * it. The auction row keeps its own card_data snapshot as source of truth.
 *
 * Idempotency: the order attach is a CAS on auctions.order_id IS NULL. A
 * losing racer deletes its own just-created rows. transfer_group is
 * deterministic per attempt ('auction_<id>_w' / '_sc'), which also pins the
 * Stripe PaymentIntent idempotency key downstream.
 *
 * Fees mirror app/api/orders/checkout exactly (admin-free, partner ladder,
 * Pro 5% floor) by importing the same modules -- zero duplicated math.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
    estimateRate,
    isRegionError,
    fallbackShippingSatang,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
} from '@/lib/flashExpress';
import {
    applyProSellerRate,
    effectivePartnerLevel,
    feeFractionForLevel,
    NON_PARTNER_FEE_FRACTION,
} from '@/lib/partnerTiers';
import { isPremium } from '@/lib/entitlements';
import { PAYMENT_WINDOW_HOURS } from '@/lib/auctionRules';

function getAdmin(): SupabaseClient {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

export interface SettlementResult {
    ok: boolean;
    /** 'settled' | 'already_settled' | 'not_ready' | 'seller_unverified' | 'error' */
    outcome: string;
    auctionId: string;
    orderId?: string;
    transferGroup?: string;
    /** THB the winner will be charged (item + shipping). */
    totalAmount?: number;
    winnerId?: string;
    sellerId?: string;
    paymentDueAt?: string;
    error?: string;
}

/**
 * Create the pending_payment order for a sold auction's current winner.
 * Safe to call repeatedly (cron retries until it sticks); returns
 * 'already_settled' when the auction has an order attached.
 */
export async function settleAuction(auctionId: string): Promise<SettlementResult> {
    const supabase = getAdmin();
    const base: SettlementResult = { ok: false, outcome: 'error', auctionId };

    try {
        const { data: auction, error: aErr } = await supabase
            .from('auctions')
            .select('*')
            .eq('id', auctionId)
            .single();

        if (aErr || !auction) {
            return { ...base, outcome: 'not_ready', error: aErr?.message || 'Auction not found' };
        }
        if (auction.status !== 'sold' || !auction.winner_id || !auction.winning_amount) {
            return { ...base, outcome: 'not_ready' };
        }
        if (auction.order_id) {
            return {
                ...base,
                ok: true,
                outcome: 'already_settled',
                orderId: auction.order_id,
                winnerId: auction.winner_id,
                sellerId: auction.seller_id,
            };
        }
        // An open (unaccepted) second-chance offer means there's no payable
        // winner yet -- the accept flow flips winner fields first.
        if (auction.second_chance_status === 'offered') {
            return { ...base, outcome: 'not_ready' };
        }

        // ─── Profiles: seller (fee inputs + chargeability + address), winner (address) ───
        const [{ data: seller }, { data: winner }] = await Promise.all([
            supabase
                .from('profiles')
                .select('id, role, partner_level, total_downloads, partner_joined_at, premium_until, province, state, district, postcode, stripe_region, stripe_account_id, stripe_charges_enabled')
                .eq('id', auction.seller_id)
                .single(),
            supabase
                .from('profiles')
                .select('id, province, state, district, postcode')
                .eq('id', auction.winner_id)
                .single(),
        ]);

        if (!seller) {
            return { ...base, outcome: 'error', error: 'Seller profile not found' };
        }
        // Auction creation requires a chargeable seller, so this only fires if
        // the account degraded between creation and close. Leave the auction
        // unsettled; the sweep retries every minute and ops sees the log.
        if (!(seller.stripe_account_id && seller.stripe_charges_enabled)) {
            console.error(`[AuctionSettle] Seller ${seller.id} not chargeable for auction ${auctionId} — retrying next sweep`);
            return { ...base, outcome: 'seller_unverified' };
        }

        const region = seller.stripe_region === 'th' || seller.stripe_region === 'us'
            ? seller.stripe_region
            : 'us';

        // ─── Platform fee (identical policy to /api/orders/checkout) ───
        let feeFraction = NON_PARTNER_FEE_FRACTION;
        if (seller.partner_joined_at) {
            const level = effectivePartnerLevel(seller.partner_level, seller.total_downloads ?? 0);
            feeFraction = feeFractionForLevel(level);
        }
        feeFraction = seller.role === 'admin'
            ? 0
            : applyProSellerRate(feeFraction, isPremium(seller.premium_until));

        const priceSatang = Number(auction.winning_amount);
        const platformFeeSatang = Math.round(priceSatang * feeFraction);

        // ─── Shipping (live Flash quote, sealed-aware; province fallback) ───
        const items = [{
            isSealed: (auction.card_data as any)?.isSealed === true,
            productType: (auction.card_data as any)?.productType ?? null,
        }];
        let shippingSatang: number;
        try {
            const quote = await estimateRate({
                srcProvinceName: seller.province || 'กรุงเทพมหานคร',
                srcCityName: seller.state || seller.district || 'เขตบางรัก',
                srcPostalCode: seller.postcode || '10500',
                dstProvinceName: winner?.province || 'กรุงเทพมหานคร',
                dstCityName: winner?.state || winner?.district || 'เขตบางรัก',
                dstPostalCode: winner?.postcode || '10110',
                weight: estimateParcelWeightGramsForItems(items),
                ...estimateParcelDimsCmForItems(items),
            });
            shippingSatang = quote.estimatePrice + quote.upCountryAmount;
        } catch (err) {
            shippingSatang = fallbackShippingSatang(seller.province, winner?.province);
            if (isRegionError(err)) {
                console.warn(`[AuctionSettle] Flash region mismatch for auction ${auctionId} — fallback ฿${shippingSatang / 100}`);
            } else {
                console.error(`[AuctionSettle] Flash estimate error for auction ${auctionId} — fallback ฿${shippingSatang / 100}:`, err);
            }
        }

        // ─── Synthetic sold listing (the rail's card_data carrier) ───
        const { data: listing, error: lErr } = await supabase
            .from('listings')
            .insert({
                seller_id: auction.seller_id,
                card_id: auction.card_id,
                card_data: auction.card_data,
                price: priceSatang / 100,
                condition: auction.condition,
                is_graded: auction.is_graded || false,
                grading_company: auction.grading_company,
                grade: auction.grade,
                image_front_url: auction.image_front_url,
                image_back_url: auction.image_back_url,
                status: 'sold',
            })
            .select('id')
            .single();

        if (lErr || !listing) {
            return { ...base, outcome: 'error', error: `Listing insert failed: ${lErr?.message}` };
        }

        // Deterministic per attempt: '_w' for the original winner, '_sc' for a
        // second-chance settlement (different amount ⇒ different PI idempotency).
        const transferGroup = `auction_${auction.id}_${auction.won_via === 'second_chance' ? 'sc' : 'w'}`;

        const { data: order, error: oErr } = await supabase
            .from('orders')
            .insert({
                listing_id: listing.id,
                buyer_id: auction.winner_id,
                seller_id: auction.seller_id,
                status: 'pending_payment',
                total_amount: priceSatang / 100,
                platform_fee: platformFeeSatang / 100,
                shipping_fee: shippingSatang / 100,
                escrow_status: 'held',
                payment_method: 'auction_invoice',
                transfer_group: transferGroup,
                stripe_region: region,
            })
            .select('id')
            .single();

        if (oErr || !order) {
            await supabase.from('listings').delete().eq('id', listing.id);
            return { ...base, outcome: 'error', error: `Order insert failed: ${oErr?.message}` };
        }

        const paymentDueAt = new Date(Date.now() + PAYMENT_WINDOW_HOURS * 3600_000).toISOString();

        // ─── CAS-attach: exactly one settlement wins ───
        const { data: attached, error: casErr } = await supabase
            .from('auctions')
            .update({ order_id: order.id, payment_due_at: paymentDueAt })
            .eq('id', auction.id)
            .eq('status', 'sold')
            .is('order_id', null)
            .select('id');

        if (casErr || !attached || attached.length === 0) {
            // Lost the race (or state moved): remove our rows; the winner's
            // settlement stands.
            await supabase.from('orders').delete().eq('id', order.id);
            await supabase.from('listings').delete().eq('id', listing.id);
            return {
                ...base,
                ok: !casErr,
                outcome: casErr ? 'error' : 'already_settled',
                error: casErr?.message,
            };
        }

        return {
            ok: true,
            outcome: 'settled',
            auctionId,
            orderId: order.id,
            transferGroup,
            totalAmount: (priceSatang + shippingSatang) / 100,
            winnerId: auction.winner_id,
            sellerId: auction.seller_id,
            paymentDueAt,
        };
    } catch (err: any) {
        console.error(`[AuctionSettle] Fatal for auction ${auctionId}:`, err);
        return { ...base, outcome: 'error', error: err?.message };
    }
}
