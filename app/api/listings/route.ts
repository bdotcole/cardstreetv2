
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { notifyWishlistersOfListing } from '@/lib/wishlistAlerts'
import { submitCardIdsToIndexNow } from '@/lib/indexNow'
import { attachSellers } from '@/lib/publicProfiles'
import {
    SELLER_REQUIRED_PROFILE_FIELDS,
    checkSellerProfileComplete,
    PROFILE_INCOMPLETE_TOAST,
    PROFILE_INCOMPLETE_ERROR_CODE,
} from '@/lib/profileValidation'

const ListingBodySchema = z.object({
    card_id: z.string().min(1).max(128),
    card_data: z.record(z.unknown()),
    price: z.number().positive().max(10_000_000),
    condition: z.enum(['Mint', 'Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged']),
    is_graded: z.boolean().optional(),
    grading_company: z.enum(['PSA', 'BGS', 'CGC', 'SGC', 'ARS', 'TAG']).nullable().optional(),
    grade: z.number().min(1).max(10).nullable().optional(),
    accepts_offers: z.boolean().optional().default(false),
})

export async function GET(request: NextRequest) {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)

    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')
    const search = searchParams.get('search') || ''
    const language = searchParams.get('language') || ''
    const game = searchParams.get('game') || ''
    const sort = searchParams.get('sort') || 'newest'
    const minPrice = parseFloat(searchParams.get('minPrice') || '0')
    const maxPrice = parseFloat(searchParams.get('maxPrice') || '0')

    let query = supabase
        .from('listings')
        .select(`
            id,
            seller_id,
            card_id,
            card_data,
            price,
            condition,
            is_graded,
            status,
            created_at
        `)
        .eq('status', 'active')

    // Server-side filters
    // Match the secondary name too: a Japanese card snapshots its printed
    // Japanese name, with the English one in thaiName, so an English query
    // would otherwise miss every JA listing.
    if (search.trim()) {
        const term = search.trim()
        query = query.or(`card_data->>name.ilike.%${term}%,card_data->>thaiName.ilike.%${term}%`)
    }
    if (language && language !== 'all') {
        query = query.eq('card_data->>language', language)
    }
    if (game && game !== 'all') {
        // Listings created before multi-game support have no game in card_data;
        // treat those legacy rows as Pokemon.
        if (game === 'pokemon') {
            query = query.or('card_data->>game.eq.pokemon,card_data->>game.is.null')
        } else {
            query = query.eq('card_data->>game', game)
        }
    }
    if (minPrice > 0) query = query.gte('price', minPrice)
    if (maxPrice > 0 && maxPrice < 100000) query = query.lte('price', maxPrice)

    // Sort
    switch (sort) {
        case 'price_asc': query = query.order('price', { ascending: true }); break
        case 'price_desc': query = query.order('price', { ascending: false }); break
        default: query = query.order('created_at', { ascending: false })
    }

    query = query.range(offset, offset + limit - 1)

    const { data: listings, error } = await query

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const withSellers = await attachSellers(supabase, (listings || []) as any[])

    return NextResponse.json(withSellers, {
        headers: {
            // Cache for 30s, serve stale for up to 60s while revalidating
            'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        }
    })
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const parsed = ListingBodySchema.safeParse(await request.json())
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid listing payload', details: parsed.error.flatten() },
                { status: 400 },
            )
        }
        const body = parsed.data

        // Same gate as services/marketplaceService.createListing — refuse to
        // create a listing for a seller who can't be shipped from or who hasn't
        // connected payouts yet. Returns a structured error so the client can
        // route the user to Profile.
        const { data: sellerProfile, error: profileErr } = await supabase
            .from('profiles')
            .select(SELLER_REQUIRED_PROFILE_FIELDS.join(','))
            .eq('id', user.id)
            .single<Record<string, string | boolean | null>>()
        if (profileErr) throw profileErr
        const completeness = checkSellerProfileComplete(sellerProfile)
        if (!completeness.complete) {
            return NextResponse.json(
                {
                    error: PROFILE_INCOMPLETE_TOAST,
                    code: PROFILE_INCOMPLETE_ERROR_CODE,
                    missing: completeness.missing,
                },
                { status: 400 },
            )
        }

        // Check if seller has a Stripe account
        const { data: profile } = await supabase
            .from('profiles')
            .select('stripe_account_id')
            .eq('id', user.id)
            .single()

        if (!profile?.stripe_account_id) {
            return NextResponse.json({ error: 'You must connect a Stripe account in your Profile > Payouts & Bank before listing an item for sale.' }, { status: 400 })
        }

        const { data: listing, error } = await supabase
            .from('listings')
            .insert({
                seller_id: user.id,
                card_id: body.card_id,
                card_data: body.card_data,
                price: body.price,
                condition: body.condition,
                is_graded: body.is_graded || false,
                grading_company: body.grading_company,
                grade: body.grade,
                accepts_offers: body.accepts_offers ?? false,
                status: 'active'
            })
            .select()
            .single()

        if (error) throw error

        // Wishlist alerts (Pro perk) run after the response is sent -- a slow
        // or failed fan-out must never delay or fail the listing itself.
        after(() =>
            notifyWishlistersOfListing(listing.id).catch((e) =>
                console.error('[Listings] wishlist alert fan-out failed:', e),
            ),
        )

        // The card page just gained an offer -- tell IndexNow so Bing recrawls
        // it instead of waiting its turn behind ~80k queued card URLs.
        after(() => submitCardIdsToIndexNow([listing.card_id]))

        return NextResponse.json(listing)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
