/**
 * Delivery detection for parcels that do not travel under our Flash waybill:
 * the seller shipped them (lib/parcels shipSelf / handOffParcel) and gave us
 * the carrier and number. 17TRACK (lib/track17) follows the number; this
 * module registers it, folds 17TRACK's status into the order ladder the Flash
 * webhook already uses, polls as a safety net, and auto-completes parcels
 * that never produce a signal.
 *
 * Everything here fails soft: without TRACK17_API_KEY nothing is registered
 * or polled, and without the 20261108 migration the 17TRACK bookkeeping
 * columns are skipped while orders still advance.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import {
    isTrack17Configured,
    registerWithFallback,
    getTrackInfo,
    mapTrack17Status,
    deliveredAtFrom,
    TRACK17_BATCH_MAX,
    TRACK17_LIVE_STATUSES,
    type Track17Info,
} from '@/lib/track17';
import { track17CodeFor, isByHand } from '@/lib/carriers';
import { sendPackageDeliveredNotification } from '@/lib/courier';
import { AUTO_COMPLETE_AFTER_DAYS } from '@/lib/orderDisputes';

// Must match the Flash webhook and reconcile-shipments.
const STATUS_ORDER = ['pending', 'pending_payment', 'paid', 'awaiting_shipping_payment', 'label_generated', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'completed'];
const IN_FLIGHT = ['shipped', 'in_transit', 'out_for_delivery'];

/** PostgREST's two ways of saying a column in the request does not exist. */
function isMissingColumn(err: { code?: string } | null | undefined): boolean {
    return err?.code === 'PGRST204' || err?.code === '42703';
}

function one<T>(v: T | T[] | null | undefined): T | null {
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

/**
 * Register a seller-supplied number at 17TRACK and stamp the label rows.
 * Returns true when 17TRACK is following it. Never throws.
 */
export async function registerParcelTracking(
    admin: SupabaseClient,
    parcel: { trackingNumber: string | null; carrier: string | null; orderIds: string[] },
): Promise<boolean> {
    const number = (parcel.trackingNumber || '').trim();
    if (!number || isByHand(parcel.carrier) || !isTrack17Configured() || parcel.orderIds.length === 0) return false;
    try {
        const res = await registerWithFallback(number, track17CodeFor(parcel.carrier), parcel.orderIds[0]);
        if (!res.ok) {
            console.warn(`[ExternalTracking] 17TRACK refused ${number} (${parcel.carrier}): ${res.code} ${res.message}`);
            Sentry.captureMessage('17TRACK refused a seller tracking number', {
                level: 'warning',
                tags: { handler: 'externalTracking', kind: 'register_rejected' },
                extra: { number, carrier: parcel.carrier, code: res.code, message: res.message, orderIds: parcel.orderIds },
            });
            return false;
        }
        const { error } = await admin
            .from('shipping_labels')
            .update({ track17_registered_at: new Date().toISOString(), track17_carrier: res.carrier })
            .in('order_id', parcel.orderIds);
        if (error && !isMissingColumn(error)) console.error('[ExternalTracking] stamp failed:', error.message);
        return true;
    } catch (err) {
        console.error('[ExternalTracking] register failed (non-fatal):', err instanceof Error ? err.message : err);
        Sentry.captureException(err, { tags: { handler: 'externalTracking', kind: 'register_failed' }, extra: { number, carrier: parcel.carrier } });
        return false;
    }
}

interface TrackedLabelRow {
    order_id: string;
    status: string | null;
    handoff_tracking_number: string | null;
    orders: { id: string; status: string; buyer_id: string } | { id: string; status: string; buyer_id: string }[] | null;
}

/**
 * Fold one 17TRACK status into every order travelling under that number.
 * Forward-only CAS on each order, exactly like the Flash webhook; delivered
 * sets delivered_at (the carrier's time) and the 48h funds window and sends
 * the one delivered push per parcel. Returns how many orders moved.
 */
export async function applyTrackingInfo(admin: SupabaseClient, info: Track17Info): Promise<{ matched: number; advanced: number }> {
    const number = (info.number || '').trim();
    if (!number) return { matched: 0, advanced: 0 };

    const { data, error } = await admin
        .from('shipping_labels')
        .select('order_id, status, handoff_tracking_number, orders!inner(id, status, buyer_id)')
        .eq('handoff_tracking_number', number)
        .not('handed_off_at', 'is', null);
    if (error) {
        Sentry.captureException(new Error(`externalTracking lookup failed: ${error.message}`), { extra: { number } });
        return { matched: 0, advanced: 0 };
    }
    const labels = (data ?? []) as unknown as TrackedLabelRow[];
    if (labels.length === 0) return { matched: 0, advanced: 0 };

    const status = info.track_info?.latest_status?.status ?? null;
    const subStatus = info.track_info?.latest_status?.sub_status ?? null;
    const { labelStatus, orderStatus, attention } = mapTrack17Status(status, subStatus);
    const now = new Date().toISOString();

    // Bookkeeping first, so a poll that finds nothing new still records when
    // we last heard from the carrier. The label status mirrors Flash's values.
    const stamp: Record<string, unknown> = { track17_status: status, track17_checked_at: now, updated_at: now };
    if (labelStatus) stamp.status = labelStatus;
    let { error: stampErr } = await admin.from('shipping_labels').update(stamp).eq('handoff_tracking_number', number);
    if (stampErr && isMissingColumn(stampErr)) {
        ({ error: stampErr } = await admin
            .from('shipping_labels')
            .update(labelStatus ? { status: labelStatus, updated_at: now } : { updated_at: now })
            .eq('handoff_tracking_number', number));
    }
    if (stampErr) console.error('[ExternalTracking] label update failed:', stampErr.message);

    if (attention && labels.some((l) => l.status !== 'failed')) {
        Sentry.captureMessage(`Carrier reports a problem with seller-shipped parcel ${number}: ${status}/${subStatus ?? ''}`, {
            level: 'warning',
            tags: { handler: 'externalTracking', kind: 'carrier_exception' },
            extra: { number, status, subStatus, orderIds: labels.map((l) => l.order_id) },
        });
    }

    if (!orderStatus) return { matched: labels.length, advanced: 0 };
    const newIdx = STATUS_ORDER.indexOf(orderStatus);
    let advanced = 0;
    let notified = false;
    for (const label of labels) {
        const order = one(label.orders);
        if (!order) continue;
        const currentIdx = STATUS_ORDER.indexOf(order.status);
        if (currentIdx < 0 || newIdx <= currentIdx) continue;

        const update: Record<string, unknown> = { status: orderStatus, updated_at: now };
        if (orderStatus === 'delivered') {
            const carrierTime = Date.parse(deliveredAtFrom(info) || '');
            update.delivered_at = Number.isFinite(carrierTime) ? new Date(carrierTime).toISOString() : now;
            update.funds_release_at = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
        }
        const { data: applied, error: upErr } = await admin
            .from('orders')
            .update(update)
            .eq('id', order.id)
            .eq('status', order.status)
            .select('id');
        if (upErr) {
            Sentry.captureException(new Error(`externalTracking order update failed: ${upErr.message}`), { extra: { orderId: order.id, orderStatus } });
            continue;
        }
        if (!applied || applied.length === 0) continue;
        advanced++;
        console.log(`[ExternalTracking] Order ${order.id}: ${order.status} -> ${orderStatus} (${number})`);
        if (orderStatus === 'delivered' && !notified) {
            notified = true;
            try {
                await sendPackageDeliveredNotification(order.buyer_id, order.id, number);
            } catch (e) {
                console.error('[ExternalTracking] delivered notification failed (non-fatal):', e);
            }
        }
    }
    return { matched: labels.length, advanced };
}

interface PollRow {
    order_id: string;
    handoff_tracking_number: string | null;
    handoff_carrier: string | null;
    track17_registered_at?: string | null;
    track17_carrier?: number | null;
    orders: { id: string; status: string } | { id: string; status: string }[] | null;
}

/**
 * Safety net for missed webhooks: ask 17TRACK about every in-flight parcel
 * the seller shipped themselves, registering any number that predates the
 * API key. Bounded by `deadlineMs` (epoch ms); overflow waits for next run.
 */
export async function pollExternalTracking(
    admin: SupabaseClient,
    deadlineMs: number,
): Promise<{ polled: number; registered: number; advanced: number; errors: number }> {
    const summary = { polled: 0, registered: 0, advanced: 0, errors: 0 };
    if (!isTrack17Configured()) return summary;

    const select = (cols: string) => admin
        .from('shipping_labels')
        .select(`order_id, handoff_tracking_number, handoff_carrier, ${cols}orders!inner(id, status)`)
        .not('handed_off_at', 'is', null)
        .not('handoff_tracking_number', 'is', null)
        .in('orders.status', IN_FLIGHT)
        .limit(400);
    let hasColumns = true;
    let { data, error } = await select('track17_registered_at, track17_carrier, ');
    if (error && isMissingColumn(error)) {
        hasColumns = false;
        ({ data, error } = await select(''));
    }
    if (error) {
        summary.errors++;
        Sentry.captureException(new Error(`pollExternalTracking query failed: ${error.message}`));
        return summary;
    }

    // One parcel, many orders: dedupe on the number.
    const byNumber = new Map<string, PollRow[]>();
    for (const row of (data ?? []) as unknown as PollRow[]) {
        const n = (row.handoff_tracking_number || '').trim();
        if (!n || isByHand(row.handoff_carrier)) continue;
        byNumber.set(n, [...(byNumber.get(n) || []), row]);
    }

    // Numbers never registered (handoffs made before the key existed, or a
    // register call that failed): registering twice is free, so when the
    // bookkeeping columns are missing we simply register everything.
    const toRegister = [...byNumber.entries()].filter(([, rows]) => !hasColumns || rows.every((r) => !r.track17_registered_at));
    for (const [number, rows] of toRegister) {
        if (Date.now() > deadlineMs) return summary;
        const ok = await registerParcelTracking(admin, {
            trackingNumber: number,
            carrier: rows[0].handoff_carrier,
            orderIds: rows.map((r) => r.order_id),
        });
        if (ok) summary.registered++;
    }

    const items = [...byNumber.entries()].map(([number, rows]) => ({
        number,
        carrier: rows.find((r) => r.track17_carrier)?.track17_carrier ?? track17CodeFor(rows[0].handoff_carrier),
    }));
    for (let i = 0; i < items.length; i += TRACK17_BATCH_MAX) {
        if (Date.now() > deadlineMs) break;
        const batch = items.slice(i, i + TRACK17_BATCH_MAX);
        try {
            const res = await getTrackInfo(batch);
            for (const info of res.accepted) {
                summary.polled++;
                const r = await applyTrackingInfo(admin, info);
                summary.advanced += r.advanced;
            }
            for (const rej of res.rejected) {
                console.warn(`[ExternalTracking] gettrackinfo rejected ${rej.number}: ${rej.error?.code} ${rej.error?.message}`);
            }
        } catch (err) {
            summary.errors++;
            console.error('[ExternalTracking] poll batch failed:', err instanceof Error ? err.message : err);
        }
    }
    return summary;
}

interface StaleRow {
    id: string;
    status: string;
    buyer_id: string;
    updated_at: string;
    shipping_labels: { handed_off_at: string | null; track17_status?: string | null } | { handed_off_at: string | null; track17_status?: string | null }[] | null;
}

/**
 * A parcel the seller shipped themselves that has produced no signal for
 * AUTO_COMPLETE_AFTER_DAYS (no carrier status, no buyer confirm, no report)
 * is treated as delivered: status 'delivered' with funds_release_at now, so
 * the hourly release-funds job completes it. No push to the buyer, since
 * nobody saw it arrive; they had the whole window to report it missing.
 * Parcels whose carrier is still reporting movement are left alone.
 */
export async function autoCompleteStaleHandoffs(admin: SupabaseClient): Promise<{ checked: number; completed: number }> {
    const summary = { checked: 0, completed: 0 };
    const cutoff = new Date(Date.now() - AUTO_COMPLETE_AFTER_DAYS * 864e5).toISOString();
    const select = (cols: string) => admin
        .from('orders')
        .select(`id, status, buyer_id, updated_at, shipping_labels!inner(handed_off_at${cols})`)
        .in('status', IN_FLIGHT)
        .lt('updated_at', cutoff)
        .not('shipping_labels.handed_off_at', 'is', null)
        .limit(200);
    let { data, error } = await select(', track17_status');
    if (error && isMissingColumn(error)) ({ data, error } = await select(''));
    if (error) {
        Sentry.captureException(new Error(`autoCompleteStaleHandoffs query failed: ${error.message}`));
        return summary;
    }
    const now = new Date().toISOString();
    for (const row of (data ?? []) as unknown as StaleRow[]) {
        summary.checked++;
        const label = one(row.shipping_labels);
        if (!label?.handed_off_at) continue;
        if (label.track17_status && TRACK17_LIVE_STATUSES.has(label.track17_status)) continue;
        const { data: applied, error: upErr } = await admin
            .from('orders')
            .update({ status: 'delivered', delivered_at: now, funds_release_at: now, updated_at: now })
            .eq('id', row.id)
            .eq('status', row.status)
            .select('id');
        if (upErr) {
            Sentry.captureException(new Error(`autoCompleteStaleHandoffs update failed: ${upErr.message}`), { extra: { orderId: row.id } });
            continue;
        }
        if (applied && applied.length > 0) {
            summary.completed++;
            console.log(`[ExternalTracking] Order ${row.id} auto-completed after ${AUTO_COMPLETE_AFTER_DAYS} days without a signal`);
        }
    }
    return summary;
}
