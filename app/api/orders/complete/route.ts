/**
 * POST /api/orders/complete
 *
 * Called by the buyer to confirm receipt of an order. This:
 *   1. Verifies the caller is the buyer
 *   2. Verifies the order is in a confirmable state (shipped / out_for_delivery / delivered)
 *   3. Marks the order completed
 *   4. Triggers escrow release on the next release-funds cron tick by setting
 *      funds_release_at = now() (instead of waiting the full 48h since delivery).
 *      The actual stripe.transfers.create runs in the supabase/functions/release-funds
 *      edge function, which idempotently transfers from the platform to the seller's
 *      Stripe Connect account.
 *   5. Logs a warning if the seller has no Stripe Connect account so support
 *      can prompt them to onboard before the cron retries.
 *
 * Note: escrow_status is *not* flipped to 'released' here — that happens in the
 * release-funds job, atomically with the Stripe Transfer creation. Flipping it
 * here would lie about the money having moved.
 */

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { orderId, reviewScore, reviewComment } = await request.json();

        if (!orderId) {
            return NextResponse.json({ error: 'Order ID is required' }, { status: 400 });
        }

        // Verify ownership as buyer
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, listing_id, buyer_id, seller_id, status, escrow_status, total_amount, platform_fee')
            .eq('id', orderId)
            .single();

        if (orderError || !order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        if (order.buyer_id !== user.id) {
            return NextResponse.json({ error: 'Unauthorized to modify this order' }, { status: 403 });
        }

        if (!['shipped', 'out_for_delivery', 'delivered'].includes(order.status)) {
            return NextResponse.json(
                { error: 'Order is not ready to be completed' },
                { status: 400 }
            );
        }

        if (order.escrow_status !== 'held') {
            return NextResponse.json(
                { error: 'Escrow is not in a held state — payout may already be in progress' },
                { status: 400 }
            );
        }

        // Use the service-role client for the status flip + funds_release_at
        // update so we sidestep the seller-only UPDATE policy on orders. The
        // CAS guard on escrow_status='held' below makes this safe.
        const admin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Bring funds_release_at forward to now so the next release-funds cron
        // tick picks this order up. CAS on escrow_status guards against a race
        // with the cron already having released this order.
        const { data: updated, error: updateError } = await admin
            .from('orders')
            .update({
                status: 'delivered', // release-funds requires status='delivered'
                completed_at: new Date().toISOString(),
                delivered_at: new Date().toISOString(),
                funds_release_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', orderId)
            .eq('escrow_status', 'held')
            .select('id')
            .maybeSingle();

        if (updateError) throw updateError;
        if (!updated) {
            return NextResponse.json(
                { error: 'Order was already processed — refresh to see latest state' },
                { status: 409 }
            );
        }

        // Sanity-check that the seller can actually be paid out. If not, log
        // loudly so we can prompt them. The cron will keep retrying daily; the
        // moment the seller completes Connect onboarding, their payout fires.
        const { data: sellerProfile } = await admin
            .from('profiles')
            .select('stripe_account_id, stripe_payouts_enabled, display_name')
            .eq('id', order.seller_id)
            .single();

        if (!sellerProfile?.stripe_account_id) {
            console.warn(
                `[Orders/Complete] Order ${orderId} marked for payout but seller ` +
                `${order.seller_id} (${sellerProfile?.display_name || 'unknown'}) has no ` +
                `Stripe Connect account. Payout will retry once onboarding completes.`
            );
        } else if (!sellerProfile.stripe_payouts_enabled) {
            console.warn(
                `[Orders/Complete] Order ${orderId} marked for payout but seller ` +
                `${order.seller_id} has Connect account ${sellerProfile.stripe_account_id} with ` +
                `payouts_enabled=false. Payout will retry once Stripe enables payouts.`
            );
        }

        // Persist the buyer's review (a verified purchase, tied to this order).
        // One review per order — re-confirming updates it rather than duplicating.
        // The recompute_seller_rating trigger refreshes the seller's aggregate
        // profiles.rating / review_count on write.
        if (reviewScore && Number(reviewScore) >= 1 && Number(reviewScore) <= 5) {
            // Snapshot the card name via the admin client (the listing may be
            // 'sold' now, which the buyer's session client can't read under RLS).
            let itemName: string | null = null;
            if (order.listing_id) {
                const { data: listingRow } = await admin
                    .from('listings')
                    .select('card_data')
                    .eq('id', order.listing_id)
                    .maybeSingle();
                itemName = (listingRow?.card_data as { name?: string } | null)?.name ?? null;
            }

            const { error: reviewError } = await admin
                .from('reviews')
                .upsert(
                    {
                        order_id: orderId,
                        reviewer_id: user.id,
                        seller_id: order.seller_id,
                        rating: Math.round(Number(reviewScore)),
                        comment: (reviewComment || '').trim() || null,
                        item_name: itemName,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'order_id' },
                );

            // Non-fatal: a failed review must not block the delivery confirmation
            // (and the payout it triggers).
            if (reviewError) {
                console.error('[Orders/Complete] Failed to save review:', reviewError);
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Order confirmed — payout will be released on the next cron tick.',
        });

    } catch (error: any) {
        console.error('[Orders/Complete] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
