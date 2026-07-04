/**
 * /api/auctions -- browse + create (beta-gated).
 *
 * GET  ?scope=live|selling|bidding|won&limit&offset  → auction list + serverNow
 * POST { card_id, card_data, condition, pricing..., duration_hours } → create
 *
 * Every response carries serverNow: countdown UI derives time-left from
 * ends_at - serverNow (server clock only), never the client clock.
 *
 * Reads go through the service-role client because bids RLS hides rival rows
 * and the caller may need aggregate context; requireBeta() is the lock.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBeta } from '@/lib/betaAuth';
import {
    isValidAuctionDuration,
    MIN_STARTING_PRICE_SATANG,
    MAX_PRICE_SATANG,
    SOFT_CLOSE_WINDOW_SECONDS,
    SOFT_CLOSE_EXTENSION_SECONDS,
} from '@/lib/auctionRules';
import {
    SELLER_REQUIRED_PROFILE_FIELDS,
    checkSellerProfileComplete,
    PROFILE_INCOMPLETE_TOAST,
    PROFILE_INCOMPLETE_ERROR_CODE,
} from '@/lib/profileValidation';

export const dynamic = 'force-dynamic';

// Public projection: never leak bid maxima (they live only on bids rows).
const AUCTION_COLUMNS =
    'id, seller_id, card_id, card_data, condition, is_graded, grading_company, grade, ' +
    'image_front_url, image_back_url, ' +
    'starting_price, reserve_price, buy_now_price, current_price, reserve_met, ' +
    'bid_count, high_bidder_id, status, ends_at, extension_count, mode, ' +
    'winner_id, winning_amount, won_via, order_id, payment_due_at, ' +
    'second_chance_offered_to, second_chance_amount, second_chance_expires_at, second_chance_status, ' +
    'closed_at, created_at';

export async function GET(request: NextRequest) {
    const gate = await requireBeta('auctions');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') || 'live';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const admin = createAdminClient();
    let query = admin
        .from('auctions')
        .select(
            `${AUCTION_COLUMNS}, ` +
            'seller:profiles!auctions_seller_id_fkey(id, display_name, avatar_url, rating, review_count), ' +
            // Payment state for the Won view ("Pay now" needs the transfer_group).
            'order:orders!auctions_order_id_fkey(id, status, transfer_group)',
        );

    switch (scope) {
        case 'selling':
            query = query.eq('seller_id', user.id).order('created_at', { ascending: false });
            break;
        case 'bidding': {
            // Auctions the caller has bid on that are still running.
            const { data: bidRows } = await admin
                .from('bids')
                .select('auction_id')
                .eq('bidder_id', user.id)
                .order('created_at', { ascending: false })
                .limit(500);
            const ids = [...new Set((bidRows ?? []).map(b => b.auction_id))];
            if (ids.length === 0) {
                return NextResponse.json({ auctions: [], serverNow: new Date().toISOString() });
            }
            query = query.in('id', ids).eq('status', 'live').order('ends_at', { ascending: true });
            break;
        }
        case 'won':
            // Wins awaiting payment or paid, plus open second-chance offers.
            query = query
                .or(`winner_id.eq.${user.id},and(second_chance_offered_to.eq.${user.id},second_chance_status.eq.offered)`)
                .eq('status', 'sold')
                .order('closed_at', { ascending: false });
            break;
        default: // 'live' browse
            query = query.eq('status', 'live').gt('ends_at', new Date().toISOString())
                .order('ends_at', { ascending: true });
    }

    const { data, error } = await query.range(offset, offset + limit - 1);
    if (error) {
        console.error('[Auctions] list failed:', error);
        return NextResponse.json({ error: 'Failed to load auctions' }, { status: 500 });
    }

    return NextResponse.json({
        auctions: data ?? [],
        serverNow: new Date().toISOString(),
        userId: user.id,
    });
}

const CreateAuctionSchema = z.object({
    card_id: z.string().min(1).max(128),
    card_data: z.record(z.unknown()),
    condition: z.enum(['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged', 'Sealed']),
    is_graded: z.boolean().optional(),
    grading_company: z.enum(['PSA', 'BGS', 'CGC', 'ARS']).nullable().optional(),
    grade: z.number().min(1).max(10).nullable().optional(),
    image_front_url: z.string().url().max(2048).nullable().optional(),
    image_back_url: z.string().url().max(2048).nullable().optional(),
    // All satang integers; the client converts THB inputs.
    starting_price_satang: z.number().int().min(MIN_STARTING_PRICE_SATANG).max(MAX_PRICE_SATANG),
    reserve_price_satang: z.number().int().positive().max(MAX_PRICE_SATANG).nullable().optional(),
    buy_now_price_satang: z.number().int().positive().max(MAX_PRICE_SATANG).nullable().optional(),
    duration_hours: z.number().int(),
});

export async function POST(request: NextRequest) {
    const gate = await requireBeta('auctions');
    if (gate instanceof NextResponse) return gate;
    const { user } = gate;

    try {
        const parsed = CreateAuctionSchema.safeParse(await request.json());
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid auction payload', details: parsed.error.flatten() },
                { status: 400 },
            );
        }
        const body = parsed.data;

        if (!isValidAuctionDuration(body.duration_hours)) {
            return NextResponse.json({ error: 'Invalid auction duration' }, { status: 400 });
        }
        if (body.reserve_price_satang != null && body.reserve_price_satang < body.starting_price_satang) {
            return NextResponse.json({ error: 'Reserve must be at least the starting price' }, { status: 400 });
        }
        if (body.buy_now_price_satang != null && body.buy_now_price_satang < body.starting_price_satang) {
            return NextResponse.json({ error: 'Buy-It-Now must be at least the starting price' }, { status: 400 });
        }

        const admin = createAdminClient();

        // Same completeness gate as fixed-price listings...
        const { data: sellerProfile, error: profileErr } = await admin
            .from('profiles')
            .select(`${SELLER_REQUIRED_PROFILE_FIELDS.join(',')}, stripe_account_id, stripe_charges_enabled`)
            .eq('id', user.id)
            .single<Record<string, string | boolean | null>>();
        if (profileErr || !sellerProfile) {
            return NextResponse.json({ error: 'Seller profile not found' }, { status: 404 });
        }
        const completeness = checkSellerProfileComplete(sellerProfile);
        if (!completeness.complete) {
            return NextResponse.json(
                { error: PROFILE_INCOMPLETE_TOAST, code: PROFILE_INCOMPLETE_ERROR_CODE, missing: completeness.missing },
                { status: 400 },
            );
        }

        // ...but STRICTER on Stripe: the winner is charged at close with no
        // seller in the loop, so the seller must already be chargeable
        // (charges_enabled), not merely details-submitted like list-first.
        if (!(sellerProfile.stripe_account_id && sellerProfile.stripe_charges_enabled)) {
            return NextResponse.json(
                {
                    error: 'Finish Stripe verification in Profile > Payouts & Bank before running auctions.',
                    code: 'SELLER_NOT_CHARGEABLE',
                },
                { status: 400 },
            );
        }

        const now = Date.now();
        const endsAt = new Date(now + body.duration_hours * 3600_000).toISOString();

        const { data: auction, error } = await admin
            .from('auctions')
            .insert({
                seller_id: user.id,
                card_id: body.card_id,
                card_data: body.card_data,
                condition: body.condition,
                is_graded: body.is_graded || false,
                grading_company: body.grading_company ?? null,
                grade: body.grade ?? null,
                image_front_url: body.image_front_url ?? null,
                image_back_url: body.image_back_url ?? null,
                starting_price: body.starting_price_satang,
                reserve_price: body.reserve_price_satang ?? null,
                buy_now_price: body.buy_now_price_satang ?? null,
                current_price: body.starting_price_satang,
                status: 'live',
                ends_at: endsAt,
                original_ends_at: endsAt,
                mode: 'timed',
                soft_close_window_seconds: SOFT_CLOSE_WINDOW_SECONDS,
                soft_close_extension_seconds: SOFT_CLOSE_EXTENSION_SECONDS,
            })
            .select(AUCTION_COLUMNS)
            .single();

        if (error) {
            console.error('[Auctions] create failed:', error);
            return NextResponse.json({ error: 'Failed to create auction' }, { status: 500 });
        }

        return NextResponse.json({ auction, serverNow: new Date().toISOString() });
    } catch (err: any) {
        console.error('[Auctions] create error:', err);
        return NextResponse.json({ error: err?.message || 'Failed to create auction' }, { status: 500 });
    }
}
