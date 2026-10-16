/**
 * Pickup reconciliation cron: finds courier pickups Flash cancelled.
 *
 * Flash never pushes a pickup cancellation, so a booked courier who is not
 * coming looked exactly like one on the way: pickup_status 'scheduled', the
 * parcel never scanned, the order parked at label_generated while
 * ship-reminders nagged the seller and paged the founder at 72h (three such
 * orders on 2026-10-16 alone). Every hour this route asks Flash for its own
 * pickup tickets (one request per day since the earliest open booking) and,
 * for each parcel whose newest matching ticket is cancelled, flips the label
 * rows to pickup_status 'cancelled' and tells the seller once per booking:
 * book again, or drop the parcel at a Flash branch. The parcel card reads
 * the flipped status and offers Book again without the 6h rebook wait.
 * A booking Flash re-dispatched under a new ticket id is still live; the new
 * id is stored so the next run matches it directly.
 *
 * Decisions come from lib/pickupTickets, which scripts/diag-pickup-tickets.ts
 * runs read-only against the same rows. nodejs runtime + CRON_SECRET bearer
 * auth, matching the other crons. Fails soft until
 * 20261016_pickup_cancelled.sql is applied.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { listPickupTickets, type FlashPickupTicket } from '@/lib/flashExpress';
import { decidePickup, loadScheduledParcels, ticketDatesFor } from '@/lib/pickupTickets';
import { sendPickupCancelledNotification } from '@/lib/courier';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const started = Date.now();
    const summary = { parcels: 0, dates: 0, tickets: 0, live: 0, redispatched: 0, cancelled: 0, notified: 0, unmatched: 0, errors: 0 };

    const { parcels, error } = await loadScheduledParcels(admin);
    if (error) {
        if (error.code === '42703') {
            return NextResponse.json({ ok: true, skipped: 'migration 20261016_pickup_cancelled.sql not applied' });
        }
        Sentry.captureException(new Error(`reconcile-pickups query failed: ${error.message}`));
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    summary.parcels = parcels.length;
    if (parcels.length === 0) return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });

    // One Flash request per day. A day that fails to load could hide the
    // re-dispatch that keeps a booking alive, so a failed fetch ends the run
    // before any parcel is judged: a false "cancelled" would send the seller
    // to a branch while a courier is on the way.
    const dates = ticketDatesFor(parcels.map((p) => p.bookedAt));
    const tickets: FlashPickupTicket[] = [];
    for (const date of dates) {
        try {
            tickets.push(...(await listPickupTickets(date)));
            summary.dates++;
        } catch (err) {
            summary.errors++;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[ReconcilePickups] Flash ticket list failed for ${date}:`, message);
            Sentry.captureMessage(`reconcile-pickups: Flash ticket list failed for ${date}`, {
                level: 'warning',
                extra: { date, message, parcels: parcels.length },
            });
            return NextResponse.json({ ok: false, ...summary, failedDate: date, tookMs: Date.now() - started }, { status: 502 });
        }
    }
    summary.tickets = tickets.length;

    for (const parcel of parcels) {
        const decision = decidePickup(parcel, tickets);
        const pno = parcel.trackingNumber;

        if (decision.kind === 'unknown') {
            summary.unmatched++;
            continue;
        }

        if (decision.kind === 'live') {
            if (!decision.redispatched) { summary.live++; continue; }
            // Flash moved the booking to a new ticket; remember it, but keep
            // updated_at (the booking time the rebook window runs from).
            const { error: idErr } = await admin
                .from('shipping_labels')
                .update({ pickup_id: String(decision.ticket.ticketPickupId) })
                .eq('tracking_number', pno)
                .eq('pickup_status', 'scheduled');
            if (idErr) { summary.errors++; console.error(`[ReconcilePickups] pickup_id update failed for ${pno}:`, idErr.message); }
            else summary.redispatched++;
            continue;
        }

        // CAS on 'scheduled': a concurrent run, or the seller rebooking in
        // between, changes the status first and this run then neither flips
        // nor notifies.
        const now = new Date().toISOString();
        const { data: flipped, error: flipErr } = await admin
            .from('shipping_labels')
            .update({ pickup_status: 'cancelled', pickup_cancelled_at: now })
            .eq('tracking_number', pno)
            .eq('pickup_status', 'scheduled')
            .select('order_id');
        if (flipErr) {
            summary.errors++;
            Sentry.captureException(new Error(`reconcile-pickups flip failed: ${flipErr.message}`), { extra: { pno } });
            continue;
        }
        if (!flipped || flipped.length === 0) continue;
        summary.cancelled++;
        console.log(`[ReconcilePickups] Pickup cancelled for ${pno} (ticket ${decision.ticket.ticketPickupId}, seller ${parcel.sellerId}, ${flipped.length} order(s))`);

        // Once per booking: a seller who rebooks after a cancellation and
        // gets cancelled again is told again; overlapping runs are not.
        const alreadyTold = parcel.cancelledNotifiedAt !== null && parcel.cancelledNotifiedAt >= parcel.bookedAt;
        if (alreadyTold) continue;
        try {
            const sent = await sendPickupCancelledNotification(parcel.sellerId, {
                id: parcel.orderIds[0],
                trackingNumber: pno,
                itemCount: parcel.orderIds.length,
            });
            if (sent) {
                summary.notified++;
                await admin
                    .from('shipping_labels')
                    .update({ pickup_cancelled_notified_at: new Date().toISOString() })
                    .eq('tracking_number', pno);
            }
        } catch (err) {
            summary.errors++;
            console.error(`[ReconcilePickups] Notification failed for ${pno} (non-fatal):`, err instanceof Error ? err.message : err);
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
