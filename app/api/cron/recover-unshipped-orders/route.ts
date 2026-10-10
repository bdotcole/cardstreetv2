/**
 * Safety net for orders that were paid but never labelled.
 *
 * Labels are minted when the seller presses Create label (lib/parcels), so a
 * 'paid' order with no waybill is the normal resting state of a fresh sale,
 * not a failure. This cron only steps in after PAID_GRACE_MS: for each
 * seller it mints ONE waybill per buyer covering everything that seller still
 * has unlabelled from that buyer, books the pickup, advances the orders and
 * emails the label, so a buyer is never stranded behind a seller who never
 * opened the app. The grace window is long on purpose: a buyer topping a cart
 * up to a shop minimum does so within minutes, and the seller should be the
 * one choosing what travels together.
 *
 * Mirrors the pinned cron pattern (reconcile-pending-orders): Bearer
 * CRON_SECRET, nodejs runtime, wall-clock budget, JSON summary.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { mintParcel } from '@/lib/parcels';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TIME_BUDGET_MS = 50_000;
// How long a sale may sit unlabelled before the platform mints for the seller.
const PAID_GRACE_MS = 24 * 60 * 60 * 1000;    // 24 h
// Don't chase ancient rows (already handled manually / support-resolved).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

type PaidOrder = {
    id: string;
    seller_id: string;
    buyer_id: string;
    updated_at: string;
};

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const started = Date.now();
    const summary = { parcels: 0, minted: 0, skipped: 0, errors: 0 };

    const olderThan = new Date(Date.now() - PAID_GRACE_MS).toISOString();
    const newerThan = new Date(Date.now() - MAX_AGE_MS).toISOString();

    const { data: paid, error } = await supabase
        .from('orders')
        .select('id, seller_id, buyer_id, updated_at')
        .eq('status', 'paid')
        // Live-break spot orders LIVE at 'paid' until stream settle — that is
        // their normal resting state. Their parcels consolidate per buyer per
        // lot at settle instead; a stray per-order waybill here was a real
        // production bug.
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

    // One waybill per seller per BUYER: every unlabelled order the buyer has
    // with that seller goes in the same envelope, whatever checkout it came
    // from.
    const groups = new Map<string, PaidOrder[]>();
    for (const o of paid ?? []) {
        const key = `${o.seller_id}::${o.buyer_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(o);
    }

    for (const [, orders] of groups) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        summary.parcels++;
        const sellerId = orders[0].seller_id;
        const orderIds = orders.map(o => o.id);

        try {
            // Anything already carrying a label row (real waybill, MANUAL
            // placeholder, or a fresh PENDING claim from a seller's click) is
            // being handled elsewhere. mintParcel takes over stale claims.
            const { data: labels } = await supabase
                .from('shipping_labels')
                .select('order_id, tracking_number')
                .in('order_id', orderIds);
            const handled = new Set((labels || []).filter(l => l.tracking_number && l.tracking_number !== 'PENDING').map(l => l.order_id));
            const todo = orderIds.filter(id => !handled.has(id));
            if (todo.length === 0) { summary.skipped++; continue; }

            const result = await mintParcel(supabase, { sellerId, orderIds: todo });
            if (!result.ok) {
                if (result.code === 'IN_PROGRESS' || result.code === 'ALREADY_LABELLED') { summary.skipped++; continue; }
                summary.errors++;
                console.error(`[RecoverUnshipped] seller ${sellerId}: ${result.code} — ${result.error}`);
                continue;
            }
            summary.minted += result.orderIds.length;
        } catch (e) {
            summary.errors++;
            Sentry.captureException(e, { tags: { handler: 'recover-unshipped-orders' }, extra: { orderIds } });
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
