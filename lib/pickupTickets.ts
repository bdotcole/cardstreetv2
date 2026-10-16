/**
 * Cancelled courier pickups, found from Flash's own ticket list.
 *
 * A seller who books a Flash courier (lib/parcels bookPickup / mintParcel)
 * gets a pickup ticket; Flash cancels most of them (9 of the 10 booked since
 * 2026-10-04: nobody home, nothing packed) and never tells us, so
 * shipping_labels.pickup_status sat at 'scheduled' forever, the seller
 * waited for a courier who was not coming, and the order sat at
 * label_generated while ship-reminders nagged them.
 *
 * The hourly cron app/api/cron/reconcile-pickups asks Flash for the tickets
 * of every day since the earliest open booking (listPickupTickets, one
 * request per day) and decides per parcel with decidePickup below. The
 * read-only diagnostic scripts/diag-pickup-tickets.ts runs the same code
 * and prints the decisions, so the cron and the check can never disagree.
 *
 * Matching: the ticket id requestPickup returned is stored as
 * shipping_labels.pickup_id. Flash re-dispatches a cancelled booking under
 * a NEW ticket id that copies the sender fields, and the original id drops
 * out of the list, so a parcel also claims every ticket for the seller's
 * phone + postcode created after the booking. The newest such ticket is the
 * truth: cancelled (state 4) means the courier is not coming; anything else
 * means one is still booked, possibly under the re-dispatched id.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { FLASH_PICKUP_STATE_CANCELLED, type FlashPickupTicket } from '@/lib/flashExpress';
import { isRealWaybill, pickupBookedAt } from '@/lib/orderGroups';

const BANGKOK_TZ = 'Asia/Bangkok';
/** A ticket created this long before the booking we stored is still that booking (clock skew). */
export const BOOKING_MATCH_SLACK_MS = 15 * 60 * 1000;
/** Flash is asked for at most this many days per run; a longer span keeps the booking days and the latest days. */
export const MAX_TICKET_DATES = 10;

const ymdFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** The Bangkok calendar day of `ms`, as Flash's `date` field wants it (YYYY-MM-DD). */
export function bangkokYmd(ms: number): string {
    return ymdFormat.format(new Date(ms));
}

/**
 * Every Bangkok day from the earliest booking to today, oldest first. Flash
 * lists a ticket only under the day it was created, and a re-dispatch can
 * land on any later day, so the whole span is needed. Over MAX_TICKET_DATES
 * days, the booking days themselves and the most recent days win.
 */
export function ticketDatesFor(bookedAtMs: number[], nowMs: number = Date.now()): string[] {
    if (bookedAtMs.length === 0) return [];
    const dayMs = 24 * 60 * 60 * 1000;
    const today = bangkokYmd(nowMs);
    const span: string[] = [];
    for (let t = Math.min(...bookedAtMs, nowMs); ; t += dayMs) {
        const ymd = bangkokYmd(t);
        if (span[span.length - 1] !== ymd) span.push(ymd);
        if (ymd >= today || t > nowMs + dayMs) break;
    }
    if (span.length <= MAX_TICKET_DATES) return span;
    const keep = new Set<string>(bookedAtMs.map(bangkokYmd));
    for (const ymd of [...span].reverse()) {
        if (keep.size >= MAX_TICKET_DATES) break;
        keep.add(ymd);
    }
    return span.filter((ymd) => keep.has(ymd));
}

/** Digits only, with a +66 country code folded back to the leading 0 Flash echoes. */
export function normalizeThaiPhone(raw: string | null | undefined): string {
    const digits = (raw || '').replace(/\D+/g, '');
    if (digits.length === 11 && digits.startsWith('66')) return `0${digits.slice(2)}`;
    return digits;
}

export interface ScheduledParcel {
    trackingNumber: string;
    /** Every order on the waybill, earliest first (the first is the primary order the notification links to). */
    orderIds: string[];
    sellerId: string;
    sellerName: string | null;
    /** The Flash ticket id stored at booking time; null for rows booked before it was recorded. */
    pickupId: string | null;
    /** When the courier was booked (ms). */
    bookedAt: number;
    phone: string | null;
    postcode: string | null;
    /** When the seller was last told a pickup of this parcel was cancelled (ms), or null. */
    cancelledNotifiedAt: number | null;
}

export type PickupDecision =
    | { kind: 'cancelled'; ticket: FlashPickupTicket }
    | { kind: 'live'; ticket: FlashPickupTicket; redispatched: boolean }
    | { kind: 'unknown' };

/** Tickets that belong to this parcel's booking: its own id, or a later one from the same sender. */
export function ticketsForParcel(parcel: ScheduledParcel, tickets: FlashPickupTicket[]): FlashPickupTicket[] {
    const phone = normalizeThaiPhone(parcel.phone);
    const since = parcel.bookedAt - BOOKING_MATCH_SLACK_MS;
    return tickets.filter((t) => {
        if (parcel.pickupId && String(t.ticketPickupId) === parcel.pickupId) return true;
        if (!phone || normalizeThaiPhone(t.phone) !== phone) return false;
        if (parcel.postcode && t.postalCode && t.postalCode !== parcel.postcode) return false;
        return t.createdAt * 1000 >= since;
    });
}

export function decidePickup(parcel: ScheduledParcel, tickets: FlashPickupTicket[]): PickupDecision {
    const mine = ticketsForParcel(parcel, tickets);
    if (mine.length === 0) return { kind: 'unknown' };
    const latest = mine.reduce((a, b) =>
        b.createdAt > a.createdAt || (b.createdAt === a.createdAt && b.ticketPickupId > a.ticketPickupId) ? b : a,
    );
    if (latest.state === FLASH_PICKUP_STATE_CANCELLED) return { kind: 'cancelled', ticket: latest };
    return { kind: 'live', ticket: latest, redispatched: String(latest.ticketPickupId) !== parcel.pickupId };
}

interface ScheduledRow {
    order_id: string;
    tracking_number: string | null;
    status: string | null;
    pickup_id: string | null;
    pickup_status: string | null;
    updated_at: string | null;
    pickup_cancelled_notified_at: string | null;
    orders: ScheduledOrder | ScheduledOrder[] | null;
}

interface ScheduledOrder {
    id: string;
    seller_id: string;
    status: string;
    break_spot_id: string | null;
    created_at: string;
}

function one<T>(v: T | T[] | null | undefined): T | null {
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

/**
 * Parcels with a courier booked that Flash has not scanned: order still
 * label_generated, label row still 'created', pickup_status 'scheduled'.
 * One entry per waybill (its rows share the booking). Needs the
 * 20261016_pickup_cancelled.sql columns; before that migration the query
 * fails with 42703 and callers exit clean.
 */
export async function loadScheduledParcels(
    admin: SupabaseClient,
): Promise<{ parcels: ScheduledParcel[]; error: { code?: string; message: string } | null }> {
    const { data, error } = await admin
        .from('shipping_labels')
        .select('order_id, tracking_number, status, pickup_id, pickup_status, updated_at, pickup_cancelled_notified_at, orders!inner(id, seller_id, status, break_spot_id, created_at)')
        .eq('pickup_status', 'scheduled')
        .eq('orders.status', 'label_generated')
        .limit(500);
    if (error) return { parcels: [], error: { code: error.code, message: error.message } };

    const byPno = new Map<string, ScheduledRow[]>();
    for (const row of (data ?? []) as unknown as ScheduledRow[]) {
        if (!isRealWaybill(row.tracking_number)) continue;
        if (row.status && row.status !== 'created') continue;
        const order = one(row.orders);
        if (!order || order.break_spot_id) continue;
        const bucket = byPno.get(row.tracking_number);
        if (bucket) bucket.push(row);
        else byPno.set(row.tracking_number, [row]);
    }

    const sellerIds = [...new Set([...byPno.values()].map((rows) => one(rows[0].orders)!.seller_id))];
    const sellers = new Map<string, { display_name: string | null; phone_number: string | null; postcode: string | null }>();
    if (sellerIds.length > 0) {
        const { data: profiles, error: profErr } = await admin
            .from('profiles')
            .select('id, display_name, phone_number, postcode')
            .in('id', sellerIds);
        if (profErr) return { parcels: [], error: { code: profErr.code, message: profErr.message } };
        for (const p of profiles ?? []) sellers.set(p.id, p);
    }

    const parcels: ScheduledParcel[] = [];
    for (const [trackingNumber, rows] of byPno) {
        const bookedAt = pickupBookedAt(rows);
        if (bookedAt === null) continue;
        const orders = rows.map((r) => one(r.orders)!).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        const seller = sellers.get(orders[0].seller_id);
        const notified = rows
            .map((r) => Date.parse(r.pickup_cancelled_notified_at || ''))
            .filter((t) => !Number.isNaN(t));
        parcels.push({
            trackingNumber,
            orderIds: orders.map((o) => o.id),
            sellerId: orders[0].seller_id,
            sellerName: seller?.display_name ?? null,
            pickupId: rows.find((r) => r.pickup_id)?.pickup_id ?? null,
            bookedAt,
            phone: seller?.phone_number ?? null,
            postcode: seller?.postcode ?? null,
            cancelledNotifiedAt: notified.length > 0 ? Math.max(...notified) : null,
        });
    }
    parcels.sort((a, b) => a.bookedAt - b.bookedAt);
    return { parcels, error: null };
}
