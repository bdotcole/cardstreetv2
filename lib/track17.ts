/**
 * 17TRACK tracking API (https://api.17track.net/en/doc, v2.4) — follows a
 * parcel number WE did not mint: the seller shipped with Kerry, J&T, Thailand
 * Post, or walked into a Flash counter that keyed its own waybill. Flash's
 * merchant API refuses such numbers (code 1019), so without this an order a
 * seller shipped themselves only ever moved when the buyer pressed Confirm.
 *
 * Billing: one quota per REGISTERED number, updates are free, so a parcel is
 * registered once (lib/externalTracking) and then pushed to our webhook
 * (app/api/webhooks/track17) or polled by reconcile-shipments. New accounts
 * get 200 free registrations; Cardstreet ships ~35 parcels a month.
 *
 * Server only. Everything fails soft when TRACK17_API_KEY is unset: the
 * seller's number is still stored and shown, it just is not followed.
 */

import crypto from 'node:crypto';

const BASE_URL = 'https://api.17track.net/track/v2.4';

/** Max numbers per register / gettrackinfo call, per the docs. */
export const TRACK17_BATCH_MAX = 40;

export const TRACK17_ALREADY_REGISTERED = -18019901;
export const TRACK17_CARRIER_NOT_DETECTED = -18019903;
export const TRACK17_CARRIER_INCORRECT = -18019910;
export const TRACK17_QUOTA_EXHAUSTED = -18019908;

export function isTrack17Configured(): boolean {
    return !!process.env.TRACK17_API_KEY?.trim();
}

function apiKey(): string {
    const key = process.env.TRACK17_API_KEY?.trim();
    if (!key) throw new Error('[Track17] TRACK17_API_KEY is not set');
    return key;
}

async function call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', '17token': apiKey() },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: { code?: number; data?: T } | null = null;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!res.ok) throw new Error(`[Track17] ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
    if (!json || typeof json.code !== 'number') throw new Error(`[Track17] ${path}: unexpected response ${text.slice(0, 300)}`);
    if (json.code !== 0) throw new Error(`[Track17] ${path}: code ${json.code}`);
    return json.data as T;
}

export interface Track17Rejected {
    number: string;
    carrier: number;
    error: { code: number; message: string };
}

export interface Track17RegisterItem {
    number: string;
    /** 17TRACK carrier key; omit to let 17TRACK detect the carrier. */
    carrier?: number | null;
    /** Free label stored on the tracking (we use the order id). */
    tag?: string;
}

export interface Track17RegisterResult {
    accepted: { number: string; carrier: number; origin?: number }[];
    rejected: Track17Rejected[];
}

export async function registerTracking(items: Track17RegisterItem[]): Promise<Track17RegisterResult> {
    const body = items.slice(0, TRACK17_BATCH_MAX).map((i) => ({
        number: i.number,
        ...(i.carrier ? { carrier: i.carrier } : {}),
        ...(i.tag ? { tag: i.tag.slice(0, 100) } : {}),
    }));
    const data = await call<Track17RegisterResult>('register', body);
    return { accepted: data?.accepted ?? [], rejected: data?.rejected ?? [] };
}

/**
 * Register one number: with the carrier we believe it belongs to, then once
 * more letting 17TRACK detect the carrier if ours is refused. A number that is
 * already registered counts as success (the quota was spent before).
 */
export async function registerWithFallback(
    number: string,
    carrier: number | null,
    tag?: string,
): Promise<{ ok: true; carrier: number | null } | { ok: false; code: number | null; message: string }> {
    const first = await registerTracking([{ number, carrier, tag }]);
    if (first.accepted.length > 0) return { ok: true, carrier: first.accepted[0].carrier ?? carrier };
    const rej = first.rejected[0];
    const code = rej?.error?.code ?? null;
    if (code === TRACK17_ALREADY_REGISTERED) return { ok: true, carrier };
    if (carrier && (code === TRACK17_CARRIER_INCORRECT || code === TRACK17_CARRIER_NOT_DETECTED)) {
        const second = await registerTracking([{ number, tag }]);
        if (second.accepted.length > 0) return { ok: true, carrier: second.accepted[0].carrier ?? null };
        const rej2 = second.rejected[0];
        if (rej2?.error?.code === TRACK17_ALREADY_REGISTERED) return { ok: true, carrier: null };
        return { ok: false, code: rej2?.error?.code ?? null, message: rej2?.error?.message ?? 'rejected' };
    }
    return { ok: false, code, message: rej?.error?.message ?? 'rejected' };
}

export type Track17Status =
    | 'NotFound' | 'InfoReceived' | 'InTransit' | 'Expired' | 'AvailableForPickup'
    | 'OutForDelivery' | 'DeliveryFailure' | 'Delivered' | 'Exception';

export interface Track17Event {
    time_iso?: string | null;
    time_utc?: string | null;
    description?: string | null;
    location?: string | null;
    stage?: string | null;
    sub_status?: string | null;
}

export interface Track17Info {
    number: string;
    carrier: number;
    tag?: string | null;
    track_info?: {
        latest_status?: { status?: Track17Status | string; sub_status?: string | null } | null;
        latest_event?: Track17Event | null;
        milestone?: { key_stage?: string; time_iso?: string | null; time_utc?: string | null }[] | null;
        tracking?: { providers?: { events?: Track17Event[] | null }[] | null } | null;
    } | null;
}

export async function getTrackInfo(items: { number: string; carrier?: number | null }[]): Promise<{ accepted: Track17Info[]; rejected: Track17Rejected[] }> {
    const body = items.slice(0, TRACK17_BATCH_MAX).map((i) => ({ number: i.number, ...(i.carrier ? { carrier: i.carrier } : {}) }));
    const data = await call<{ accepted?: Track17Info[]; rejected?: Track17Rejected[] }>('gettrackinfo', body);
    return { accepted: data?.accepted ?? [], rejected: data?.rejected ?? [] };
}

/**
 * Webhook signature: SHA-256 hex of the RAW request body + "/" + the API key
 * (header `sign`). Hash the bytes as received; re-serialised JSON differs.
 */
export function verifyTrack17Signature(rawBody: string, sign: string | null | undefined): boolean {
    if (!sign || !isTrack17Configured()) return false;
    const expected = crypto.createHash('sha256').update(rawBody + '/' + apiKey(), 'utf8').digest('hex');
    const a = Buffer.from(expected.toLowerCase(), 'utf8');
    const b = Buffer.from(sign.trim().toLowerCase(), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 17TRACK's nine statuses onto our shipping_labels.status / orders.status
 * ladder (the same values lib/flashExpress mapFlashStateToStatus writes).
 * `attention` marks a parcel a human should look at (returned, failed);
 * nothing on the order moves for those.
 */
export function mapTrack17Status(
    status: string | null | undefined,
    subStatus?: string | null,
): { labelStatus: string | null; orderStatus: string | null; attention: boolean } {
    switch (status) {
        case 'Delivered':
            return { labelStatus: 'delivered', orderStatus: 'delivered', attention: false };
        case 'OutForDelivery':
        case 'AvailableForPickup':
            return { labelStatus: 'out_for_delivery', orderStatus: 'out_for_delivery', attention: false };
        case 'InTransit':
            return { labelStatus: 'in_transit', orderStatus: 'in_transit', attention: false };
        case 'InfoReceived':
            return { labelStatus: 'picked_up', orderStatus: 'shipped', attention: false };
        case 'DeliveryFailure':
            return { labelStatus: 'failed', orderStatus: null, attention: false };
        case 'Exception':
            return { labelStatus: 'failed', orderStatus: null, attention: /Return/i.test(subStatus || '') || true };
        default:
            return { labelStatus: null, orderStatus: null, attention: false };
    }
}

/** When the carrier says it delivered: the Delivered_Other event, then the milestone, then the latest event. */
export function deliveredAtFrom(info: Track17Info | null | undefined): string | null {
    const ti = info?.track_info;
    if (!ti) return null;
    for (const p of ti.tracking?.providers ?? []) {
        for (const e of p.events ?? []) {
            if (e.sub_status === 'Delivered_Other' && (e.time_iso || e.time_utc)) return e.time_iso || e.time_utc || null;
        }
    }
    const milestone = (ti.milestone ?? []).find((m) => m.key_stage === 'Delivered');
    if (milestone?.time_iso || milestone?.time_utc) return milestone.time_iso || milestone.time_utc || null;
    return ti.latest_event?.time_iso || ti.latest_event?.time_utc || null;
}

/** Statuses that mean the carrier is actively moving the parcel (used to hold auto-completion). */
export const TRACK17_LIVE_STATUSES: ReadonlySet<string> = new Set([
    'InTransit', 'OutForDelivery', 'AvailableForPickup', 'DeliveryFailure', 'Exception',
]);
