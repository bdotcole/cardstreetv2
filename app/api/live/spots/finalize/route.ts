/**
 * POST /api/live/spots/finalize — after the existing /api/checkout +
 * PaymentModal rail succeeds, verify the PaymentIntent and flip the spots.
 *
 * Mirrors app/api/orders/finalize: verify the PI succeeded ON THE CORRECT
 * platform (TH direct charges live on the seller's connected account), CAS
 * the orders pending_payment -> paid, then finalize_break_spot per spot and
 * announce each sale in chat. NOT the general fulfillment path — spot orders
 * must not get per-order Flash shipments; that happens consolidated at settle.
 *
 * Idempotent: the order CAS decides who announces; finalize_break_spot is
 * CAS-guarded in SQL; a re-run after full success is a no-op success.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeForRegion, type StripeRegion } from '@/lib/stripe';
import { postSystemChat } from '@/lib/liveBreaks';

interface SpotOrderRow {
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    stripe_region: string | null;
    break_spot_id: string;
}

export async function POST(req: Request) {
    try {
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const body = await req.json().catch(() => ({}));
        const transferGroup = typeof body?.transferGroup === 'string' ? body.transferGroup : null;
        const paymentIntentId = typeof body?.paymentIntentId === 'string' ? body.paymentIntentId : null;
        if (!transferGroup || !paymentIntentId) {
            return NextResponse.json(
                { error: 'transferGroup and paymentIntentId are required' },
                { status: 400 },
            );
        }

        const admin = createAdminClient();

        // Only spot orders — this route must never touch listing orders even
        // if handed a marketplace transfer_group.
        const { data: orders } = await admin
            .from('orders')
            .select('id, buyer_id, seller_id, status, stripe_region, break_spot_id')
            .eq('transfer_group', transferGroup)
            .not('break_spot_id', 'is', null)
            .returns<SpotOrderRow[]>();

        if (!orders || orders.length === 0) {
            return NextResponse.json(
                { error: 'No spot orders found for this transfer_group' },
                { status: 404 },
            );
        }
        if (!orders.every(o => o.buyer_id === user.id)) {
            return NextResponse.json(
                { error: 'You are not the buyer for these orders' },
                { status: 403 },
            );
        }

        // ─── Verify the PaymentIntent on the platform that charged it ───
        const region: StripeRegion = orders[0].stripe_region === 'th' ? 'th' : 'us';
        const stripe = getStripeForRegion(region);

        let lookupOptions: { stripeAccount?: string } | undefined;
        if (region === 'th') {
            const { data: seller } = await admin
                .from('profiles')
                .select('stripe_account_id')
                .eq('id', orders[0].seller_id)
                .single<{ stripe_account_id: string | null }>();
            if (seller?.stripe_account_id) {
                lookupOptions = { stripeAccount: seller.stripe_account_id };
            }
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, lookupOptions);

        if (paymentIntent.status !== 'succeeded') {
            return NextResponse.json(
                { error: `Payment is not complete (status: ${paymentIntent.status})` },
                { status: 400 },
            );
        }
        if (paymentIntent.transfer_group !== transferGroup) {
            return NextResponse.json(
                { error: 'PaymentIntent transfer_group does not match' },
                { status: 400 },
            );
        }

        // ─── CAS flip: only rows still pending become paid ───
        const orderIds = orders.map(o => o.id);
        const { data: newlyPaid, error: flipErr } = await admin
            .from('orders')
            .update({
                status: 'paid',
                payment_id: paymentIntentId,
                updated_at: new Date().toISOString(),
            })
            .in('id', orderIds)
            .eq('status', 'pending_payment')
            .select('id, break_spot_id')
            .returns<{ id: string; break_spot_id: string }[]>();

        if (flipErr) {
            console.error('[Live/SpotsFinalize] order flip failed:', flipErr.message);
            return NextResponse.json({ error: 'Failed to finalize orders' }, { status: 500 });
        }

        // ─── held -> sold, for every order (the RPC is idempotent) ───
        const finalizeErrors: string[] = [];
        for (const order of orders) {
            const { data, error } = await admin.rpc('finalize_break_spot', {
                p_spot_id: order.break_spot_id,
                p_buyer_id: user.id,
                p_order_id: order.id,
            });
            if (error) {
                finalizeErrors.push(`${order.break_spot_id}: ${error.message}`);
            } else if ((data as { finalized?: boolean } | null)?.finalized !== true) {
                // Hold lapsed and someone else took the spot — money is
                // captured for a spot the buyer no longer holds. Surface loudly
                // for ops; refund is a manual path for the beta.
                finalizeErrors.push(`${order.break_spot_id}: not finalized (hold lost?)`);
            }
        }
        if (finalizeErrors.length > 0) {
            console.error('[Live/SpotsFinalize] finalize_break_spot issues:', finalizeErrors);
        }

        // ─── Announce newly sold spots (once, via the CAS winners) ───
        const newlyPaidRows = newlyPaid ?? [];
        if (newlyPaidRows.length > 0) {
            const spotIds = newlyPaidRows.map(o => o.break_spot_id);
            const [{ data: spots }, { data: buyerProfile }] = await Promise.all([
                admin
                    .from('break_spots')
                    .select('id, stream_id, spot_number')
                    .in('id', spotIds)
                    .returns<{ id: string; stream_id: string; spot_number: number }[]>(),
                admin
                    .from('profiles')
                    .select('display_name')
                    .eq('id', user.id)
                    .maybeSingle<{ display_name: string | null }>(),
            ]);
            const buyerName = buyerProfile?.display_name || 'buyer';
            for (const spot of spots ?? []) {
                await postSystemChat(
                    spot.stream_id,
                    orders[0].seller_id,
                    `Spot ${spot.spot_number} -> @${buyerName}`,
                );
            }
        }

        return NextResponse.json({
            success: finalizeErrors.length === 0,
            ordersPaid: newlyPaidRows.length,
            alreadyPaid: orders.length - newlyPaidRows.length,
            errors: finalizeErrors,
        });
    } catch (err: any) {
        console.error('[Live/SpotsFinalize] error:', err);
        return NextResponse.json(
            { error: err.message || 'Failed to finalize spots' },
            { status: 500 },
        );
    }
}
