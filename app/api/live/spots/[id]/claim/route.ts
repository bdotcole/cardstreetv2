/**
 * POST /api/live/spots/[id]/claim — first-tap-wins hold on a break spot.
 *
 * All arbitration lives in the claim_break_spot RPC (row lock + CAS,
 * expired-hold stealing, live-stream / lot-open / suspension checks); this
 * route adds the auth, geo, and rate-limit shell around it. The 180s hold is
 * the window to reach checkout — checkout then extends it for the payment.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';

const HOLD_SECONDS = 180;
const CLAIM_WINDOW_SECONDS = 60;
const CLAIM_MAX_PER_WINDOW = 10;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        // Same TH-only purchase gate as orders/checkout — a claim is the first
        // step of a purchase, so out-of-region buyers stop here, before any
        // spot is taken off the board for everyone else.
        const country = getRequestCountry(req);
        if (!isPurchaseAllowedFromCountry(country)) {
            return NextResponse.json(
                {
                    error:
                        'Purchases are currently only available in Thailand. ' +
                        'Buying is coming soon to your country.',
                    code: 'GEO_RESTRICTED',
                    country,
                },
                { status: 403 },
            );
        }

        // Fail-open limiter (checkRateLimit default): a limiter outage must not
        // freeze spot sales mid-show.
        const { allowed } = await checkRateLimit(`live-claim:${user.id}`, {
            windowSeconds: CLAIM_WINDOW_SECONDS,
            max: CLAIM_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json(
                { error: 'Too many claims — slow down', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }

        const admin = createAdminClient();
        const { data, error } = await admin.rpc('claim_break_spot', {
            p_spot_id: id,
            p_buyer_id: user.id,
            p_hold_seconds: HOLD_SECONDS,
        });

        if (error) {
            console.error('[Live/Claim] RPC failed:', error.message);
            return NextResponse.json({ error: 'Failed to claim spot' }, { status: 500 });
        }

        const result = (data ?? {}) as {
            claimed?: boolean;
            reason?: string;
            [key: string]: unknown;
        };

        if (result.claimed === true) {
            return NextResponse.json(result);
        }
        if (result.reason === 'not_found') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        // held / unavailable / lot_closed / stream_not_live / own_item /
        // suspended — all contention or eligibility, all retriable-or-not by
        // the client based on `reason`.
        return NextResponse.json(result, { status: 409 });
    } catch (err: any) {
        console.error('[Live/Claim] error:', err);
        return NextResponse.json({ error: 'Failed to claim spot' }, { status: 500 });
    }
}
