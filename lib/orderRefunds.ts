/**
 * Refund and cancel paid orders, in code.
 *
 * Until 2026-11 every refund was a hand job: a Stripe dashboard refund, then
 * SQL for the order, the listing, the buyer's collection row, the sale that
 * fed internal pricing, and a chat message to each side (orders 19c2ec52,
 * 1ca10d5f, 0bc2a34b...). This module does all of it once, from three
 * callers: the buyer who gives up on an unshipped order
 * (/api/orders/cancel-unshipped), the cancel-unshipped-orders cron, and the
 * admin's Cancel and refund button (/api/admin/orders/[id]/refund).
 *
 * Money: TH orders are direct charges on the seller's connected account, so
 * the refund is created there (stripeAccount) with refund_application_fee so
 * our fee goes back too; Stripe keeps its own processing fee, which the
 * seller bears (the cost of not shipping). The dormant US path refunds the
 * platform charge. order_refunds rows are the idempotency claim: a second
 * attempt on the same order gets 409 instead of a second refund.
 *
 * Reversal mirrors lib/fulfillOrder: orders -> cancelled; and, when nothing
 * had shipped, listings back off 'sold' (to 'cancelled', not 'active': a
 * seller who never shipped may not have the card), the buyer's collection
 * row removed, the internal-pricing sale deleted, rewards clawed back, and
 * the checkout's voucher restored once every order in it is cancelled.
 */

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { getStripeForRegion, isRegionConfigured, type StripeRegion } from '@/lib/stripe';
import { buyerPaidOf } from '@/lib/orderGroups';
import { isUnshippedOrder } from '@/lib/orderDisputes';
import { restoreVouchersForTransferGroup } from '@/lib/rewards';
import { sendOrderRefundedNotification, sendOrderCancelledSellerNotification } from '@/lib/courier';

export type RefundSource = 'buyer_cancel' | 'auto_unshipped' | 'admin';

export interface RefundParams {
    orderIds: string[];
    source: RefundSource;
    /** Who asked: the buyer, the admin, or null for the cron. */
    actorId: string | null;
    note?: string | null;
    /** The money already went back through the Stripe dashboard; only record and reverse. */
    skipStripe?: boolean;
}

export type RefundResult =
    | {
          ok: true;
          orderIds: string[];
          amountThb: number;
          stripeRefundId: string | null;
          stripeStatus: string | null;
          restocked: boolean;
          recorded: boolean;
      }
    | { ok: false; status: number; code: string; error: string };

type Fail = Extract<RefundResult, { ok: false }>;
const fail = (status: number, code: string, error: string): Fail => ({ ok: false, status, code, error });

// Statuses an admin may refund from. Completed orders have released funds;
// pending ones have no money to return.
const ADMIN_REFUNDABLE = ['paid', 'processing', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'disputed'];
// Reward rules fulfilment awards at payment (app/api/admin/rewards clawback uses the same list).
const REWARD_ORDER_RULES = ['order_paid_buyer', 'order_paid_seller', 'order_settled_buyer', 'order_settled_seller'];
const CANCEL_REASON: Record<RefundSource, string> = {
    buyer_cancel: 'buyer_cancelled_unshipped',
    auto_unshipped: 'seller_unshipped_auto',
    admin: 'admin_refund',
};

interface LabelStub { tracking_number: string | null; status: string | null; handed_off_at?: string | null }
interface ListingStub { id: string; card_id: string | null; price: number | null; status: string | null; card_data: { name?: string } | null }
interface OrderRow {
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    total_amount: number | null;
    discount_amount: number | null;
    platform_fee: number | null;
    transfer_group: string | null;
    stripe_payment_intent_id: string | null;
    payment_id: string | null;
    stripe_region: string | null;
    listing_id: string | null;
    break_spot_id: string | null;
    created_at: string;
    shipping_labels: LabelStub | LabelStub[] | null;
    listing: ListingStub | ListingStub[] | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

function isMissingColumn(err: { code?: string } | null | undefined): boolean {
    return err?.code === 'PGRST204' || err?.code === '42703';
}

export async function refundAndCancelOrders(admin: SupabaseClient, p: RefundParams): Promise<RefundResult> {
    const ids = [...new Set(p.orderIds.filter((id) => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0 || ids.length > 50) return fail(400, 'NO_ORDERS', 'No orders given');

    const { data, error } = await admin
        .from('orders')
        .select(
            'id, buyer_id, seller_id, status, total_amount, discount_amount, platform_fee, transfer_group, stripe_payment_intent_id, payment_id, stripe_region, listing_id, break_spot_id, created_at, ' +
            'shipping_labels(tracking_number, status, handed_off_at), listing:listings(id, card_id, price, status, card_data)',
        )
        .in('id', ids);
    if (error) return fail(500, 'LOOKUP_FAILED', error.message);
    const orders = (data ?? []) as unknown as OrderRow[];
    if (orders.length !== ids.length) return fail(404, 'NOT_FOUND', 'Order not found');

    const buyers = new Set(orders.map((o) => o.buyer_id));
    const sellers = new Set(orders.map((o) => o.seller_id));
    const groups = new Set(orders.map((o) => o.transfer_group || `solo:${o.id}`));
    if (buyers.size !== 1 || sellers.size !== 1 || groups.size !== 1) {
        return fail(409, 'MIXED_ORDERS', 'Refund one checkout at a time');
    }
    if (orders.some((o) => o.break_spot_id)) return fail(409, 'LIVE_BREAK', 'Live-break orders are refunded from the stream');
    const unshipped = orders.every((o) => isUnshippedOrder(o, one(o.shipping_labels)));
    if (p.source !== 'admin' && !unshipped) {
        return fail(409, 'NOT_UNSHIPPED', 'This parcel has already left; report a problem with the order instead');
    }
    if (p.source === 'admin' && orders.some((o) => !ADMIN_REFUNDABLE.includes(o.status))) {
        return fail(409, 'NOT_REFUNDABLE', `Order is ${orders.find((o) => !ADMIN_REFUNDABLE.includes(o.status))!.status.replace(/_/g, ' ')}`);
    }
    const buyerId = orders[0].buyer_id;
    const sellerId = orders[0].seller_id;
    const transferGroup = orders[0].transfer_group;

    // The claim. One row per order; the primary key refuses a second attempt.
    const claimFull = orders.map((o) => ({
        order_id: o.id, note: p.note ?? null, refunded_by: p.actorId,
        status: 'processing', source: p.source, transfer_group: transferGroup,
    }));
    let recorded = true;
    let { error: claimErr } = await admin.from('order_refunds').insert(claimFull);
    if (claimErr && isMissingColumn(claimErr)) {
        recorded = false;
        ({ error: claimErr } = await admin
            .from('order_refunds')
            .insert(orders.map((o) => ({ order_id: o.id, note: p.note ?? null, refunded_by: p.actorId }))));
    }
    if (claimErr) {
        if (claimErr.code === '23505') return fail(409, 'ALREADY_REFUNDED', 'This order was already refunded');
        return fail(500, 'CLAIM_FAILED', claimErr.message);
    }
    const release = async () => { await admin.from('order_refunds').delete().in('order_id', ids); };

    // Money.
    const amountSatang = orders.reduce((sum, o) => sum + Math.round(buyerPaidOf(o) * 100), 0);
    let stripeRefundId: string | null = null;
    let stripeStatus: string | null = null;
    if (!p.skipStripe && amountSatang > 0) {
        const piId = orders
            .map((o) => o.stripe_payment_intent_id || (o.payment_id?.startsWith('pi_') ? o.payment_id : null))
            .find((v): v is string => !!v) ?? null;
        if (!piId) {
            await release();
            return fail(409, 'NO_PAYMENT_INTENT', 'No Stripe payment is recorded on this order. Refund it in the Stripe dashboard, then record it here as already refunded.');
        }
        const region: StripeRegion = orders[0].stripe_region === 'us' ? 'us' : 'th';
        if (!isRegionConfigured(region)) {
            await release();
            return fail(503, 'STRIPE_NOT_CONFIGURED', `Stripe ${region.toUpperCase()} is not configured`);
        }
        const requestOpts: { stripeAccount?: string; idempotencyKey: string } = {
            idempotencyKey: `refund_${crypto.createHash('sha1').update([...ids].sort().join(',')).digest('hex')}`,
        };
        if (region === 'th') {
            const { data: seller } = await admin
                .from('profiles')
                .select('stripe_account_id')
                .eq('id', sellerId)
                .maybeSingle<{ stripe_account_id: string | null }>();
            if (!seller?.stripe_account_id) {
                await release();
                return fail(409, 'NO_SELLER_ACCOUNT', 'The seller has no Stripe account to refund from');
            }
            requestOpts.stripeAccount = seller.stripe_account_id;
        }
        try {
            const refund = await getStripeForRegion(region).refunds.create(
                {
                    payment_intent: piId,
                    amount: amountSatang,
                    reason: 'requested_by_customer',
                    ...(region === 'th' ? { refund_application_fee: true } : {}),
                    metadata: { order_ids: ids.join(','), transfer_group: transferGroup ?? '', source: p.source },
                },
                requestOpts,
            );
            stripeRefundId = refund.id;
            stripeStatus = refund.status ?? null;
        } catch (err) {
            await release();
            const message = err instanceof Error ? err.message : String(err);
            Sentry.captureException(err, { tags: { handler: 'orderRefunds', kind: 'stripe_refund_failed' }, extra: { ids, source: p.source, piId } });
            return fail(502, 'STRIPE_REFUND_FAILED', message);
        }
    }

    // From here the money has moved (or was moved by hand): every step below
    // is best effort and loud, never a reason to stop.
    const now = new Date().toISOString();
    for (const o of orders) {
        let { error: upErr } = await admin
            .from('orders')
            .update({ status: 'cancelled', cancel_reason: CANCEL_REASON[p.source], updated_at: now })
            .eq('id', o.id)
            .eq('status', o.status);
        if (upErr && isMissingColumn(upErr)) {
            ({ error: upErr } = await admin
                .from('orders')
                .update({ status: 'cancelled', updated_at: now })
                .eq('id', o.id)
                .eq('status', o.status));
        }
        if (upErr) {
            Sentry.captureMessage('Order refunded but not cancelled', {
                level: 'error',
                tags: { handler: 'orderRefunds' },
                extra: { orderId: o.id, error: upErr.message, stripeRefundId },
            });
        }
    }

    let restocked = false;
    if (unshipped) {
        restocked = true;
        const listingIds = orders.map((o) => o.listing_id).filter((v): v is string => !!v);
        if (listingIds.length > 0) {
            const { error: lErr } = await admin
                .from('listings')
                .update({ status: 'cancelled', sold_at: null })
                .in('id', listingIds)
                .eq('status', 'sold');
            if (lErr) console.error('[OrderRefunds] listing release failed:', lErr.message);
        }
        await removeBuyerCollectionItems(admin, buyerId, orders);
        const { error: mvErr } = await admin.from('market_value_sales').delete().in('order_id', ids);
        if (mvErr && !isMissingColumn(mvErr) && mvErr.code !== '42P01') console.error('[OrderRefunds] sale delete failed:', mvErr.message);
    }

    await clawBackRewards(admin, ids, p);

    if (transferGroup) {
        const { data: siblings } = await admin.from('orders').select('id, status').eq('transfer_group', transferGroup);
        if ((siblings ?? []).every((s: { status: string }) => s.status === 'cancelled')) {
            await restoreVouchersForTransferGroup(admin, transferGroup);
        }
    }

    if (p.source !== 'admin') await recordSellerStrike(admin, sellerId);

    if (recorded) {
        const { error: recErr } = await admin
            .from('order_refunds')
            .update({
                stripe_refund_id: stripeRefundId,
                amount_satang: amountSatang,
                status: stripeRefundId ? (stripeStatus ?? 'succeeded') : (p.skipStripe ? 'manual' : 'none'),
            })
            .in('order_id', ids);
        if (recErr && !isMissingColumn(recErr)) console.error('[OrderRefunds] record update failed:', recErr.message);
    }

    const itemName = one(orders[0].listing)?.card_data?.name ?? null;
    const amountThb = amountSatang / 100;
    try {
        await sendOrderRefundedNotification(buyerId, { orderId: ids[0], amountThb, reason: p.source, itemName, itemCount: ids.length });
    } catch (e) {
        console.error('[OrderRefunds] buyer notification failed (non-fatal):', e);
    }
    try {
        await sendOrderCancelledSellerNotification(sellerId, { orderId: ids[0], amountThb, reason: p.source, itemName, itemCount: ids.length });
    } catch (e) {
        console.error('[OrderRefunds] seller notification failed (non-fatal):', e);
    }
    if (p.source !== 'admin') {
        Sentry.captureMessage(`Order refunded automatically (${p.source})`, {
            level: 'info',
            tags: { handler: 'orderRefunds', source: p.source },
            extra: { orderIds: ids, amountThb, sellerId, buyerId, stripeRefundId },
        });
    }
    console.log(`[OrderRefunds] ${ids.length} order(s) refunded ${amountThb} THB (${p.source}${stripeRefundId ? `, ${stripeRefundId}` : ''})`);
    return { ok: true, orderIds: ids, amountThb, stripeRefundId, stripeStatus, restocked, recorded };
}

/**
 * Undo fulfilment's collection insert: the buyer's row for that card at that
 * purchase price, added at or after the order. No link column exists, so the
 * match is the same fields fulfilment wrote; the earliest such row after the
 * order is the one. A stack is decremented, a single row deleted.
 */
async function removeBuyerCollectionItems(admin: SupabaseClient, buyerId: string, orders: OrderRow[]): Promise<void> {
    const { data: collections } = await admin.from('collections').select('id').eq('user_id', buyerId);
    const collectionIds = (collections ?? []).map((c: { id: string }) => c.id);
    if (collectionIds.length === 0) return;
    for (const o of orders) {
        const listing = one(o.listing);
        if (!listing?.card_id) continue;
        const since = new Date(Date.parse(o.created_at) - 10 * 60 * 1000).toISOString();
        let query = admin
            .from('collection_items')
            .select('id, quantity')
            .in('collection_id', collectionIds)
            .eq('card_id', listing.card_id)
            .gte('added_at', since)
            .order('added_at', { ascending: true })
            .limit(1);
        if (listing.price !== null && listing.price !== undefined) query = query.eq('purchase_price', listing.price);
        const { data: items, error } = await query;
        if (error) { console.error('[OrderRefunds] collection lookup failed:', error.message); continue; }
        const item = (items ?? [])[0] as { id: string; quantity: number | null } | undefined;
        if (!item) continue;
        if ((item.quantity ?? 1) > 1) {
            await admin.from('collection_items').update({ quantity: (item.quantity ?? 1) - 1 }).eq('id', item.id);
        } else {
            await admin.from('collection_items').delete().eq('id', item.id);
        }
    }
}

/** Reverse the XP and coins fulfilment awarded for these orders (reward_ledger earn rows). */
async function clawBackRewards(admin: SupabaseClient, orderIds: string[], p: RefundParams): Promise<void> {
    try {
        const { data: rows, error } = await admin
            .from('reward_ledger')
            .select('user_id, xp, coins')
            .in('ref_id', orderIds)
            .eq('entry_type', 'earn')
            .in('rule_key', REWARD_ORDER_RULES);
        if (error || !rows) return;
        const byUser = new Map<string, { xp: number; coins: number }>();
        for (const r of rows as { user_id: string; xp: number; coins: number }[]) {
            const agg = byUser.get(r.user_id) ?? { xp: 0, coins: 0 };
            agg.xp += r.xp;
            agg.coins += r.coins;
            byUser.set(r.user_id, agg);
        }
        for (const [userId, agg] of byUser) {
            if (agg.xp === 0 && agg.coins === 0) continue;
            await admin.rpc('admin_adjust_rewards', {
                p_user: userId, p_xp: -agg.xp, p_coins: -agg.coins,
                p_note: `[refund ${p.source}${p.actorId ? ` by ${p.actorId}` : ''}] orders ${orderIds.join(',')}`,
            });
        }
    } catch (e) {
        console.error('[OrderRefunds] rewards clawback failed (non-fatal):', e);
    }
}

/**
 * A refund the seller caused by not shipping is a strike. Recorded on the
 * profile (migration 20261108) for the admin to see; nothing is enforced
 * automatically yet.
 */
async function recordSellerStrike(admin: SupabaseClient, sellerId: string): Promise<void> {
    const { data, error } = await admin
        .from('profiles')
        .select('unshipped_cancel_count')
        .eq('id', sellerId)
        .maybeSingle<{ unshipped_cancel_count: number | null }>();
    if (error) return;
    const next = (data?.unshipped_cancel_count ?? 0) + 1;
    const { error: upErr } = await admin
        .from('profiles')
        .update({ unshipped_cancel_count: next, unshipped_cancelled_at: new Date().toISOString() })
        .eq('id', sellerId);
    if (upErr && !isMissingColumn(upErr)) console.error('[OrderRefunds] strike update failed:', upErr.message);
    if (!upErr && next >= 2) {
        Sentry.captureMessage(`Seller ${sellerId} has ${next} unshipped-order refunds`, {
            level: 'warning',
            tags: { handler: 'orderRefunds', kind: 'seller_strikes' },
            extra: { sellerId, count: next },
        });
    }
}
