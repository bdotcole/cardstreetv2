/**
 * Hammer-fall auto-charge (server-only): the auction winner's saved card is
 * charged OFF-SESSION the moment the auction closes sold — Whatnot's model,
 * and the founder's directive: winning a bid is the commitment, not an
 * invitation to check out.
 *
 * The money mechanics mirror /api/live/spots/checkout for the single-spot
 * case exactly — same partner-tier fee ladder, same first-purchase-from-lot
 * shipping (live Flash quote, or the per-spot increment on a repeat lot),
 * same order shape — then the charge leg swaps the on-session PaymentElement
 * for chargeLiveWinOffSession (platform-saved card cloned onto the seller's
 * connected account, off-session direct charge with the application fee).
 * Success runs the standard finalizeLiveSpotOrders, so order/spot/announce
 * behavior is identical to a manual checkout.
 *
 * EVERY failure degrades to the existing manual flow: the winner keeps the
 * checkout hold closeLiveAuction set, the pending order (if any) is
 * CAS-cancelled, and the caller announces "check out from your Spots bar".
 * No card, no address, unverified seller, clone failure, decline, 3DS-manda-
 * ted card — all land there. Auto-charge can only make the happy path
 * faster; it can never lose a sale the manual path would have kept.
 */

import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    applyProSellerRate,
    effectivePartnerLevel,
    feeFractionForLevel,
    NON_PARTNER_FEE_FRACTION,
} from '@/lib/partnerTiers';
import { isPremium } from '@/lib/entitlements';
import {
    estimateRateWithCityFallback,
    isRegionError,
    fallbackShippingSatang,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
    type ParcelItemInfo,
} from '@/lib/flashExpress';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
} from '@/lib/profileValidation';
import { isValidThaiPhone } from '@/lib/utils/phone';
import { chargeLiveWinOffSession } from '@/lib/liveStreamPayments';
import { finalizeLiveSpotOrders } from '@/lib/liveSpotFulfillment';
import { cancelPendingSpotOrders, type AuctionEngineRow, type LotRow } from '@/lib/liveBreaks';

export interface AutoChargeResult {
    charged: boolean;
    /** Why the fallback path applies (diagnostic; never shown raw to users). */
    reason?: string;
}

/**
 * Attempt the off-session charge for a hammered win. `spotId` is the exact
 * payment-vehicle spot closeLiveAuction just put on hold for the winner.
 */
export async function autoChargeAuctionWin(
    lot: LotRow,
    auction: AuctionEngineRow,
    spotId: string,
): Promise<AutoChargeResult> {
    try {
        const admin = createAdminClient();
        const winnerId = auction.winner_id;
        const amountSatang = auction.winning_amount ?? auction.current_price;
        if (!winnerId || !amountSatang) return { charged: false, reason: 'no_winner' };

        // ─── Winner: saved card + shippable address ───
        const { data: winner } = await admin
            .from('profiles')
            .select(
                `stripe_customer_id_th, live_default_payment_method, ${BUYER_REQUIRED_PROFILE_FIELDS.join(',')}`,
            )
            .eq('id', winnerId)
            .maybeSingle<Record<string, string | null>>();
        if (!winner) return { charged: false, reason: 'winner_profile_missing' };
        if (!winner.stripe_customer_id_th || !winner.live_default_payment_method) {
            return { charged: false, reason: 'no_saved_card' };
        }
        if (
            !checkBuyerProfileComplete(winner).complete ||
            !isValidThaiPhone(winner.phone_number)
        ) {
            return { charged: false, reason: 'incomplete_address' };
        }

        // ─── Seller: charge capability + fee tier + quote source address ───
        const { data: seller } = await admin
            .from('profiles')
            .select(
                'id, role, partner_level, total_downloads, partner_joined_at, premium_until, stripe_region, stripe_account_id, stripe_charges_enabled, province, state, district, postcode',
            )
            .eq('id', lot.seller_id)
            .maybeSingle<{
                id: string;
                role: string | null;
                partner_level: unknown;
                total_downloads: number | null;
                partner_joined_at: string | null;
                premium_until: string | null;
                stripe_region: string | null;
                stripe_account_id: string | null;
                stripe_charges_enabled: boolean | null;
                province: string | null;
                state: string | null;
                district: string | null;
                postcode: string | null;
            }>();
        if (!seller?.stripe_account_id || !seller.stripe_charges_enabled) {
            return { charged: false, reason: 'seller_not_chargeable' };
        }
        // Off-session direct charges are a TH-platform move.
        if (seller.stripe_region !== 'th') {
            return { charged: false, reason: 'not_th_seller' };
        }

        let feePct = NON_PARTNER_FEE_FRACTION;
        if (seller.partner_joined_at) {
            const level = effectivePartnerLevel(seller.partner_level, seller.total_downloads ?? 0);
            feePct = feeFractionForLevel(level);
        }
        feePct =
            seller.role === 'admin' ? 0 : applyProSellerRate(feePct, isPremium(seller.premium_until));

        // ─── Shipping: same first-purchase-from-lot rule as spots/checkout ───
        // Prior = any non-cancelled spot order by this buyer on this lot,
        // excluding the hammered spot itself (a stale abandoned group on it is
        // about to be CAS-cancelled below and must not read as "prior").
        let shippingSatang = 0;
        const { data: prior, error: priorErr } = await admin
            .from('orders')
            .select('id, break_spots!break_spot_id!inner(stream_item_id)')
            .eq('buyer_id', winnerId)
            .eq('break_spots.stream_item_id', lot.id)
            .neq('status', 'cancelled')
            .neq('break_spot_id', spotId)
            .limit(1)
            .returns<{ id: string }[]>();
        const hasPrior = !priorErr && (prior ?? []).length > 0;
        if (priorErr) {
            // Fail toward charging freight (same posture as checkout).
            console.error('[LiveAuctionCharge] prior-order check failed:', priorErr.message);
        }
        if (hasPrior) {
            const incRaw = Number(
                (lot as LotRow & { incremental_ship_satang?: unknown }).incremental_ship_satang,
            );
            shippingSatang = Number.isFinite(incRaw) && incRaw > 0 ? Math.round(incRaw) : 0;
        } else {
            const cd = (lot.card_data ?? {}) as { isSealed?: boolean; productType?: string | null };
            const items: ParcelItemInfo[] = [
                { isSealed: cd.isSealed === true, productType: cd.productType ?? null },
            ];
            try {
                const quote = await estimateRateWithCityFallback({
                    srcProvinceName: seller.province || 'กรุงเทพมหานคร',
                    srcCityName: seller.state || seller.district || 'เขตบางรัก',
                    srcPostalCode: seller.postcode || '10500',
                    dstProvinceName: winner.province || 'กรุงเทพมหานคร',
                    dstCityName: winner.state || winner.district || 'เขตบางรัก',
                    dstPostalCode: winner.postcode || '10110',
                    weight: estimateParcelWeightGramsForItems(items),
                    ...estimateParcelDimsCmForItems(items),
                });
                shippingSatang = quote.estimatePrice + quote.upCountryAmount;
            } catch (err) {
                shippingSatang = fallbackShippingSatang(seller.province, winner.province);
                if (isRegionError(err)) {
                    console.warn('[LiveAuctionCharge] Flash region mismatch — fallback shipping used');
                } else {
                    console.error('[LiveAuctionCharge] Flash estimate error — fallback used:', err);
                }
            }
        }

        // ─── One payable order, standard shape ───
        if (!(await cancelPendingSpotOrders(winnerId, [spotId]))) {
            return { charged: false, reason: 'stale_order_cancel_failed' };
        }
        const transferGroup = `live_${randomUUID()}`;
        const platformFeeSatang = Math.round(amountSatang * feePct);
        const { data: order, error: orderErr } = await admin
            .from('orders')
            .insert({
                listing_id: null,
                break_spot_id: spotId,
                buyer_id: winnerId,
                seller_id: lot.seller_id,
                status: 'pending_payment',
                total_amount: amountSatang / 100,
                platform_fee: platformFeeSatang / 100,
                shipping_fee: shippingSatang / 100,
                escrow_status: 'held',
                payment_method: 'credit_card',
                transfer_group: transferGroup,
                stripe_region: 'th',
            })
            .select('id')
            .single<{ id: string }>();
        if (orderErr || !order) {
            console.error('[LiveAuctionCharge] order insert failed:', orderErr?.message);
            return { charged: false, reason: 'order_insert_failed' };
        }

        // ─── The off-session charge (throws on decline / 3DS-mandate) ───
        try {
            const charge = await chargeLiveWinOffSession({
                sellerStripeAccountId: seller.stripe_account_id,
                platformCustomerId: winner.stripe_customer_id_th,
                savedPaymentMethodId: winner.live_default_payment_method,
                amountSatang: amountSatang + shippingSatang,
                applicationFeeSatang: platformFeeSatang,
                // Auction id, not order id: a re-run of this function for the
                // same win must reuse the SAME Stripe request, never mint a
                // second charge for one hammer.
                idempotencyKey: `auctionwin_${auction.id}`,
                description: `CardStreet live auction win ${auction.id}`,
                metadata: {
                    cardstreet_order_id: order.id,
                    cardstreet_auction_id: auction.id,
                    transfer_group: transferGroup,
                },
            });
            if (charge.status !== 'succeeded') {
                // Structurally unreachable off-session (Stripe throws instead)
                // — treat like a decline if it ever happens.
                throw new Error(`unexpected PI status ${charge.status}`);
            }

            const finalize = await finalizeLiveSpotOrders(transferGroup, charge.paymentIntentId);
            if (!finalize.success) {
                // Money is CAPTURED; finalize self-heals on webhook/retry
                // paths, so surface loudly but report the charge as done.
                console.error(
                    '[LiveAuctionCharge] finalize after charge reported errors:',
                    finalize.errors.join('; '),
                );
            }
            return { charged: true };
        } catch (err) {
            // Decline / authentication_required / clone failure — void the
            // order so the manual checkout can mint its own group cleanly.
            const code = (err as { code?: string } | null)?.code ?? String(err);
            console.warn(`[LiveAuctionCharge] off-session charge failed (${code}) — manual fallback`);
            await cancelPendingSpotOrders(winnerId, [spotId]);
            return { charged: false, reason: `charge_failed:${code}` };
        }
    } catch (err) {
        console.error('[LiveAuctionCharge] fatal:', err);
        return { charged: false, reason: 'fatal' };
    }
}
