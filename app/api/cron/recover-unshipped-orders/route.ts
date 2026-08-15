/**
 * Recover paid-but-unshipped orders — backstop for a Flash outage during
 * fulfillment.
 *
 * lib/fulfillOrder.ts flips orders `pending_payment -> paid` (CAS) BEFORE
 * creating the Flash Express shipment. If createShipment then throws a
 * non-region error (Flash 5xx / rate-limit — likelier under ad-driven load),
 * the order is left at `paid` with NO shipping_labels row: re-running
 * fulfillment skips it (it filters `pending_payment`), and neither
 * reconcile-shipments (tracks label_generated+) nor reconcile-pending-orders
 * (tracks pending_payment) touches it. The buyer's card settled but the parcel
 * never ships. This cron closes that gap.
 *
 * For each seller's orders stuck at `paid` past the grace window it mints one
 * Flash waybill (via the shared recoverShipmentForOrder — same code the seller
 * self-serve label route uses, which re-reads before minting and never
 * double-mints), labels every order in the group, advances them to
 * label_generated, and emails the seller their label is ready.
 *
 * Mirrors the pinned cron pattern (reconcile-pending-orders): Bearer
 * CRON_SECRET, nodejs runtime, wall-clock budget, JSON summary.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { recoverShipmentForOrder, type RecoverableOrder } from '@/lib/flashRecovery';
import { sendLabelGeneratedNotification } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
// A normal fulfillment flips paid -> label_generated within seconds. An order
// still `paid` after this long means fulfillment died after the paid-flip.
const PAID_GRACE_MS = 10 * 60 * 1000;         // 10 min
// Don't chase ancient rows (already handled manually / support-resolved).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

type PaidOrder = {
    id: string;
    seller_id: string;
    buyer_id: string;
    transfer_group: string | null;
    updated_at: string;
};

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const started = Date.now();
    const summary = { groups: 0, recovered: 0, skipped: 0, errors: 0 };

    const olderThan = new Date(Date.now() - PAID_GRACE_MS).toISOString();
    const newerThan = new Date(Date.now() - MAX_AGE_MS).toISOString();

    const { data: paid, error } = await supabase
        .from('orders')
        .select('id, seller_id, buyer_id, transfer_group, updated_at')
        .eq('status', 'paid')
        // Live-break spot orders LIVE at 'paid' until stream settle — that is
        // their normal resting state, not a stuck fulfillment. Sweeping them in
        // here minted a stray per-order Flash waybill + "label ready" email
        // (confirmed in prod); their parcels consolidate per buyer per lot at
        // settle instead. Marketplace orders have break_spot_id NULL, so this
        // filter is a no-op for the orders this cron exists to recover.
        .is('break_spot_id', null)
        .lt('updated_at', olderThan)
        .gt('updated_at', newerThan)
        .order('updated_at', { ascending: true })
        .limit(200)
        .returns<PaidOrder[]>();

    if (error) {
        Sentry.captureException(new Error(`recover-unshipped-orders query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // One waybill per seller per transfer group, matching lib/fulfillOrder.
    const groups = new Map<string, PaidOrder[]>();
    for (const o of paid ?? []) {
        const key = `${o.transfer_group ?? o.id}::${o.seller_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(o);
    }

    for (const [, orders] of groups) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        summary.groups++;
        const primary = orders[0];
        const orderIds = orders.map(o => o.id);

        try {
            // Inspect existing labels so a partial prior run (or the up-front
            // pno persist in fulfillment) is reused, never re-minted.
            const { data: labels } = await supabase
                .from('shipping_labels')
                .select('order_id, tracking_number')
                .in('order_id', orderIds);
            const real = (labels || []).find(l => l.tracking_number && l.tracking_number !== 'MANUAL');
            const hasManual = (labels || []).some(l => l.tracking_number === 'MANUAL');

            if (hasManual && !real) {
                // Region-error placeholder — deliberate manual handling; auto-
                // minting would just re-hit the same region error. Leave it.
                summary.skipped++;
                continue;
            }

            const preLabeled = new Set((labels || []).map(l => l.order_id));

            let pno: string;
            if (real) {
                pno = real.tracking_number!;
            } else {
                const rec = await recoverShipmentForOrder(supabase, primary as RecoverableOrder);
                if (!rec.ok) {
                    if (rec.reason === 'live_break_order') {
                        // Belt-and-braces: the query above filters these out,
                        // and the shared helper re-checks. Not an error.
                        summary.skipped++;
                        continue;
                    }
                    summary.errors++;
                    console.error(`[RecoverUnshipped] ${primary.id}: ${rec.reason} — ${rec.error}`);
                    continue;
                }
                pno = rec.trackingNumber;
                preLabeled.add(primary.id); // helper labeled the primary
            }

            // Ensure every order in the group carries the waybill, without
            // overwriting rows that already hold the full Flash metadata.
            const missing = orderIds.filter(id => !preLabeled.has(id));
            if (missing.length > 0) {
                const courierTrackingUrl = `https://www.flashexpress.com/fle/tracking?se=${pno}`;
                const { error: labelErr } = await supabase
                    .from('shipping_labels')
                    .upsert(
                        missing.map(id => ({
                            order_id: id,
                            tracking_number: pno,
                            carrier_name: 'Flash Express',
                            status: 'created',
                            label_url: 'N/A',
                            courier_tracking_url: courierTrackingUrl,
                        })),
                        { onConflict: 'order_id' },
                    );
                if (labelErr) {
                    summary.errors++;
                    console.error('[RecoverUnshipped] sibling label upsert:', labelErr.message);
                    continue;
                }
            }

            // Advance the group paid -> label_generated (CAS on paid, so a
            // concurrent fulfillment/label route can't be clobbered).
            const { data: flipped, error: flipErr } = await supabase
                .from('orders')
                .update({ status: 'label_generated', updated_at: new Date().toISOString() })
                .in('id', orderIds)
                .eq('status', 'paid')
                .select('id');
            if (flipErr) {
                summary.errors++;
                console.error('[RecoverUnshipped] status flip:', flipErr.message);
                continue;
            }

            summary.recovered += flipped?.length ?? 0;

            // Seller already got the "sold" notification during the paid-flip;
            // the "label ready" email is the piece fulfillment never sent. The
            // PDF is fetched on demand via /api/orders/[id]/label, so no
            // attachment here. Non-fatal.
            try {
                await sendLabelGeneratedNotification(primary.seller_id, { id: primary.id }, null);
            } catch (e) {
                console.error('[RecoverUnshipped] notify (non-fatal):', (e as Error).message);
            }
        } catch (e) {
            summary.errors++;
            Sentry.captureException(e, { tags: { handler: 'recover-unshipped-orders' }, extra: { orderIds } });
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
