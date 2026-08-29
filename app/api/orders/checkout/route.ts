/**
 * Orders Checkout Route — Phase 1 (Synchronous)
 *
 * Creates orders with status 'pending_payment' and reserves inventory.
 * This runs BEFORE the Stripe PaymentIntent is created.
 *
 * Flow:
 *   1. Client calls POST /api/orders/checkout → orders created, listings reserved
 *   2. Client calls POST /api/checkout with transfer_group → Stripe charges card
 *   3. Stripe webhook fires payment_intent.succeeded → fulfillOrder() runs
 *
 * Security:
 *   - The buyer is the authenticated user (cookie session), never trusted from the body.
 *   - Prices come from the listings table, never trusted from the body.
 *   - Listing reservation is a compare-and-swap on status='active' so a second
 *     checkout for the same listing fails closed.
 *   - The inventory move (collection_items rows) was previously done here BEFORE
 *     payment; it is now deferred to fulfillOrdersByTransferGroup so a failed
 *     or abandoned payment can't transfer cards.
 *
 * Dual-platform: every order is stamped with the seller's `stripe_region` so
 * downstream — /api/checkout, the webhook, release-funds — can route the
 * PaymentIntent and seller transfer through the correct Stripe platform. A
 * cart that mixes sellers across regions is rejected; check out per region.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
    estimateRateWithCityFallback,
    isRegionError,
    fallbackShippingSatang,
    estimateParcelWeightGramsForItems,
    estimateParcelDimsCmForItems,
} from '@/lib/flashExpress';
import { applyProSellerRate, effectivePartnerLevel, feeFractionForLevel, NON_PARTNER_FEE_FRACTION } from '@/lib/partnerTiers';
import { isPremium } from '@/lib/entitlements';
import { isFeatureEnabled } from '@/lib/betaAuth';
import { distributeVoucherDiscount, voucherDiscountSatang } from '@/lib/rewardTiers';
import type { VoucherItemRow } from '@/lib/rewards';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import {
    BUYER_REQUIRED_PROFILE_FIELDS,
    checkBuyerProfileComplete,
    BUYER_PROFILE_INCOMPLETE_TOAST,
    BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
    SELLER_UNVERIFIED_TOAST,
    SELLER_UNVERIFIED_ERROR_CODE,
} from '@/lib/profileValidation';
import { isValidThaiPhone } from '@/lib/utils/phone';

interface CheckoutItem {
    id: string; // listing id
}

export async function POST(req: Request) {
    try {
        // ─── Auth: caller is the buyer, period. ───
        const cookieSupabase = await createServerClient();
        const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
        if (authErr || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const buyerId = user.id;

        // ─── Geo gate: purchases are Thailand-only for now ───
        // Shipping (Flash Express) is only configured for TH, so we block
        // checkout for buyers we can see are outside Thailand. This fires
        // before any DB work, so a rejected request leaves no side effects.
        // Unknown geo (local dev / unresolvable IP) is allowed through — see
        // lib/geo.ts. Browsing and collection features are never gated here.
        const buyerCountry = getRequestCountry(req);
        if (!isPurchaseAllowedFromCountry(buyerCountry)) {
            return NextResponse.json(
                {
                    error:
                        'Purchases are currently only available in Thailand. ' +
                        'Buying is coming soon to your country.',
                    code: 'GEO_RESTRICTED',
                    country: buyerCountry,
                },
                { status: 403 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const items: CheckoutItem[] = Array.isArray(body?.items) ? body.items : [];
        // OBO Best-Offer: when the buyer is paying an accepted offer, this is the
        // offer id. The PRICE is never trusted from the client — it's read from
        // the offers table below (server-authoritative). Feature-gated: the
        // override only applies while NEXT_PUBLIC_ENABLE_OFFERS === '1'.
        const acceptedOfferId: string | null =
            process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1' &&
            typeof body?.acceptedOfferId === 'string' && body.acceptedOfferId.length > 0
                ? body.acceptedOfferId
                : null;
        const paymentMethod: string = typeof body?.paymentMethod === 'string' ? body.paymentMethod : 'credit_card';
        // The total the buyer was shown in the modal (THB). We use it to GUARANTEE
        // we never charge more than what was displayed: if the server's freshly
        // computed total exceeds it (e.g. Flash returned a higher live rate than
        // the estimate shown), we reject so the buyer can review — rather than
        // silently overcharging. We never charge below the server total, so this
        // can't be abused to underpay.
        const expectedTotal: number | null =
            typeof body?.expectedTotal === 'number' && body.expectedTotal > 0
                ? body.expectedTotal
                : null;
        // Collector Pass buyer voucher (funded from the platform fee). Gated
        // behind its own kill switch, and never combinable with an accepted
        // offer (the offer is already the discount).
        const voucherId: string | null =
            typeof body?.voucherId === 'string' && body.voucherId.length > 0 ? body.voucherId : null;

        if (items.length === 0) {
            return NextResponse.json({ error: 'No items provided' }, { status: 400 });
        }
        if (items.length > 50) {
            return NextResponse.json({ error: 'Too many items in a single checkout' }, { status: 400 });
        }

        const listingIds = items.map(i => i?.id).filter((x): x is string => typeof x === 'string');
        if (listingIds.length !== items.length) {
            return NextResponse.json({ error: 'Each item must have an id (listing id)' }, { status: 400 });
        }

        const supabase = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // ─── Gate: buyer must have a complete shipping profile ───
        // Mirrors the seller-side gate in lib/profileValidation.ts. Without
        // this, fulfillOrder would substitute Bangkok placeholders into Flash
        // Express and the order would either fail validation or ship to the
        // wrong address. Returns a structured error the client uses to bounce
        // the user to Profile.
        const { data: buyerProfileGate, error: buyerProfileErr } = await supabase
            .from('profiles')
            .select(BUYER_REQUIRED_PROFILE_FIELDS.join(','))
            .eq('id', buyerId)
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

        // Presence isn't enough for the phone: Flash needs a dialable number to
        // deliver, and a junk value (e.g. "n/a") would pass the non-empty check
        // above yet strand the parcel. Require a valid TH number specifically.
        if (!isValidThaiPhone(buyerProfileGate.phone_number)) {
            return NextResponse.json(
                {
                    error: BUYER_PROFILE_INCOMPLETE_TOAST,
                    code: BUYER_PROFILE_INCOMPLETE_ERROR_CODE,
                    missing: ['phone_number'],
                },
                { status: 400 },
            );
        }

        // ─── Look up real listings + prices from the DB. Never trust the body. ───
        const { data: listings, error: listingsErr } = await supabase
            .from('listings')
            .select('id, seller_id, card_id, card_data, price, condition, status')
            .in('id', listingIds);

        if (listingsErr || !listings) {
            console.error('[Orders/Checkout] Failed to fetch listings:', listingsErr);
            return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 });
        }
        if (listings.length !== listingIds.length) {
            return NextResponse.json({ error: 'One or more listings no longer exist' }, { status: 400 });
        }
        if (listings.some(l => l.status !== 'active')) {
            return NextResponse.json({ error: 'One or more listings are no longer available' }, { status: 409 });
        }
        if (listings.some(l => l.seller_id === buyerId)) {
            return NextResponse.json({ error: "You can't buy your own listing" }, { status: 400 });
        }

        const transferGroup = `order_${randomUUID()}`;

        // ─── Fetch profiles (sellers for fees + addresses, buyer for shipping) ───
        const sellerIds = [...new Set(listings.map(l => l.seller_id))];
        const { data: sellerProfiles } = await supabase
            .from('profiles')
            .select('id, role, partner_level, total_downloads, partner_joined_at, premium_until, province, state, district, postcode, stripe_region, stripe_account_id, stripe_charges_enabled')
            .in('id', sellerIds);

        const { data: buyerProfile } = await supabase
            .from('profiles')
            .select('province, state, district, postcode')
            .eq('id', buyerId)
            .single();

        // ─── Determine the order's processing region ───
        // Every seller in the cart must be on the same Stripe platform — a
        // single PaymentIntent on platform A can't transfer to a connected
        // account on platform B. Mixed-region carts have to be split by
        // currency. Legacy sellers without a region default to 'us'.
        const sellerRegions = (sellerProfiles ?? []).map(p => {
            const r = p.stripe_region;
            return (r === 'us' || r === 'th') ? r : 'us';
        });
        const uniqueRegions = [...new Set(sellerRegions)];
        if (uniqueRegions.length > 1) {
            // Roll the listings nothing yet — return before any side effects.
            return NextResponse.json(
                {
                    error:
                        'Cart contains sellers in different currencies. Check out one ' +
                        'currency at a time.',
                },
                { status: 400 }
            );
        }
        const orderRegion = (uniqueRegions[0] ?? 'us') as 'us' | 'th';

        // ─── Single-seller carts on the TH platform ───
        // Destination charges (region='th') have exactly one destination
        // account per PaymentIntent, so a TH cart can only target one seller.
        // The legacy US flow (separate charges + transfers) can still pool
        // multiple sellers under one PaymentIntent because the transfer step
        // happens later, per-seller.
        if (orderRegion === 'th') {
            const sellerIdsInCart = [...new Set(listings.map(l => l.seller_id))];
            if (sellerIdsInCart.length > 1) {
                return NextResponse.json(
                    {
                        error:
                            'Multi-seller carts are not yet supported. Please check out ' +
                            'one seller at a time.',
                    },
                    { status: 400 }
                );
            }
        }

        // ─── Gate: every seller must be able to RECEIVE the charge ───
        // Sellers can now LIST before finishing Stripe identity verification
        // (list-first — see lib/profileValidation.ts), so we enforce the
        // "charges_enabled" requirement here at purchase time. On the TH
        // direct-charge model the PaymentIntent is created on the seller's
        // connected account; an unverified seller (no account or charges not
        // yet enabled) can't be paid, and /api/checkout would reject. We catch
        // it here FIRST — before reserving listings or inserting orders — so a
        // blocked cart leaves no dangling reservation or pending order.
        const unverifiedSeller = (sellerProfiles ?? []).find(
            (p) =>
                sellerIds.includes(p.id) &&
                !(p.stripe_account_id && p.stripe_charges_enabled),
        );
        if (unverifiedSeller) {
            return NextResponse.json(
                {
                    error: SELLER_UNVERIFIED_TOAST,
                    code: SELLER_UNVERIFIED_ERROR_CODE,
                },
                { status: 409 },
            );
        }

        // ─── Platform fee tier ───
        // The fee ladder (level -> percent, downloads -> level) lives in
        // lib/partnerTiers.ts so this and components/PartnerPortal can't drift.
        // The effective level is the higher of the admin-set partner_level and
        // the level the seller's total_downloads have earned, so the loyalty
        // loop (downloads -> level -> fee) holds even before the DB trigger in
        // 20260701_partner_level_from_downloads.sql runs. Partner status is
        // keyed off partner_joined_at, not `role`: an admin can also be a
        // partner, and `role` (single-valued) can't hold both.
        const feeMap = new Map<string, number>();
        for (const profile of sellerProfiles || []) {
            let fee = NON_PARTNER_FEE_FRACTION;
            if (profile.partner_joined_at) {
                const level = effectivePartnerLevel(profile.partner_level, profile.total_downloads ?? 0);
                fee = feeFractionForLevel(level);
            }
            // Admins (house accounts) sell fee-free -- /api/checkout omits a
            // zero application_fee_amount, so Stripe sees no fee at all.
            // CardStreet Pro subscribers get the 5% floor; a partner ladder
            // already better than 5% still wins.
            if (profile.role === 'admin') {
                feeMap.set(profile.id, 0);
            } else {
                feeMap.set(profile.id, applyProSellerRate(fee, isPremium(profile.premium_until)));
            }
        }

        // ─── Shipping estimate per seller (in integer satang to avoid float drift) ───
        // Live Flash quote first (estimatePrice already includes the fuel
        // surcharge; upCountryAmount is the additive upcountry premium — together
        // they match Flash's real billed rate). Province-aware fallback (฿40
        // intra-Bangkok, ฿90 otherwise) only when Flash can't price the route.
        // This is applied identically in /api/orders/estimate so the displayed
        // total matches this charge and the no-overcharge guard doesn't false-trip.
        const sellerShippingSatang = new Map<string, number>();

        for (const sellerId of sellerIds) {
            const sp = sellerProfiles?.find(p => p.id === sellerId);
            // Sealed products (booster boxes, ETBs) weigh far more than cards —
            // quote off the card_data snapshots so heavy items aren't under-quoted.
            const sellerItems = listings
                .filter(l => l.seller_id === sellerId)
                .map(l => ({
                    isSealed: (l.card_data as any)?.isSealed === true,
                    productType: (l.card_data as any)?.productType ?? null,
                }));
            let baseSatang: number;
            try {
                const quote = await estimateRateWithCityFallback({
                    srcProvinceName: sp?.province || 'กรุงเทพมหานคร',
                    srcCityName: sp?.state || sp?.district || 'เขตบางรัก',
                    srcPostalCode: sp?.postcode || '10500',
                    dstProvinceName: buyerProfile?.province || 'กรุงเทพมหานคร',
                    dstCityName: buyerProfile?.state || buyerProfile?.district || 'เขตบางรัก',
                    dstPostalCode: buyerProfile?.postcode || '10110',
                    weight: estimateParcelWeightGramsForItems(sellerItems),
                    ...estimateParcelDimsCmForItems(sellerItems),
                });
                // Flash returns satang (cents) directly.
                baseSatang = quote.estimatePrice + quote.upCountryAmount;
                if (quote.usedCanonicalCity) {
                    console.warn(`[Orders/Checkout] Canonical-city retry used for seller ${sellerId} — ฿${baseSatang / 100}`);
                }
            } catch (err) {
                baseSatang = fallbackShippingSatang(sp?.province, buyerProfile?.province);
                if (isRegionError(err)) {
                    console.warn(`[Orders/Checkout] Flash region mismatch for seller ${sellerId} — fallback ฿${baseSatang / 100}`);
                } else {
                    console.error(`[Orders/Checkout] Flash estimate error for seller ${sellerId} — using fallback ฿${baseSatang / 100}:`, err);
                }
            }
            sellerShippingSatang.set(sellerId, baseSatang);
        }

        // ─── Build orders. Prices come from the DB; shipping is charged once per seller. ───
        const ordersToInsert: Record<string, unknown>[] = [];
        const shippingApplied = new Set<string>();

        for (const listing of listings) {
            const feePct = feeMap.get(listing.seller_id) || NON_PARTNER_FEE_FRACTION;

            // ─── Offer price override (server-authoritative) ───
            // When paying an accepted offer, the price is the accepted offer
            // amount from the DB — never the list price and never the client's
            // number. The offer must be `accepted`, belong to this buyer, match
            // this listing, and not already be linked to an order. platform_fee
            // recomputes off the override automatically; shipping is
            // price-independent. No reserve was taken on accept, so the
            // reservation CAS below still arbitrates the Buy-Now race.
            let priceSatang: number;
            if (acceptedOfferId) {
                const { data: offer } = await supabase
                    .from('offers')
                    .select('amount, status, buyer_id, listing_id, accepted_order_id')
                    .eq('id', acceptedOfferId)
                    .eq('listing_id', listing.id)
                    .single();
                if (!offer || offer.status !== 'accepted' || offer.buyer_id !== buyerId || offer.accepted_order_id) {
                    return NextResponse.json(
                        { error: 'Offer not payable', code: 'OFFER_NOT_PAYABLE' },
                        { status: 400 },
                    );
                }
                priceSatang = Math.round(Number(offer.amount) * 100);
            } else {
                priceSatang = Math.round(Number(listing.price) * 100);
            }

            const platformFeeSatang = Math.round(priceSatang * feePct);

            let shippingSatang = 0;
            if (!shippingApplied.has(listing.seller_id)) {
                shippingSatang = sellerShippingSatang.get(listing.seller_id)
                    ?? fallbackShippingSatang(
                        sellerProfiles?.find(p => p.id === listing.seller_id)?.province,
                        buyerProfile?.province,
                    );
                shippingApplied.add(listing.seller_id);
            }

            ordersToInsert.push({
                listing_id: listing.id,
                buyer_id: buyerId,
                seller_id: listing.seller_id,
                status: 'pending_payment',
                total_amount: priceSatang / 100,
                platform_fee: platformFeeSatang / 100,
                shipping_fee: shippingSatang / 100,
                escrow_status: 'held',
                payment_method: paymentMethod,
                transfer_group: transferGroup,
                stripe_region: orderRegion,
            });
        }

        // ─── Collector Pass SELLER fee voucher (auto-applies, no client input) ───
        // Reduces the platform fee on the seller's next sale — the buyer's
        // price never moves, so no display/guard plumbing is involved. Runs
        // BEFORE the buyer voucher so the buyer discount clamps against the
        // already-reduced fee (quote does the same, keeping totals exact).
        // Consumed alongside the buyer voucher after the guard; every failure
        // path restores both.
        let sellerVoucher: VoucherItemRow | null = null;
        let sellerVoucherShares: number[] = [];
        try {
            const cartSellerIds = [...new Set(ordersToInsert.map((o) => String(o.seller_id)))];
            if (cartSellerIds.length === 1 && (await isFeatureEnabled('rewards_vouchers'))) {
                const { data: sfRows } = await supabase
                    .from('reward_items')
                    .select('id, item_key, status, meta, expires_at')
                    .eq('user_id', cartSellerIds[0])
                    .eq('item_key', 'seller_fee_30')
                    .eq('status', 'active')
                    .order('created_at', { ascending: true })
                    .limit(1);
                const sf = ((sfRows ?? [])[0] ?? null) as VoucherItemRow | null;
                if (sf && (!sf.expires_at || Date.parse(sf.expires_at) > Date.now())) {
                    const feesNow = ordersToInsert.map((o) => Math.round(Number(o.platform_fee) * 100));
                    const totalFeeNow = feesNow.reduce((s, f) => s + f, 0);
                    const reduction = voucherDiscountSatang(Number(sf.meta?.amountSatang ?? 0), totalFeeNow);
                    if (reduction > 0) {
                        sellerVoucherShares = distributeVoucherDiscount(feesNow, reduction);
                        ordersToInsert.forEach((o, i) => {
                            o.platform_fee = (feesNow[i] - sellerVoucherShares[i]) / 100;
                        });
                        sellerVoucher = sf;
                    }
                    // reduction 0 (admin seller, zero fee): leave the voucher
                    // unconsumed for a sale where it's actually worth something.
                }
            }
        } catch {
            // Fee-voucher lookup is best-effort; a hiccup charges the normal fee.
        }

        // ─── Collector Pass BUYER voucher (before the guard, no side effects yet) ───
        // The discount comes ENTIRELY out of the platform fee: each order's
        // platform_fee drops by its share and discount_amount records what
        // comes off the buyer's charge, so the seller's proceeds
        // (total + shipping − fee) are mathematically unchanged — mandatory on
        // TH direct charges. Clamped at the cart's total fee, so our take
        // floors at zero and never goes negative.
        let voucherDiscountTotalSatang = 0;
        let voucherItem: VoucherItemRow | null = null;
        if (voucherId) {
            if (acceptedOfferId) {
                return NextResponse.json(
                    { error: 'Vouchers cannot be combined with an offer', code: 'VOUCHER_WITH_OFFER' },
                    { status: 400 },
                );
            }
            if (!(await isFeatureEnabled('rewards_vouchers'))) {
                return NextResponse.json(
                    { error: 'Vouchers are temporarily unavailable', code: 'VOUCHER_UNAVAILABLE' },
                    { status: 403 },
                );
            }
            const { data: vRow, error: vErr } = await supabase
                .from('reward_items')
                .select('id, item_key, status, meta, expires_at')
                .eq('id', voucherId)
                .eq('user_id', buyerId)
                .maybeSingle();
            const voucher = (vRow ?? null) as VoucherItemRow | null;
            const voucherType = voucher?.meta?.type;
            if (
                vErr || !voucher || voucher.status !== 'active' ||
                (voucherType !== 'order' && voucherType !== 'shipping') ||
                (voucher.expires_at && Date.parse(voucher.expires_at) <= Date.now())
            ) {
                return NextResponse.json(
                    { error: 'This voucher is no longer available', code: 'VOUCHER_INVALID' },
                    { status: 400 },
                );
            }
            const subtotalSatang = ordersToInsert.reduce(
                (sum, o) => sum + Math.round(Number(o.total_amount) * 100), 0,
            );
            if (subtotalSatang < Number(voucher.meta?.minOrderSatang ?? 0)) {
                return NextResponse.json(
                    { error: 'Order is below this voucher\'s minimum', code: 'VOUCHER_MIN_ORDER' },
                    { status: 400 },
                );
            }
            const feesSatang = ordersToInsert.map((o) => Math.round(Number(o.platform_fee) * 100));
            const totalFeeSatang = feesSatang.reduce((s, f) => s + f, 0);
            voucherDiscountTotalSatang = voucherDiscountSatang(
                Number(voucher.meta?.amountSatang ?? 0), totalFeeSatang,
            );
            if (voucherDiscountTotalSatang <= 0) {
                return NextResponse.json(
                    { error: 'This voucher cannot apply to this order', code: 'VOUCHER_NOT_APPLICABLE' },
                    { status: 400 },
                );
            }
            const shares = distributeVoucherDiscount(feesSatang, voucherDiscountTotalSatang);
            ordersToInsert.forEach((o, i) => {
                o.platform_fee = (feesSatang[i] - shares[i]) / 100;
                o.discount_amount = shares[i] / 100;
            });
            voucherItem = voucher;
        }

        // ─── No-overcharge guard (before any side effects) ───
        // Compute the authoritative total now and compare against what the buyer
        // was shown. If we'd charge MORE than displayed, reject cleanly — no
        // listings reserved, no orders created — so the buyer reviews the new
        // total instead of getting a surprise charge. A 1-satang tolerance
        // absorbs rounding. (A voucher only LOWERS the total, so it can never
        // trip this guard.)
        const computedTotalSatang = ordersToInsert.reduce(
            (sum, o) =>
                sum + Math.round(Number(o.total_amount) * 100) + Math.round(Number(o.shipping_fee) * 100)
                - Math.round(Number(o.discount_amount ?? 0) * 100),
            0,
        );
        if (expectedTotal !== null && computedTotalSatang > Math.round(expectedTotal * 100) + 1) {
            return NextResponse.json(
                {
                    error: 'Shipping was updated for this address. Please review your new total and try again.',
                    code: 'TOTAL_CHANGED',
                    total: computedTotalSatang / 100,
                },
                { status: 409 },
            );
        }

        // ─── Consume the vouchers (CAS) BEFORE any reservation. ───
        // The CAS makes a double-spend structurally impossible; every failure
        // path below restores everything consumed here. A voucher lost to a
        // crash between here and the restore is admin-recoverable
        // (reward_items keeps the transfer_group tag).
        const consumedVoucherIds: string[] = [];
        const restoreVoucher = async () => {
            for (const itemId of consumedVoucherIds) {
                try {
                    await supabase.rpc('restore_reward_item', { p_item: itemId });
                } catch (restoreErr) {
                    console.error('[Orders/Checkout] voucher restore failed:', (restoreErr as Error)?.message);
                }
            }
        };
        if (sellerVoucher) {
            const { data: consumed, error: consumeErr } = await supabase.rpc('consume_reward_item', {
                p_item: sellerVoucher.id,
                p_user: String(ordersToInsert[0].seller_id),
                p_meta_patch: { transfer_group: transferGroup },
            });
            if (consumeErr || consumed !== true) {
                // Raced away (a parallel checkout on the same seller consumed
                // it first). Add the exact shares back — precise regardless of
                // any buyer-voucher mutation that happened after them.
                ordersToInsert.forEach((o, i) => {
                    o.platform_fee = (Math.round(Number(o.platform_fee) * 100) + (sellerVoucherShares[i] ?? 0)) / 100;
                });
                sellerVoucher = null;
            } else {
                consumedVoucherIds.push(sellerVoucher.id);
            }
        }
        if (voucherItem) {
            const { data: consumed, error: consumeErr } = await supabase.rpc('consume_reward_item', {
                p_item: voucherItem.id,
                p_user: buyerId,
                p_meta_patch: { transfer_group: transferGroup },
            });
            if (consumeErr || consumed !== true) {
                await restoreVoucher();
                return NextResponse.json(
                    { error: 'This voucher was already used', code: 'VOUCHER_USED' },
                    { status: 409 },
                );
            }
            consumedVoucherIds.push(voucherItem.id);
        }

        // ─── Reserve listings via CAS on status='active' BEFORE creating orders. ───
        // If any listing was already sold by a concurrent checkout, .update returns
        // fewer rows and we abort without inserting orders.
        const { data: reserved, error: reserveErr } = await supabase
            .from('listings')
            .update({ status: 'sold' })
            .in('id', listingIds)
            .eq('status', 'active')
            .select('id');

        if (reserveErr) {
            console.error('[Orders/Checkout] Reservation update failed:', reserveErr);
            await restoreVoucher();
            return NextResponse.json({ error: 'Failed to reserve listings' }, { status: 500 });
        }

        if (!reserved || reserved.length !== listingIds.length) {
            // Roll back any partial reservation by flipping winners back to
            // active. Guard on 'sold' (the reservation state) so this can
            // never activate a row in any other state.
            const reservedIds = (reserved || []).map(r => r.id);
            if (reservedIds.length > 0) {
                await supabase.from('listings').update({ status: 'active' }).in('id', reservedIds).eq('status', 'sold');
            }
            await restoreVoucher();
            return NextResponse.json(
                { error: 'One or more listings were just sold by another buyer' },
                { status: 409 }
            );
        }

        // ─── Insert orders. If this fails, roll back the reservation. ───
        const { data: insertedOrders, error: insertErr } = await supabase
            .from('orders')
            .insert(ordersToInsert)
            .select();

        if (insertErr || !insertedOrders) {
            console.error('[Orders/Checkout] Order insert failed:', insertErr);
            // Same 'sold' guard as the partial-reservation rollback above.
            await supabase.from('listings').update({ status: 'active' }).in('id', listingIds).eq('status', 'sold');
            await restoreVoucher();
            return NextResponse.json({ error: 'Failed to create orders' }, { status: 500 });
        }

        // ─── Link the accepted offer to its order (OBO) ───
        // Stamp accepted_order_id so the offer can't be re-paid and list-my-offers
        // shows it resolved. Best-effort (non-fatal): the authoritative void of
        // the OTHER offers on this listing happens post-payment in the fulfillment
        // sweep (lib/voidOffersForListing) once the sale is confirmed. The CAS on
        // status='accepted' + accepted_order_id IS NULL keeps this idempotent.
        if (acceptedOfferId && insertedOrders?.[0]?.id) {
            await supabase
                .from('offers')
                .update({ accepted_order_id: insertedOrders[0].id })
                .eq('id', acceptedOfferId)
                .eq('status', 'accepted')
                .is('accepted_order_id', null);
        }

        // Inventory move happens post-payment in fulfillOrdersByTransferGroup.
        // It re-reads the listings table by listing_id — listings.status is now
        // 'sold' but the row is still readable.

        const totalSatang = ordersToInsert.reduce(
            (sum, o) =>
                sum + Math.round(Number(o.total_amount) * 100) + Math.round(Number(o.shipping_fee) * 100)
                - Math.round(Number(o.discount_amount ?? 0) * 100),
            0,
        );

        return NextResponse.json({
            success: true,
            transferGroup,
            orderIds: insertedOrders.map(o => o.id),
            // Single source of truth for the amount Stripe will charge.
            totalAmount: totalSatang / 100,
            totalSatang,
            discountSatang: voucherDiscountTotalSatang,
            region: orderRegion,
            message: 'Orders created with pending_payment status. Proceed to payment.',
        });
    } catch (err: any) {
        console.error('[Orders/Checkout] Error:', err);
        return NextResponse.json({ error: err.message || 'Checkout failed' }, { status: 500 });
    }
}
