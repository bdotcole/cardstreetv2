import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendShipReminderNotification, sendUnshippedOrderAlert } from '@/lib/courier';
import { HANDLING_DAYS, shipByDate } from '@/lib/orderDisputes';
import { groupByTransferGroup } from '@/lib/orderGroups';

/**
 * Seller ship-by reminders (every 6 hours, see vercel.json).
 *
 * A paid order promises dispatch within HANDLING_DAYS. While it sits at paid /
 * label_generated / processing, the seller gets a push (email fallback) at 24h
 * and 48h after payment, and the founder is paged at 72h so the buyer can be
 * looked after under the guarantee. One parcel = one reminder: a multi-item
 * checkout shares a transfer_group, so the group is reminded once, keyed on its
 * primary order.
 *
 * Stage bookkeeping lives on orders.ship_reminder_count (0 -> 1 -> 2 -> 3) with a
 * compare-and-set update, so overlapping runs cannot double-send. Before
 * 20260907_ship_reminders.sql runs the columns are missing (42703) and the cron
 * exits clean.
 *
 * Live-break spot orders are excluded: their parcel is consolidated at stream
 * settle and has its own lifecycle.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const AWAITING = ['paid', 'label_generated', 'processing'];
const STAGE_HOURS = [24, 48, 72] as const; // stage 1, 2, 3
const TIME_BUDGET_MS = 250_000;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminClient();
    const started = Date.now();
    const summary = { parcels: 0, reminded: 0, escalated: 0, skipped: 0, errors: 0 };

    const cutoff = new Date(Date.now() - STAGE_HOURS[0] * 3600e3).toISOString();
    const { data: rows, error } = await admin
        .from('orders')
        .select('id, seller_id, buyer_id, transfer_group, created_at, status, listing_id, ship_reminder_count, break_spot_id')
        .in('status', AWAITING)
        .is('break_spot_id', null)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(300);
    if (error) {
        if (error.code === '42703') return NextResponse.json({ ok: true, skipped: 'migration 20260907_ship_reminders.sql not applied' });
        Sentry.captureException(new Error(`ship-reminders query failed: ${error.message}`));
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const groups = groupByTransferGroup((rows || []) as any[]);
    for (const group of groups) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        summary.parcels++;
        const primary = group.reduce((a: any, b: any) => (Date.parse(a.created_at) <= Date.parse(b.created_at) ? a : b));
        const hours = (Date.now() - Date.parse(primary.created_at)) / 3600e3;
        const target = hours >= STAGE_HOURS[2] ? 3 : hours >= STAGE_HOURS[1] ? 2 : 1;
        const current = Number(primary.ship_reminder_count) || 0;
        if (current >= target) { summary.skipped++; continue; }

        // CAS on the primary order only; siblings follow without a guard.
        const now = new Date().toISOString();
        const { data: applied, error: casErr } = await admin
            .from('orders')
            .update({ ship_reminder_count: target, ship_reminder_sent_at: now })
            .eq('id', primary.id)
            .eq('ship_reminder_count', current)
            .select('id')
            .maybeSingle();
        if (casErr) { summary.errors++; continue; }
        if (!applied) { summary.skipped++; continue; }
        const siblingIds = group.map((o: any) => o.id).filter((id: string) => id !== primary.id);
        if (siblingIds.length) {
            await admin.from('orders').update({ ship_reminder_count: target, ship_reminder_sent_at: now }).in('id', siblingIds);
        }

        let itemName = '';
        if (primary.listing_id) {
            const { data: listing } = await admin.from('listings').select('card_data').eq('id', primary.listing_id).maybeSingle();
            itemName = ((listing?.card_data as { name?: string } | null)?.name ?? '').toString();
        }
        const shipBy = shipByDate(primary.created_at);

        try {
            await sendShipReminderNotification(primary.seller_id, {
                orderId: primary.id,
                itemName,
                itemCount: group.length,
                hoursSincePaid: Math.round(hours),
                stage: target,
                shipByIso: shipBy ? shipBy.toISOString() : null,
                handlingDays: HANDLING_DAYS,
            });
            summary.reminded++;
            if (target === 3) {
                const [{ data: seller }, { data: buyer }] = await Promise.all([
                    admin.from('profiles').select('username, display_name').eq('id', primary.seller_id).maybeSingle(),
                    admin.from('profiles').select('username, display_name').eq('id', primary.buyer_id).maybeSingle(),
                ]);
                await sendUnshippedOrderAlert({
                    orderId: primary.id,
                    shortId: primary.id.slice(0, 8).toUpperCase(),
                    seller: seller?.username || seller?.display_name || primary.seller_id,
                    buyer: buyer?.username || buyer?.display_name || primary.buyer_id,
                    hoursSincePaid: Math.round(hours),
                    itemName,
                });
                summary.escalated++;
            }
        } catch (e) {
            summary.errors++;
            Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { extra: { orderId: primary.id } });
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
