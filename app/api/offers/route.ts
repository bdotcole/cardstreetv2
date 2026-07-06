/**
 * OBO Best-Offer — create + list.
 *
 *   POST /api/offers            buyer opens an offer on an OBO listing
 *   GET  /api/offers            list the caller's offers (buyer and/or seller)
 *
 * Auth: the SSR client (cookie session) identifies the caller. All writes/reads
 * of the offers table run on the service-role admin client so RLS is bypassed
 * and the CAS WHERE clauses (and the DB partial-unique index) are the authority.
 *
 * Feature-flagged: while NEXT_PUBLIC_ENABLE_OFFERS !== '1' every route 404s.
 */

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse, after } from 'next/server';
import {
    OFFER_MIN_FLOOR_FRACTION,
    OFFER_MAX_PENDING_PER_BUYER,
    OFFER_REJECT_COOLDOWN_HOURS,
    OFFER_CREATE_RATE_PER_MIN,
} from '@/lib/offerPolicy';
import { sendOfferReceivedNotification } from '@/lib/courier';

export const runtime = 'nodejs';

const OFFERS_ENABLED = () => process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

export async function POST(req: NextRequest) {
    if (!OFFERS_ENABLED()) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // ─── Auth ───
    const cookieSupabase = await createServerClient();
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const buyerId = user.id;

    const body = await req.json().catch(() => ({}));
    const listingId: string | null = typeof body?.listing_id === 'string' ? body.listing_id : null;
    const amount: number | null =
        typeof body?.amount === 'number' && Number.isFinite(body.amount) && body.amount > 0 ? body.amount : null;
    const message: string | null =
        typeof body?.message === 'string' && body.message.trim().length > 0 ? body.message.trim().slice(0, 500) : null;

    if (!listingId || amount === null) {
        return NextResponse.json({ error: 'listing_id and a positive amount are required' }, { status: 400 });
    }

    const admin = createAdminClient();

    // ─── Load the listing (service-role) ───
    const { data: listing, error: listingErr } = await admin
        .from('listings')
        .select('id, seller_id, price, status, accepts_offers, card_data')
        .eq('id', listingId)
        .single();

    if (listingErr || !listing) {
        return NextResponse.json({ error: 'Listing not found' }, { status: 400 });
    }
    if (listing.status !== 'active') {
        return NextResponse.json({ error: 'Listing is no longer available' }, { status: 400 });
    }
    if (listing.accepts_offers !== true) {
        return NextResponse.json({ error: 'This listing does not accept offers' }, { status: 400 });
    }
    if (listing.seller_id === buyerId) {
        return NextResponse.json({ error: "You can't offer on your own listing" }, { status: 400 });
    }

    // ─── Anti-abuse: min-offer floor ───
    const floor = Number(listing.price) * OFFER_MIN_FLOOR_FRACTION;
    if (amount < floor) {
        return NextResponse.json(
            { error: 'Offer is below the minimum for this listing', code: 'OFFER_TOO_LOW', min: Math.ceil(floor) },
            { status: 422 },
        );
    }

    // ─── Anti-abuse: endpoint rate-limit (creates/min/buyer) ───
    // No reusable in-tree rate limiter was found; count this buyer's own recent
    // offer rows as a lightweight limiter.
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await admin
        .from('offers')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', buyerId)
        .gte('created_at', oneMinAgo);
    if ((recentCount ?? 0) >= OFFER_CREATE_RATE_PER_MIN) {
        return NextResponse.json({ error: 'Too many offers — slow down', code: 'RATE_LIMITED' }, { status: 429 });
    }

    // ─── Anti-abuse: global pending cap (buyer-made pending offers) ───
    const { count: pendingCount } = await admin
        .from('offers')
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', buyerId)
        .eq('status', 'pending')
        .eq('actor_role', 'buyer');
    if ((pendingCount ?? 0) >= OFFER_MAX_PENDING_PER_BUYER) {
        return NextResponse.json(
            { error: 'You have too many active offers', code: 'OFFER_LIMIT_REACHED' },
            { status: 429 },
        );
    }

    // ─── Anti-abuse: post-reject cooldown on the same listing ───
    const cooldownStart = new Date(Date.now() - OFFER_REJECT_COOLDOWN_HOURS * 3_600_000).toISOString();
    const { data: recentReject } = await admin
        .from('offers')
        .select('id')
        .eq('listing_id', listingId)
        .eq('buyer_id', buyerId)
        .eq('status', 'rejected')
        .gte('updated_at', cooldownStart)
        .limit(1);
    if (recentReject && recentReject.length > 0) {
        return NextResponse.json(
            { error: 'Please wait before offering again on this listing', code: 'OFFER_COOLDOWN' },
            { status: 429 },
        );
    }

    // ─── Insert. The partial unique index enforces one-live-per-buyer atomically. ───
    const { data: created, error: insertErr } = await admin
        .from('offers')
        .insert({
            listing_id: listingId,
            buyer_id: buyerId,
            seller_id: listing.seller_id,
            amount,
            status: 'pending',
            actor_role: 'buyer',
            message,
            stripe_region: 'th',
            // expires_at defaults to NOW()+48h
        })
        .select('id, amount, expires_at, status')
        .single();

    if (insertErr) {
        // 23505 = unique_violation on uniq_offers_one_live_per_buyer_listing
        if ((insertErr as { code?: string }).code === '23505') {
            return NextResponse.json(
                { error: 'You already have a live offer on this listing', code: 'OFFER_ALREADY_LIVE' },
                { status: 409 },
            );
        }
        console.error('[Offers/Create] insert failed:', insertErr);
        return NextResponse.json({ error: 'Failed to create offer' }, { status: 500 });
    }

    // Notify the seller (off the request path).
    const cardName = (listing.card_data as { name?: string } | null)?.name;
    after(() =>
        sendOfferReceivedNotification(listing.seller_id, {
            offerId: created.id,
            listingId,
            amount,
            cardName,
        }).catch((e) => console.error('[Offers/Create] notify (non-fatal):', e)),
    );

    return NextResponse.json(
        { id: created.id, amount: created.amount, expires_at: created.expires_at, status: created.status },
        { status: 201 },
    );
}

export async function GET(req: NextRequest) {
    if (!OFFERS_ENABLED()) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const cookieSupabase = await createServerClient();
    const { data: { user }, error: authErr } = await cookieSupabase.auth.getUser();
    if (authErr || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role'); // 'buyer' | 'seller' | null (both)
    const state = searchParams.get('state') || 'active'; // 'active' | 'all'

    const admin = createAdminClient();
    let q = admin
        .from('offers')
        .select(
            'id, listing_id, buyer_id, seller_id, amount, status, actor_role, counter_of, message, expires_at, created_at, updated_at',
        )
        .order('updated_at', { ascending: false });

    if (role === 'buyer') q = q.eq('buyer_id', user.id);
    else if (role === 'seller') q = q.eq('seller_id', user.id);
    else q = q.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

    if (state === 'active') q = q.in('status', ['pending', 'accepted']);

    const { data: offers, error } = await q;
    if (error) {
        console.error('[Offers/List] query failed:', error);
        return NextResponse.json({ error: 'Failed to load offers' }, { status: 500 });
    }

    // ─── Enrich with a listing snapshot for display (explicit columns, no select('*')). ───
    const listingIds = [...new Set((offers || []).map((o) => o.listing_id))];
    const snapshots = new Map<string, { price: number; status: string; card_data: unknown }>();
    if (listingIds.length > 0) {
        const { data: listingRows } = await admin
            .from('listings')
            .select('id, price, status, card_data')
            .in('id', listingIds);
        for (const l of listingRows || []) {
            snapshots.set(l.id, { price: l.price, status: l.status, card_data: l.card_data });
        }
    }

    const enriched = (offers || []).map((o) => ({
        ...o,
        // The caller's role on this offer, so the UI can pick which actions to show.
        viewerRole: o.buyer_id === user.id ? 'buyer' : 'seller',
        listing: snapshots.get(o.listing_id) ?? null,
    }));

    return NextResponse.json({ offers: enriched });
}
