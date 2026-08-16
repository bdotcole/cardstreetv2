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
import { releaseExpiredHolds } from '@/lib/liveBreaks';
import { nextTurnSpot, rtyhPricingOf, type LiveSpotRow } from '@/components/live/shared';

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

        // Sweep this spot's stream before arbitrating. claim_break_spot can
        // already steal THIS spot's lapsed hold on its own, so the sweep is
        // for the room: the tap that lands here is also the freshest signal
        // that someone is looking at this board, and it reopens every sibling
        // spot whose buyer walked away. Both the lookup and the sweep are
        // fail-soft — a claim must never 500 on housekeeping.
        const { data: spotRow } = await admin
            .from('break_spots')
            .select('stream_id, stream_item_id, stream_items(item_type, card_data)')
            .eq('id', id)
            .maybeSingle<{
                stream_id: string;
                stream_item_id: string;
                stream_items: { item_type: string; card_data: Record<string, unknown> | null } | null;
            }>();

        // An auction lot's spot is the HAMMER's payment vehicle — it is never
        // directly claimable; the winner receives it as a hold at close. The
        // RPC doesn't know item types, so the gate lives here. rip_till_hit
        // lots in auction pricing mode work the same way, per turn.
        const lotType = spotRow?.stream_items?.item_type;
        if (
            lotType === 'auction' ||
            (lotType === 'rip_till_hit' &&
                rtyhPricingOf({ card_data: spotRow?.stream_items?.card_data ?? null }) === 'auction')
        ) {
            return NextResponse.json(
                { claimed: false, reason: 'auction', error: 'Bid on this lot instead of claiming it' },
                { status: 409 },
            );
        }

        // rip_till_hit sells turns strictly in order: only the next eligible
        // turn (lowest available, every lower turn SOLD) is claimable. The
        // read is advisory — the money side is still the hold/checkout CAS —
        // but it keeps the queue honest against direct API calls.
        if (lotType === 'rip_till_hit' && spotRow) {
            const { data: siblings } = await admin
                .from('break_spots')
                .select('id, stream_item_id, spot_number, price, status, held_by, hold_expires_at, buyer_id, order_id, sold_at, assigned_packs')
                .eq('stream_item_id', spotRow.stream_item_id)
                .order('spot_number', { ascending: true })
                .returns<LiveSpotRow[]>();
            const eligible = nextTurnSpot(siblings ?? [], Date.now());
            if (!eligible || eligible.id !== id) {
                return NextResponse.json(
                    {
                        claimed: false,
                        reason: 'not_next_turn',
                        error: 'Turns sell one at a time — this one is not up yet',
                    },
                    { status: 409 },
                );
            }
        }

        if (spotRow?.stream_id) await releaseExpiredHolds(spotRow.stream_id);

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
