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
import {
    ENTITY_LABEL_MAX,
    ENTITY_MIN,
    LIVE_AUCTION_MAX_SECONDS,
    LIVE_AUCTION_MIN_SECONDS,
    isBreakItemType,
    parseBreakEntities,
    parseBulkTiers,
    requireBroadcaster,
    type BreakEntity,
    type BulkTier,
} from '@/lib/liveBreaks';
import { MIN_CHARGE_SATANG } from '@/components/live/shared';

const MAX_SPOTS = 200;
const MAX_PACKS_PER_SPOT = 50;

// A lot priced below Stripe's THB floor mints spots nobody can ever pay for
// (see MIN_CHARGE_SATANG) — catch it at creation, where the seller can still
// fix it, rather than at the buyer's payment sheet.
const MIN_PRICE_ERROR =
    "Minimum spot price is ฿10 — Stripe's minimum charge";

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

        if (typeof itemType !== 'string' || (!isBreakItemType(itemType) && itemType !== 'buy_now' && itemType !== 'auction')) {
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
        let breakEntities: BreakEntity[] | null = null;
        let bulkTiers: BulkTier[] | null = null;
        let incrementalShipSatang = 0;

        // Presales (20260810_presales.sql): the seller opts a break lot into
        // pre-live spot sales at creation. Break types only — buy_now pins a
        // marketplace listing that is already purchasable outside the show.
        // Only meaningful while the show is still scheduled; a live show's
        // lots are claimable regardless, so the flag is dropped there.
        const presaleEnabled =
            isBreakItemType(itemType) &&
            stream.status === 'scheduled' &&
            (body?.presaleEnabled === true || body?.presale_enabled === true);

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
            if (!spotPrice || spotPrice < MIN_CHARGE_SATANG) {
                return NextResponse.json(
                    { error: MIN_PRICE_ERROR, code: 'MIN_CHARGE' },
                    { status: 400 },
                );
            }
            if (!packsPerSpot || packsPerSpot > MAX_PACKS_PER_SPOT) {
                return NextResponse.json(
                    { error: `packsPerSpot must be an integer between 1 and ${MAX_PACKS_PER_SPOT}` },
                    { status: 400 },
                );
            }

            // ─── character_break: the entity list IS the board ───
            // One character/team per spot, so the list length must equal
            // spots_total exactly — a shorter list would leave orphan spots
            // the randomizer can't fill; a longer one, characters that can
            // never be won.
            if (itemType === 'character_break') {
                breakEntities = parseBreakEntities(body?.breakEntities ?? body?.break_entities);
                if (!breakEntities) {
                    return NextResponse.json(
                        { error: `Each character needs a name of 1-${ENTITY_LABEL_MAX} characters` },
                        { status: 400 },
                    );
                }
                if (breakEntities.length < ENTITY_MIN) {
                    return NextResponse.json(
                        { error: `A character break needs at least ${ENTITY_MIN} characters` },
                        { status: 400 },
                    );
                }
                if (breakEntities.length !== spotsTotal) {
                    return NextResponse.json(
                        { error: 'One character per spot — the list must have exactly spotsTotal entries' },
                        { status: 400 },
                    );
                }
            }

            // ─── Bulk discounts (any spot-based format) ───
            if (body?.bulkTiers != null || body?.bulk_tiers != null) {
                bulkTiers = parseBulkTiers(body?.bulkTiers ?? body?.bulk_tiers, spotsTotal);
                if (!bulkTiers) {
                    return NextResponse.json(
                        {
                            error:
                                'bulkTiers must be 1-3 tiers of {qty, discountPct} with qty ' +
                                'ascending between 2 and spotsTotal and discountPct 1-50',
                        },
                        { status: 400 },
                    );
                }
            }

            // ─── rip_till_hit: per-turn pricing mode ───
            // Spots are sequential turns. 'fixed' sells each turn at
            // spot_price through the claim rail (one at a time — the claim
            // route gates it); 'auction' runs each turn through the live bid
            // engine with spot_price as the opening bid. Both ride the
            // card_data snapshot — no schema column.
            if (itemType === 'rip_till_hit') {
                const pricing =
                    (body?.rtyhPricing ?? body?.rtyh_pricing) === 'auction' ? 'auction' : 'fixed';
                const extra: Record<string, unknown> = { rtyhPricing: pricing };
                if (pricing === 'auction') {
                    const rawDuration = body?.durationSeconds ?? body?.duration_seconds;
                    const durationSeconds = asPositiveInt(rawDuration) ?? 60;
                    if (
                        durationSeconds < LIVE_AUCTION_MIN_SECONDS ||
                        durationSeconds > LIVE_AUCTION_MAX_SECONDS
                    ) {
                        return NextResponse.json(
                            {
                                error: `durationSeconds must be between ${LIVE_AUCTION_MIN_SECONDS} and ${LIVE_AUCTION_MAX_SECONDS}`,
                            },
                            { status: 400 },
                        );
                    }
                    extra.auctionDurationSeconds = durationSeconds;
                }
                if (cardData && typeof cardData === 'object' && !Array.isArray(cardData)) {
                    cardData = { ...cardData, ...extra };
                }
            }

            // ─── Extra shipping per spot (20260816_first_checkout_shipping) ───
            // Spots a buyer takes from THIS lot beyond their first ship free
            // by default; this per-spot increment (satang) is the seller's
            // opt-in surcharge on those. The buyer's first spot from the lot
            // always carries the lot's real Flash-quoted base fee instead —
            // see app/api/live/spots/checkout.
            const rawIncShip = body?.incrementalShipSatang ?? body?.incremental_ship_satang;
            if (rawIncShip != null) {
                if (
                    typeof rawIncShip !== 'number' ||
                    !Number.isInteger(rawIncShip) ||
                    rawIncShip < 0
                ) {
                    return NextResponse.json(
                        { error: 'incrementalShipSatang must be an integer >= 0 (satang)' },
                        { status: 400 },
                    );
                }
                incrementalShipSatang = rawIncShip;
            }
        } else if (itemType === 'auction') {
            // Live auction: the winner's price comes from the bid engine, so
            // creation only pins the floor and the clock. The auctions row is
            // NOT minted here — the start route creates it when the breaker
            // puts the lot on the block, so the timer never runs in the queue.
            const startingPrice = asPositiveInt(body?.startingPrice ?? body?.starting_price);
            if (!startingPrice || startingPrice < MIN_CHARGE_SATANG) {
                return NextResponse.json(
                    { error: MIN_PRICE_ERROR, code: 'MIN_CHARGE' },
                    { status: 400 },
                );
            }
            const rawDuration = body?.durationSeconds ?? body?.duration_seconds;
            const durationSeconds = asPositiveInt(rawDuration) ?? 60;
            if (
                durationSeconds < LIVE_AUCTION_MIN_SECONDS ||
                durationSeconds > LIVE_AUCTION_MAX_SECONDS
            ) {
                return NextResponse.json(
                    {
                        error: `durationSeconds must be between ${LIVE_AUCTION_MIN_SECONDS} and ${LIVE_AUCTION_MAX_SECONDS}`,
                    },
                    { status: 400 },
                );
            }
            // The single spot carries the money; spots_total/spot_price double
            // as display fields. The clock rides the card_data snapshot (no
            // dedicated column; the start route reads it back).
            spotsTotal = 1;
            spotPrice = startingPrice;
            if (cardData && typeof cardData === 'object' && !Array.isArray(cardData)) {
                cardData = { ...cardData, auctionDurationSeconds: durationSeconds };
            }
        } else {
            // buy_now: a pinned marketplace listing. The lot must reference a
            // listing the seller actually owns and can still sell.
            price = asPositiveInt(body?.price);
            listingId = typeof body?.listingId === 'string' ? body.listingId
                : typeof body?.listing_id === 'string' ? body.listing_id : null;
            if (!price || price < MIN_CHARGE_SATANG) {
                return NextResponse.json(
                    { error: MIN_PRICE_ERROR, code: 'MIN_CHARGE' },
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

        const baseRow = {
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
        };
        const fullRow = {
            ...baseRow,
            ...(presaleEnabled ? { presale_enabled: true } : null),
            ...(breakEntities ? { break_entities: breakEntities } : null),
            ...(bulkTiers ? { bulk_tiers: bulkTiers } : null),
            ...(incrementalShipSatang > 0 ? { incremental_ship_satang: incrementalShipSatang } : null),
        };

        let { data: lot, error: lotErr } = await admin
            .from('stream_items')
            .insert(fullRow)
            .select()
            .single();

        // Degrade ladder, newest migration first: incremental_ship_satang
        // (20260816) is dropped BEFORE the character_break refusal below, so a
        // missing 20260816 column alone can't misread as "character breaks
        // unavailable" — the retry keeps break_entities and the rest.
        if (lotErr && lotErr.code === 'PGRST204' && incrementalShipSatang > 0) {
            console.warn(
                '[Live/Lots] incremental_ship_satang column missing (run 20260816_first_checkout_shipping.sql) — creating lot without extra shipping',
            );
            incrementalShipSatang = 0;
            ({ data: lot, error: lotErr } = await admin
                .from('stream_items')
                .insert({
                    ...baseRow,
                    ...(presaleEnabled ? { presale_enabled: true } : null),
                    ...(breakEntities ? { break_entities: breakEntities } : null),
                    ...(bulkTiers ? { bulk_tiers: bulkTiers } : null),
                })
                .select()
                .single());
        }

        // Pre-migration tolerance. A character_break is unservable without its
        // schema (the widened item_type CHECK and break_entities from
        // 20260813_character_breaks_bulk.sql both) — refuse it plainly instead
        // of minting a degraded lot. PGRST204 = column missing from the
        // PostgREST schema cache; 23514 = the un-widened CHECK rejected the
        // new item_type.
        if (lotErr && itemType === 'character_break' && (lotErr.code === 'PGRST204' || lotErr.code === '23514')) {
            console.warn(
                '[Live/Lots] character_break schema missing (run 20260813_character_breaks_bulk.sql)',
            );
            return NextResponse.json(
                { error: 'Character breaks are not available yet — try another format' },
                { status: 503 },
            );
        }
        // rip_till_hit pre-migration: the un-widened item_type CHECK rejects
        // the insert (23514) — refuse plainly rather than degrade.
        if (lotErr && itemType === 'rip_till_hit' && lotErr.code === '23514') {
            console.warn('[Live/Lots] rip_till_hit schema missing (run 20260818_rip_till_hit.sql)');
            return NextResponse.json(
                { error: 'Rip-til-you-hit lots are not available yet — try another format' },
                { status: 503 },
            );
        }
        // Other formats degrade instead: drop bulk_tiers (20260813), then
        // presale_enabled (20260810) — the lot itself must still be creatable.
        if (lotErr && lotErr.code === 'PGRST204' && bulkTiers) {
            console.warn(
                '[Live/Lots] bulk_tiers column missing (run 20260813_character_breaks_bulk.sql) — creating lot without bulk discounts',
            );
            ({ data: lot, error: lotErr } = await admin
                .from('stream_items')
                .insert(presaleEnabled ? { ...baseRow, presale_enabled: true } : baseRow)
                .select()
                .single());
        }
        if (lotErr && lotErr.code === 'PGRST204' && presaleEnabled) {
            console.warn(
                '[Live/Lots] presale_enabled column missing (run 20260810_presales.sql) — creating lot without presale',
            );
            ({ data: lot, error: lotErr } = await admin
                .from('stream_items')
                .insert(baseRow)
                .select()
                .single());
        }

        if (lotErr || !lot) {
            console.error('[Live/Lots] lot insert failed:', lotErr?.message);
            return NextResponse.json({ error: 'Failed to create lot' }, { status: 500 });
        }

        // ─── Break spots: minted with the lot, priced at the snapshot ───
        // Auction lots mint their single spot here too — it is the payment
        // vehicle at hammer (winner's checkout hold rides it), inert until
        // then (the claim route refuses auction lots outright).
        let spotsCreated = 0;
        if ((isBreakItemType(itemType) || itemType === 'auction') && spotsTotal && spotPrice) {
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
