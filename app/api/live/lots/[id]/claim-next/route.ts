/**
 * POST /api/live/lots/[id]/claim-next — hold the next available spot on a
 * spot-based lot without the buyer picking a number.
 *
 * The numbered board matters when the number IS the product (pick_your_pack's
 * specific pack, character_break's roster slot). For the FCFS formats —
 * random_pack, chase_break, personal_break, pack_wars — and rip_till_hit's
 * fixed-price turns, the number is bookkeeping the randomizer or the rip
 * order resolves later, so the viewer's one-tap Buy button lands here and the
 * SERVER picks: the lowest available spot, or the next eligible turn.
 *
 * Arbitration stays in claim_break_spot (row lock + CAS + eligibility);
 * this route only chooses which spot to hand the RPC, stepping to the next
 * candidate when a concurrent tap wins the race. rip_till_hit never steps —
 * turns sell strictly in order, so a blocked next turn is a 409, same as the
 * per-spot claim route.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';
import { getRequestCountry, isPurchaseAllowedFromCountry } from '@/lib/geo';
import { isBreakItemType, releaseExpiredHolds } from '@/lib/liveBreaks';
import {
    isSpotOpenNow,
    nextTurnSpot,
    rtyhPricingOf,
    type LiveSpotRow,
} from '@/components/live/shared';

const HOLD_SECONDS = 180;
const CLAIM_WINDOW_SECONDS = 60;
const CLAIM_MAX_PER_WINDOW = 10;
/** How many open spots to try before conceding the board flipped under us. */
const MAX_CANDIDATES = 5;

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        // Same TH-only purchase gate as the per-spot claim route.
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

        // Shares the per-spot claim route's limiter key deliberately — the
        // two entry points draw from ONE claim budget per user.
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

        const { data: lot } = await admin
            .from('stream_items')
            .select('id, stream_id, item_type, card_data')
            .eq('id', id)
            .maybeSingle<{
                id: string;
                stream_id: string;
                item_type: string;
                card_data: Record<string, unknown> | null;
            }>();
        if (!lot) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (!isBreakItemType(lot.item_type)) {
            // auction / buy_now lots have no claimable spot rail.
            return NextResponse.json(
                { claimed: false, reason: 'auction', error: 'This lot is not sold by spots' },
                { status: 409 },
            );
        }
        if (lot.item_type === 'rip_till_hit' && rtyhPricingOf(lot) === 'auction') {
            return NextResponse.json(
                { claimed: false, reason: 'auction', error: 'Bid on this lot instead of claiming it' },
                { status: 409 },
            );
        }

        // Reopen lapsed holds before choosing, so an abandoned board doesn't
        // read as sold out.
        await releaseExpiredHolds(lot.stream_id);

        const { data: spotRows } = await admin
            .from('break_spots')
            .select(
                'id, stream_item_id, spot_number, price, status, held_by, hold_expires_at, buyer_id, order_id, sold_at, assigned_packs',
            )
            .eq('stream_item_id', lot.id)
            .order('spot_number', { ascending: true })
            .returns<LiveSpotRow[]>();
        const spots = spotRows ?? [];

        const now = Date.now();
        let candidates: LiveSpotRow[];
        if (lot.item_type === 'rip_till_hit') {
            const eligible = nextTurnSpot(spots, now);
            if (!eligible) {
                const anyLeft = spots.some(
                    (s) => s.status !== 'sold' && s.status !== 'cancelled',
                );
                // Turns left but none claimable = the next turn is mid-payment.
                return NextResponse.json(
                    { claimed: false, reason: anyLeft ? 'held' : 'unavailable' },
                    { status: 409 },
                );
            }
            candidates = [eligible];
        } else {
            candidates = spots.filter((s) => isSpotOpenNow(s, now)).slice(0, MAX_CANDIDATES);
            if (candidates.length === 0) {
                return NextResponse.json(
                    { claimed: false, reason: 'unavailable' },
                    { status: 409 },
                );
            }
        }

        let last: { claimed?: boolean; reason?: string } | null = null;
        for (const spot of candidates) {
            const { data, error } = await admin.rpc('claim_break_spot', {
                p_spot_id: spot.id,
                p_buyer_id: user.id,
                p_hold_seconds: HOLD_SECONDS,
            });
            if (error) {
                console.error('[Live/ClaimNext] RPC failed:', error.message);
                return NextResponse.json({ error: 'Failed to claim spot' }, { status: 500 });
            }
            const result = (data ?? {}) as { claimed?: boolean; reason?: string };
            if (result.claimed === true) {
                // spot_id / spot_number / price / hold_expires_at ride the RPC
                // result — the client patches its board from these fields.
                return NextResponse.json(result);
            }
            last = result;
            // held / unavailable / not_found are races on THIS spot — step to
            // the next candidate. Everything else (lot_closed,
            // stream_not_live, own_item, suspended) dooms every spot alike.
            if (
                result.reason !== 'held' &&
                result.reason !== 'unavailable' &&
                result.reason !== 'not_found'
            ) {
                return NextResponse.json(result, { status: 409 });
            }
        }
        return NextResponse.json(
            last ?? { claimed: false, reason: 'unavailable' },
            { status: 409 },
        );
    } catch (err) {
        console.error('[Live/ClaimNext] error:', err);
        return NextResponse.json({ error: 'Failed to claim spot' }, { status: 500 });
    }
}
