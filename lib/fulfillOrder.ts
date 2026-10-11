/**
 * Shared Order Fulfillment Logic
 * 
 * Called by the Stripe webhook after payment confirmation.
 * Handles: the paid flip, inventory transfer, XP, offer voiding, internal
 * pricing, and Courier notifications. It does NOT touch Flash Express: the
 * waybill, label and pickup are created later by the seller (lib/parcels),
 * so a buyer's several checkouts can share one parcel.
 * 
 * Designed to be idempotent — if orders are already 'paid' or beyond,
 * it skips them gracefully.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import {
    sendSoldNotification,
    sendOrderConfirmationNotification,
    sendFirstTimeSaleEmail,
} from '@/lib/courier';
import { voidOffersForSoldListing } from '@/lib/voidOffersForListing';
import { recordInternalSales } from '@/lib/internalPricing';
import { awardEvent, awardFirst } from '@/lib/rewards';
import { orderXp } from '@/lib/rewardTiers';

function getAdminSupabase(): SupabaseClient {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

export interface FulfillmentResult {
    success: boolean;
    ordersUpdated: number;
    trackingNumbers: string[];
    errors: string[];
}

/**
 * Zombie-payment recovery: resurrect orders that were cancelled while their
 * async payment (PromptPay) was still settling.
 *
 * The abandoned-checkout cleanup (/api/orders/cancel, reconcile cron) can only
 * see our rows, and an in-flight PromptPay order looks identical to an
 * abandoned one (`pending_payment`, `payment_id` NULL). A buyer who paid the QR
 * and then closed the modal used to get their order cancelled seconds before
 * the money landed — the webhook then found no `pending_payment` rows and
 * silently no-opped, leaving a paid buyer with a cancelled order.
 *
 * Every caller of fulfillOrdersByTransferGroup has already verified the
 * payment SUCCEEDED (webhook event / PI retrieve), so if the group's orders
 * sit at `cancelled` with no payment stamped, the cancel lost the race and we
 * undo it: re-reserve the listing (`active → sold`) and flip the order back to
 * `pending_payment` so the normal fulfillment path picks it up.
 *
 * If the listing was re-sold to someone else in the gap, resurrection is
 * impossible — that order needs a human (refund), so page Sentry loudly
 * instead of staying silent.
 *
 * @returns true if at least one order was revived to pending_payment.
 */
async function resurrectCancelledOrders(
    supabase: SupabaseClient,
    transferGroup: string,
    paymentId: string,
): Promise<boolean> {
    const { data: zombies } = await supabase
        .from('orders')
        .select('id, listing_id')
        .eq('transfer_group', transferGroup)
        .eq('status', 'cancelled')
        .is('payment_id', null)
        .is('break_spot_id', null);

    if (!zombies || zombies.length === 0) return false;

    let revived = 0;
    for (const zombie of zombies) {
        // Take the listing reservation back. CAS on 'active' so a listing that
        // was legitimately re-sold (or delisted) in the meantime is never
        // clobbered — that case is unrecoverable here and needs a refund.
        if (zombie.listing_id) {
            const { data: reserved, error: reserveErr } = await supabase
                .from('listings')
                .update({ status: 'sold' })
                .eq('id', zombie.listing_id)
                .eq('status', 'active')
                .select('id');
            if (reserveErr || !reserved || reserved.length === 0) {
                console.error(
                    `[Fulfillment] Paid-but-cancelled order ${zombie.id} cannot be resurrected — ` +
                    `listing ${zombie.listing_id} is no longer available. Manual refund required.`
                );
                Sentry.captureMessage('Paid payment for cancelled order — listing gone, manual refund required', {
                    level: 'error',
                    tags: { handler: 'fulfill-order', kind: 'zombie_unrecoverable' },
                    extra: { orderId: zombie.id, listingId: zombie.listing_id, transferGroup, paymentId },
                });
                continue;
            }
        }

        const { data: flipped, error: flipErr } = await supabase
            .from('orders')
            .update({ status: 'pending_payment', updated_at: new Date().toISOString() })
            .eq('id', zombie.id)
            .eq('status', 'cancelled')
            .is('payment_id', null)
            .select('id');

        if (flipErr || !flipped || flipped.length === 0) {
            // Lost a race on the order row — release the reservation we just took.
            if (zombie.listing_id) {
                await supabase
                    .from('listings')
                    .update({ status: 'active' })
                    .eq('id', zombie.listing_id)
                    .eq('status', 'sold');
            }
            continue;
        }

        console.log(`[Fulfillment] Resurrected cancelled order ${zombie.id} for settled payment ${paymentId}`);
        revived++;
    }

    return revived > 0;
}

/**
 * Fulfills all orders associated with a given transfer_group.
 * 
 * Steps:
 *   1. Find orders with status 'pending_payment' matching the transfer_group
 *   2. Update them to 'paid'
 *   3. Move the sold cards into the buyer's collection
 *   4. Send Courier notifications (buyer confirmation, seller "sold")
 *
 * The Flash waybill, label and pickup are NOT created here any more: the
 * seller mints them from the app (lib/parcels), choosing which of a buyer's
 * orders ship together.
 * 
 * @param transferGroup The Stripe transfer_group linking payment to orders
 * @param paymentId The Stripe PaymentIntent ID for audit trail
 */
export async function fulfillOrdersByTransferGroup(
    transferGroup: string,
    paymentId: string
): Promise<FulfillmentResult> {
    const supabase = getAdminSupabase();
    const result: FulfillmentResult = {
        success: false,
        ordersUpdated: 0,
        trackingNumbers: [],
        errors: [],
    };

    try {
        // ─── Step 1: Find pending orders ───
        const pendingQuery = () => supabase
            .from('orders')
            // listing card_data rides along so the shipment declares the real
            // parcel weight when the order contains sealed products.
            .select('id, listing_id, buyer_id, seller_id, status, total_amount, shipping_fee, transfer_group, listing:listings(card_data)')
            .eq('transfer_group', transferGroup)
            .eq('status', 'pending_payment')
            // Defense in depth: live-break spot orders carry break_spot_id and
            // must NEVER get a per-order Flash waybill here (their parcels are
            // consolidated at stream settle). The webhook already branches on
            // the transfer_group prefix; this guard makes a mis-routed call
            // harmless. Ordinary marketplace orders have break_spot_id NULL,
            // so this filter is a no-op for them.
            .is('break_spot_id', null);

        let { data: orders, error: fetchError } = await pendingQuery();

        if (fetchError) {
            result.errors.push(`DB fetch error: ${fetchError.message}`);
            return result;
        }

        if (!orders || orders.length === 0) {
            // No pending orders: usually already fulfilled (idempotent no-op),
            // but a settled payment can also arrive AFTER the abandoned-checkout
            // cleanup cancelled the group (PromptPay pay-then-close race). Try
            // to resurrect those before giving up — see resurrectCancelledOrders.
            const revived = await resurrectCancelledOrders(supabase, transferGroup, paymentId);
            if (revived) {
                ({ data: orders, error: fetchError } = await pendingQuery());
                if (fetchError) {
                    result.errors.push(`DB refetch error: ${fetchError.message}`);
                    return result;
                }
            }
            if (!orders || orders.length === 0) {
                console.log(`[Fulfillment] No pending_payment orders for transfer_group ${transferGroup} — likely already fulfilled.`);
                result.success = true;
                return result;
            }
        }

        console.log(`[Fulfillment] Found ${orders.length} orders to fulfill for transfer_group ${transferGroup}`);

        // ─── Step 2: Atomically update orders to 'paid' (CAS guard) ───
        // The `.eq('status', 'pending_payment')` clause makes the UPDATE a
        // compare-and-swap. If a concurrent webhook delivery already flipped
        // these rows to 'paid', our UPDATE matches zero rows and we abort BEFORE
        // firing the (non-idempotent) Flash Express side effects. Without this
        // guard, the SELECT+UPDATE pair was a TOCTOU race: two parallel
        // invocations could both pass the read-side filter and both proceed to
        // create duplicate shipments, labels, pickups, and notifications.
        const orderIds = orders.map(o => o.id);
        const { data: updatedRows, error: updateError } = await supabase
            .from('orders')
            .update({
                status: 'paid',
                payment_id: paymentId,
                updated_at: new Date().toISOString(),
            })
            .in('id', orderIds)
            .eq('status', 'pending_payment')
            .select('id');

        if (updateError) {
            result.errors.push(`Failed to update orders to paid: ${updateError.message}`);
            return result;
        }

        const winningCount = updatedRows?.length ?? 0;
        if (winningCount < orderIds.length) {
            // Another worker (concurrent webhook delivery, or admin action) won
            // the CAS for at least one of these orders. Abort entirely so we
            // don't create duplicate Flash Express shipments. The winning
            // worker is responsible for fulfillment.
            console.warn(
                `[Fulfillment] CAS guard tripped: expected to flip ${orderIds.length} orders pending_payment→paid, ` +
                `only flipped ${winningCount}. Concurrent fulfillment in progress — aborting side effects for ` +
                `transfer_group ${transferGroup}.`
            );
            result.success = true;
            result.ordersUpdated = winningCount;
            return result;
        }

        result.ordersUpdated = winningCount;

        // ─── Collector Pass XP (fail-soft, exactly-once) ───
        // Awarded only on the full CAS win above, so webhook/finalize races
        // can't double-fire; the ledger's UNIQUE (user, rule, order id) makes
        // even a re-entered invocation a no-op. XP only at 'paid' — coins for
        // transactions mint at escrow release in release-funds (clawback-safe).
        try {
            for (const o of orders) {
                if (!o.buyer_id || !o.seller_id || o.buyer_id === o.seller_id) continue;
                const xp = orderXp(Number(o.total_amount) || 0);
                if (xp > 0) {
                    await awardEvent(supabase, { userId: o.buyer_id, rule: 'order_paid_buyer', ref: o.id, xp, coins: 0 });
                    await awardEvent(supabase, { userId: o.seller_id, rule: 'order_paid_seller', ref: o.id, xp, coins: 0 });
                }
                await awardFirst(supabase, o.buyer_id, 'first_purchase');
            }
        } catch (rewardErr) {
            console.warn('[Fulfillment] reward award error (non-fatal):', (rewardErr as Error)?.message);
        }

        // ─── Stamp when each listing actually sold ───
        // listings.status flips to 'sold' at CHECKOUT, as a reservation, and
        // flips back to 'active' when a checkout dies — so created_at..now on a
        // sold row measures "time until someone started a checkout", and a
        // relisted card's clock is indistinguishable from a fresh one. sold_at
        // is written HERE, on the settle, which is the only moment a sale is
        // real. Without it, "how long does a card take to sell" has no answer,
        // and the stale-listing cron has no way to learn what a normal age is.
        //
        // Fail-soft and never overwritten (sold_at IS NULL guard): a retried
        // webhook or the /api/orders/finalize fallback must not move the
        // timestamp, and an analytics column must never fail a fulfillment.
        try {
            const settledListingIds = orders
                .map(o => o.listing_id)
                .filter((v): v is string => typeof v === 'string');
            if (settledListingIds.length > 0) {
                const { error: soldAtErr } = await supabase
                    .from('listings')
                    .update({ sold_at: new Date().toISOString() })
                    .in('id', settledListingIds)
                    .is('sold_at', null);
                // 42703 = column missing (migration not applied yet) — expected,
                // quiet, by the same convention as the rewards RPCs.
                if (soldAtErr && soldAtErr.code !== '42703') {
                    console.warn('[Fulfillment] sold_at stamp failed (non-fatal):', soldAtErr.message);
                }
            }
        } catch (soldAtErr) {
            console.warn('[Fulfillment] sold_at stamp threw (non-fatal):', (soldAtErr as Error)?.message);
        }

        // ─── Feature B: record realized sales for internal pricing (dark) ───
        // Reached only on a full CAS win (the partial-win branch returned above),
        // so every `orders` row was won by this invocation and no other worker is
        // handling them. Idempotent via market_value_sales.order_id UNIQUE, so a
        // duplicate webhook / the /api/orders/finalize fallback can't double-count.
        // Flag-gated so production is untouched until launch; NEVER throws (pricing
        // must not block or roll back fulfillment).
        if (process.env.INTERNAL_PRICING_ENABLED === 'true') {
            try {
                await recordInternalSales(
                    supabase,
                    orders.map(o => ({
                        id: o.id,
                        listing_id: o.listing_id,
                        total_amount: o.total_amount,
                    })),
                );
            } catch (pricingErr) {
                console.error('[Fulfillment] Internal-pricing record error (non-fatal):', pricingErr);
                result.errors.push(`Internal pricing: ${(pricingErr as Error).message}`);
            }
        }

        // All orders in a transfer_group share a buyer; pin it now so both the
        // inventory-transfer block (below) and the seller/buyer profile lookups
        // (further down) can use it.
        const buyerId = orders[0].buyer_id;

        // ─── Inventory transfer (now post-payment, was pre-payment) ───
        // Re-read each listing by id so we move the actual sold cards into the
        // buyer's collection only after payment is confirmed. Failures here are
        // non-fatal to shipping (we'll still create the label and email) but
        // are recorded in result.errors so the order can be reconciled.
        try {
            const listingIdsForTransfer = orders
                .map(o => o.listing_id)
                .filter((v): v is string => typeof v === 'string');

            if (listingIdsForTransfer.length > 0) {
                const { data: soldListings } = await supabase
                    .from('listings')
                    .select('id, seller_id, card_id, card_data, condition, price')
                    .in('id', listingIdsForTransfer);

                if (soldListings && soldListings.length > 0) {
                    // Ensure the buyer has a destination collection.
                    const { data: existingCollections } = await supabase
                        .from('collections')
                        .select('id')
                        .eq('user_id', buyerId)
                        .limit(1);

                    let targetCollectionId: string;
                    if (!existingCollections || existingCollections.length === 0) {
                        const { data: newCollection } = await supabase
                            .from('collections')
                            .insert({ user_id: buyerId, name: 'Main Vault', include_in_portfolio: true })
                            .select('id')
                            .single();
                        targetCollectionId = newCollection!.id;
                    } else {
                        targetCollectionId = existingCollections[0].id;
                    }

                    for (const listing of soldListings) {
                        await supabase.from('collection_items').insert({
                            collection_id: targetCollectionId,
                            card_id: listing.card_id,
                            card_data: listing.card_data,
                            quantity: 1,
                            condition: listing.condition,
                            purchase_price: listing.price,
                        });

                        // Remove a matching copy from the seller's collection,
                        // if present. Deterministic by id ASC.
                        const { data: sellerItems } = await supabase
                            .from('collection_items')
                            .select('id, collections!inner(user_id)')
                            .eq('card_id', listing.card_id)
                            .eq('collections.user_id', listing.seller_id)
                            .order('id', { ascending: true })
                            .limit(1);

                        if (sellerItems && sellerItems.length > 0) {
                            await supabase.from('collection_items').delete().eq('id', sellerItems[0].id);
                        }

                        // OBO Best-Offer (Hook 1): this listing is now a confirmed
                        // sale, so void any remaining open offers on it and notify
                        // their offerors. Flag-gated (inert while offers are dark)
                        // and non-fatal. Passing null is fine — the winning offer
                        // was already stamped with accepted_order_id at checkout,
                        // and flipping it to `expired` after the order exists is
                        // harmless (the order is what matters).
                        try {
                            await voidOffersForSoldListing(listing.id, null);
                        } catch (e) {
                            console.error('[Fulfillment] voidOffers (non-fatal):', e);
                            result.errors.push(`voidOffers: ${e}`);
                        }
                    }
                }
            }
        } catch (invErr: any) {
            console.error('[Fulfillment] Inventory transfer error (non-fatal):', invErr);
            result.errors.push(`Inventory transfer error: ${invErr.message}`);
        }

        // ─── Labels are minted later, by the seller ───
        // No Flash call here. The waybill, label PDF and pickup are created
        // when the seller presses Create label in the app (lib/parcels), so
        // the seller decides which of a buyer's orders travel in one parcel
        // and nothing ever has to be cancelled at Flash. Orders rest at
        // 'paid' until then; app/api/cron/recover-unshipped-orders mints for
        // sellers who never act, after a long grace window.
        const sellerIds = [...new Set(orders.map(o => o.seller_id))];

        // ─── Step 8: Send notifications ───
        try {
            // Notify buyer
            const totalAmount = orders.reduce((sum, o) => sum + (o.total_amount || 0) + (o.shipping_fee || 0), 0);
            await sendOrderConfirmationNotification(
                buyerId,
                // The first order id, never a 'multiple' sentinel: the push
                // handler and the /orders/<id> link both land on the purchase
                // that contains it, and a non-UUID would silently deep-link
                // nowhere (which is what multi-item buyers used to get).
                { id: orders[0].id, total_amount: totalAmount },
                result.trackingNumbers
            );

            // Notify each seller
            for (const sellerId of sellerIds) {
                const sellerOrders = orders.filter(o => o.seller_id === sellerId);
                const sellerTotal = sellerOrders.reduce((sum, o) => sum + o.total_amount, 0);

                await sendSoldNotification(sellerId, { id: sellerOrders[0].id, total_amount: sellerTotal });

                // One-time onboarding email on the seller's first-ever sale.
                // Durably guarded + idempotent (profiles.first_sale_email_sent_at
                // compare-and-swap), so duplicate webhook deliveries / the
                // /finalize fallback can't double-send. Never throws.
                await sendFirstTimeSaleEmail(sellerId, { orderId: sellerOrders[0].id });
            }
        } catch (notifErr) {
            console.error('[Fulfillment] Notification error (non-fatal):', notifErr);
            result.errors.push(`Notification error: ${(notifErr as Error).message}`);
        }

        result.success = true;
        console.log(`[Fulfillment] Completed for transfer_group ${transferGroup}: ${result.ordersUpdated} orders, ${result.trackingNumbers.length} shipments`);

    } catch (err: any) {
        console.error('[Fulfillment] Fatal error:', err);
        Sentry.captureException(err, {
            tags: { handler: 'fulfill-order' },
            extra: { transferGroup, paymentId },
        });
        result.errors.push(`Fatal: ${err.message}`);
    }

    return result;
}
