/**
 * POST /api/webhooks/track17
 *
 * 17TRACK pushes a parcel's full tracking state whenever it changes
 * (TRACKING_UPDATED) and once when it stops following a number
 * (TRACKING_STOPPED). Configure the URL in the 17TRACK dashboard
 * (Settings -> Webhook): https://cardstreet.app/api/webhooks/track17.
 *
 * Authentication is the `sign` header: SHA-256 hex of the raw body + "/" +
 * our API key (lib/track17 verifyTrack17Signature), so the body is read as
 * text and hashed as received. Any non-200 makes 17TRACK retry three times
 * (10, 30 and 60 minutes), so DB failures return 500 and everything we can
 * handle returns 200.
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { isTrack17Configured, verifyTrack17Signature, type Track17Info } from '@/lib/track17';
import { applyTrackingInfo } from '@/lib/externalTracking';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
    if (!isTrack17Configured()) {
        return NextResponse.json({ error: '17TRACK is not configured' }, { status: 410 });
    }
    const raw = await req.text();
    if (!verifyTrack17Signature(raw, req.headers.get('sign'))) {
        return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
    }

    let payload: { event?: string; data?: Track17Info & { number?: string } } | null = null;
    try {
        payload = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
    }
    const event = payload?.event;
    const data = payload?.data;
    if (!event || !data?.number) {
        return NextResponse.json({ ok: true, ignored: 'no event or number' });
    }

    const admin = createAdminClient();
    try {
        if (event === 'TRACKING_UPDATED') {
            const result = await applyTrackingInfo(admin, data);
            return NextResponse.json({ ok: true, ...result });
        }
        if (event === 'TRACKING_STOPPED') {
            // Nothing more will arrive for this number. Recorded so the poll and
            // the auto-complete rule know the carrier has gone quiet.
            const { error } = await admin
                .from('shipping_labels')
                .update({ track17_status: 'Stopped', track17_checked_at: new Date().toISOString() })
                .eq('handoff_tracking_number', data.number);
            if (error && error.code !== 'PGRST204' && error.code !== '42703') throw error;
            return NextResponse.json({ ok: true, stopped: data.number });
        }
        return NextResponse.json({ ok: true, ignored: event });
    } catch (err) {
        console.error('[Track17Webhook] Error:', err);
        Sentry.captureException(err, { tags: { handler: 'track17-webhook' }, extra: { event, number: data.number } });
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}
