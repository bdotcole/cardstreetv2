/**
 * GET /watch — the one link to put on a social stream, in a caption, or in an
 * ad: it lands on whatever public show is live RIGHT NOW.
 *
 * /live/<uuid> is unreadable on screen and changes every show; the branded
 * overlay burned into the Facebook / TikTok feed (app/live/overlay) says
 * "cardstreet.app/watch" instead, and this route resolves it:
 *   - a public LIVE show  -> /live/<id>           (newest-started if several)
 *   - none live, but one is scheduled -> its landing (countdown + presale)
 *   - nothing at all      -> /live (the hub)
 *
 * Attribution: incoming query params are preserved (an ad can carry its own
 * utm_* set); when no utm_source is present the visit is tagged as social
 * overlay traffic, so GA can tell "typed the URL off the stream" from
 * "scanned the QR" (the QR carries utm_medium=overlay_qr) and from email/push.
 *
 * Never cached — the answer changes the moment a show starts or ends.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isFeatureEnabled } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppBaseUrl } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Candidate {
    id: string;
    status: 'live' | 'scheduled';
    started_at: string | null;
    scheduled_at: string | null;
}

export async function GET(request: NextRequest) {
    const base = getAppBaseUrl();
    const incoming = new URL(request.url).searchParams;
    const params = new URLSearchParams(incoming);
    if (!params.has('utm_source')) {
        params.set('utm_source', 'social');
        params.set('utm_medium', 'overlay');
        params.set('utm_campaign', 'live_watch');
    }
    const qs = params.toString();
    const redirect = (path: string) =>
        NextResponse.redirect(`${base}${path}${qs ? `?${qs}` : ''}`, {
            status: 302,
            headers: { 'Cache-Control': 'no-store' },
        });

    try {
        if (!(await isFeatureEnabled('live_streams'))) return redirect('/');

        const admin = createAdminClient();
        const { data } = await admin
            .from('streams')
            .select('id, status, started_at, scheduled_at')
            .eq('visibility', 'public')
            .in('status', ['live', 'scheduled'])
            .limit(50)
            .returns<Candidate[]>();

        const rows = data ?? [];
        const live = rows
            .filter((r) => r.status === 'live')
            .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0];
        if (live) return redirect(`/live/${live.id}`);

        // Soonest upcoming show, ignoring anything more than a day stale (a
        // forgotten scheduled row must not swallow the link forever).
        const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
        const upcoming = rows
            .filter(
                (r) =>
                    r.status === 'scheduled' &&
                    (!r.scheduled_at || Date.parse(r.scheduled_at) >= staleBefore),
            )
            .sort((a, b) => (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999'))[0];
        if (upcoming) return redirect(`/live/${upcoming.id}`);
    } catch (err) {
        console.error('[Watch] resolve failed:', err);
    }
    return redirect('/live');
}
