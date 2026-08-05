/**
 * POST /api/live/streams/[id]/lots — add a lot to the run-of-show.
 *
 * Break item_types also mint their break_spots rows here (spot_number
 * 1..spots_total at the snapshot price), so a lot is purchasable the moment
 * it exists. Shape rules are validated up front to return friendly errors
 * instead of surfacing the table's CHECK constraint failures.
 *
 * Prices are seller-entered INTEGER SATANG. Trusting them from the body is
 * correct here — the seller is pricing their own product; the never-trust rule
 * applies to BUYER-side amounts (claim/checkout read prices from DB rows).
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isBreakItemType, requireBroadcaster } from '@/lib/liveBreaks';

const MAX_SPOTS = 200;
const MIN_PRICE_SATANG = 100;
const MAX_PACKS_PER_SPOT = 50;

function asPositiveInt(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireBroadcaster(id);
        if (ctx instanceof NextResponse) return ctx;
        const { user, stream } = ctx;

        if (stream.status !== 'scheduled' && stream.status !== 'live') {
            return NextResponse.json(
                { error: `Cannot add lots to a ${stream.status} stream` },
                { status: 409 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const itemType = typeof body?.itemType === 'string' ? body.itemType : body?.item_type;

        if (itemType === 'auction') {
            // The schema reserves the seam, but nothing serves auction lots yet
            // (no auctions row, no bid route) — an inert lot would just confuse
            // the console. Reject until the live-auction phase wires it.
            return NextResponse.json(
                { error: 'Auction lots are not available yet' },
                { status: 400 },
            );
        }
        if (typeof itemType !== 'string' || (!isBreakItemType(itemType) && itemType !== 'buy_now')) {
            return NextResponse.json({ error: 'Invalid itemType' }, { status: 400 });
        }

        const admin = createAdminClient();

        // ─── Shape validation per item_type ───
        let spotsTotal: number | null = null;
        let spotPrice: number | null = null;
        let packsPerSpot = 1;
        let price: number | null = null;
        let listingId: string | null = null;
        let cardData = body?.cardData ?? body?.card_data;

        if (isBreakItemType(itemType)) {
            spotsTotal = asPositiveInt(body?.spotsTotal ?? body?.spots_total);
            spotPrice = asPositiveInt(body?.spotPrice ?? body?.spot_price);
            const pps = body?.packsPerSpot ?? body?.packs_per_spot;
            packsPerSpot = pps == null ? 1 : (asPositiveInt(pps) ?? 0);

            // A personal break is by definition one buyer taking the whole
            // product — a single spot.
            if (itemType === 'personal_break' && spotsTotal !== 1) {
                return NextResponse.json(
                    { error: 'A personal break has exactly 1 spot' },
                    { status: 400 },
                );
            }
            if (!spotsTotal || spotsTotal > MAX_SPOTS) {
                return NextResponse.json(
                    { error: `spotsTotal must be an integer between 1 and ${MAX_SPOTS}` },
                    { status: 400 },
                );
            }
            if (!spotPrice || spotPrice < MIN_PRICE_SATANG) {
                return NextResponse.json(
                    { error: 'spotPrice must be at least 100 satang (1 THB)' },
                    { status: 400 },
                );
            }
            if (!packsPerSpot || packsPerSpot > MAX_PACKS_PER_SPOT) {
                return NextResponse.json(
                    { error: `packsPerSpot must be an integer between 1 and ${MAX_PACKS_PER_SPOT}` },
                    { status: 400 },
                );
            }
        } else {
            // buy_now: a pinned marketplace listing. The lot must reference a
            // listing the seller actually owns and can still sell.
            price = asPositiveInt(body?.price);
            listingId = typeof body?.listingId === 'string' ? body.listingId
                : typeof body?.listing_id === 'string' ? body.listing_id : null;
            if (!price || price < MIN_PRICE_SATANG) {
                return NextResponse.json(
                    { error: 'price must be at least 100 satang (1 THB)' },
                    { status: 400 },
                );
            }
            if (!listingId) {
                return NextResponse.json(
                    { error: 'buy_now lots require listingId' },
                    { status: 400 },
                );
            }
            const { data: listing } = await admin
                .from('listings')
                .select('id, seller_id, status, card_data')
                .eq('id', listingId)
                .maybeSingle<{ id: string; seller_id: string; status: string; card_data: Record<string, unknown> | null }>();
            if (!listing || listing.seller_id !== user.id) {
                return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
            }
            if (listing.status !== 'active') {
                return NextResponse.json(
                    { error: 'Listing is no longer active' },
                    { status: 409 },
                );
            }
            // The lot snapshot defaults to the listing's own card_data so the
            // overlay always has something to render.
            if (cardData == null) cardData = listing.card_data;
        }

        if (cardData == null || typeof cardData !== 'object' || Array.isArray(cardData)) {
            return NextResponse.json(
                { error: 'cardData (product snapshot object) is required' },
                { status: 400 },
            );
        }

        // ─── Position: explicit, or appended to the end of the queue ───
        let position: number;
        const rawPosition = body?.position;
        if (rawPosition != null) {
            if (typeof rawPosition !== 'number' || !Number.isInteger(rawPosition) || rawPosition < 0) {
                return NextResponse.json({ error: 'position must be a non-negative integer' }, { status: 400 });
            }
            position = rawPosition;
        } else {
            const { data: last } = await admin
                .from('stream_items')
                .select('position')
                .eq('stream_id', stream.id)
                .order('position', { ascending: false })
                .limit(1)
                .maybeSingle<{ position: number }>();
            position = (last?.position ?? -1) + 1;
        }

        const { data: lot, error: lotErr } = await admin
            .from('stream_items')
            .insert({
                stream_id: stream.id,
                seller_id: user.id,
                item_type: itemType,
                position,
                card_data: cardData,
                listing_id: listingId,
                spots_total: spotsTotal,
                spot_price: spotPrice,
                packs_per_spot: packsPerSpot,
                price,
            })
            .select()
            .single();

        if (lotErr || !lot) {
            console.error('[Live/Lots] lot insert failed:', lotErr?.message);
            return NextResponse.json({ error: 'Failed to create lot' }, { status: 500 });
        }

        // ─── Break spots: minted with the lot, priced at the snapshot ───
        let spotsCreated = 0;
        if (isBreakItemType(itemType) && spotsTotal && spotPrice) {
            const spotRows = Array.from({ length: spotsTotal }, (_, i) => ({
                stream_item_id: lot.id,
                stream_id: stream.id,
                seller_id: user.id,
                spot_number: i + 1,
                price: spotPrice,
            }));
            const { error: spotsErr } = await admin.from('break_spots').insert(spotRows);
            if (spotsErr) {
                // A break lot without its spots is unsellable — roll the lot
                // back rather than leave a half-created lot in the queue.
                console.error('[Live/Lots] spot insert failed:', spotsErr.message);
                await admin.from('stream_items').delete().eq('id', lot.id);
                return NextResponse.json({ error: 'Failed to create break spots' }, { status: 500 });
            }
            spotsCreated = spotsTotal;
        }

        return NextResponse.json({ success: true, lot, spotsCreated });
    } catch (err: any) {
        console.error('[Live/Lots] error:', err);
        return NextResponse.json({ error: 'Failed to create lot' }, { status: 500 });
    }
}
