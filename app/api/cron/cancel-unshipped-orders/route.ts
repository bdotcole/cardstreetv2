/**
 * Auto-cancel + refund for orders a seller never shipped.
 *
 * The ship-reminders cron has nagged the seller at 24/48/72h and paged the
 * inbox at 72h; the buyer could cancel from day 4. At AUTO_CANCEL_AFTER_DAYS
 * (lib/orderDisputes) this cron refunds the checkout itself through
 * lib/orderRefunds, so no buyer waits weeks for a card that is not coming
 * (orders 19c2ec52, 55d18025, 4c3cd9d9 in 2026-10/11 all did).
 *
 * "Unshipped" is the shared rule isUnshippedOrder: paid / label_generated
 * with no Flash scan of any label and no handoff. A seller who shipped and
 * forgot to tell us keeps the order by pressing Ship it myself / Shipped
 * another way, which moves it to shipped and out of this sweep.
 *
 * Two guards for the rollout: AUTO_CANCEL_UNSHIPPED_ENABLED must be 'true',
 * and only orders placed after AUTO_CANCEL_POLICY_START are swept, so the
 * parcels already in flight when the rule shipped are handled by a human.
 *
 * nodejs runtime + CRON_SECRET bearer auth, like the other crons.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedArray } from '@/lib/utils/embed';
import { AUTO_CANCEL_AFTER_DAYS, UNSHIPPED_STATUSES, isUnshippedOrder } from '@/lib/orderDisputes';
import { refundAndCancelOrders } from '@/lib/orderRefunds';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Orders placed before this were sold under the old rules; support closes
// them by hand. (Not exported: a route file may only export its handlers and
// Next's config fields, or `next build` fails.)
const AUTO_CANCEL_POLICY_START = '2026-11-09T00:00:00Z';
const TIME_BUDGET_MS = 90_000;
const MAX_GROUPS_PER_RUN = 20;

interface Row {
    id: string;
    status: string;
    created_at: string;
    transfer_group: string | null;
    break_spot_id: string | null;
    shipping_labels: unknown;
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.AUTO_CANCEL_UNSHIPPED_ENABLED !== 'true') {
        return NextResponse.json({ ok: true, skipped: 'AUTO_CANCEL_UNSHIPPED_ENABLED is not true' });
    }

    const started = Date.now();
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - AUTO_CANCEL_AFTER_DAYS * 864e5).toISOString();
    const { data, error } = await admin
        .from('orders')
        .select('id, status, created_at, transfer_group, break_spot_id, shipping_labels(tracking_number, status, handed_off_at)')
        .in('status', UNSHIPPED_STATUSES)
        .is('break_spot_id', null)
        .gte('created_at', AUTO_CANCEL_POLICY_START)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(200);
    if (error) {
        Sentry.captureException(new Error(`cancel-unshipped-orders query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // One refund per checkout: every order in the group must still be
    // unshipped, otherwise the seller shipped part of it and a human decides.
    const byGroup = new Map<string, Row[]>();
    for (const row of (data ?? []) as Row[]) {
        const key = row.transfer_group || `solo:${row.id}`;
        byGroup.set(key, [...(byGroup.get(key) || []), row]);
    }
    const summary = { groups: byGroup.size, refunded: 0, skipped: 0, failed: 0, orders: 0 };
    const failures: { orderIds: string[]; code: string; error: string }[] = [];

    let handled = 0;
    for (const [, rows] of byGroup) {
        if (Date.now() - started > TIME_BUDGET_MS || handled >= MAX_GROUPS_PER_RUN) break;
        handled++;
        const unshipped = rows.every((r) => isUnshippedOrder(r, embedArray(r.shipping_labels as any)[0] as any));
        if (!unshipped) { summary.skipped++; continue; }
        const result = await refundAndCancelOrders(admin, {
            orderIds: rows.map((r) => r.id),
            source: 'auto_unshipped',
            actorId: null,
            note: `Not shipped within ${AUTO_CANCEL_AFTER_DAYS} days of payment`,
        });
        if (result.ok) {
            summary.refunded++;
            summary.orders += result.orderIds.length;
        } else if (result.code === 'ALREADY_REFUNDED') {
            summary.skipped++;
        } else {
            summary.failed++;
            failures.push({ orderIds: rows.map((r) => r.id), code: result.code, error: result.error });
            Sentry.captureMessage(`cancel-unshipped-orders could not refund: ${result.code}`, {
                level: 'error',
                tags: { handler: 'cancel-unshipped-orders', code: result.code },
                extra: { orderIds: rows.map((r) => r.id), error: result.error },
            });
        }
    }

    return NextResponse.json({ ok: true, ...summary, failures, tookMs: Date.now() - started });
}
