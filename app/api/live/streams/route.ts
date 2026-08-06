/**
 * GET  /api/live/streams — the live-now + upcoming feed (beta viewers).
 * POST /api/live/streams — schedule a stream (broadcasters).
 *
 * Feed shape: public streams only, live shows first (newest on top), then
 * scheduled shows soonest-first. Unlisted streams are link-only by design and
 * never appear here.
 */

import { NextResponse } from 'next/server';
import { requireBeta } from '@/lib/betaAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    SELLER_UNVERIFIED_TOAST,
    SELLER_UNVERIFIED_ERROR_CODE,
} from '@/lib/profileValidation';

interface FeedRow {
    id: string;
    seller_id: string;
    title: string;
    description: string | null;
    cover_image_url: string | null;
    game_id: string | null;
    status: string;
    scheduled_at: string | null;
    started_at: string | null;
    viewer_peak: number;
    created_at: string;
    seller: { display_name: string | null; avatar_url: string | null } | null;
    // ?mine=1 only — the show manager needs these; the public feed never
    // returns them.
    visibility?: string;
    ended_at?: string | null;
}

const FEED_COLS =
    'id, seller_id, title, description, cover_image_url, game_id, status, ' +
    'scheduled_at, started_at, viewer_peak, created_at, ' +
    'seller:profiles!streams_seller_id_fkey(display_name, avatar_url)';

export async function GET(req: Request) {
    try {
        // ?mine=1 — the seller's own show manager (Profile > Live shows):
        // ALL of the caller's streams regardless of status/visibility, gated
        // on the broadcaster grant instead of the viewer grant.
        if (new URL(req.url).searchParams.get('mine') === '1') {
            const gate = await requireBeta('live_broadcast');
            if (gate instanceof NextResponse) return gate;

            const admin = createAdminClient();
            const { data, error } = await admin
                .from('streams')
                .select(`${FEED_COLS}, visibility, ended_at`)
                .eq('seller_id', gate.user.id)
                .order('created_at', { ascending: false })
                .limit(100)
                .returns<FeedRow[]>();

            if (error) {
                console.error('[Live/Streams] mine query failed:', error.message);
                return NextResponse.json({ error: 'Failed to load streams' }, { status: 500 });
            }
            return NextResponse.json({ streams: data ?? [] });
        }

        const gate = await requireBeta('live_streams');
        if (gate instanceof NextResponse) return gate;

        const admin = createAdminClient();
        const { data, error } = await admin
            .from('streams')
            .select(FEED_COLS)
            .eq('visibility', 'public')
            .in('status', ['live', 'scheduled'])
            .limit(100)
            .returns<FeedRow[]>();

        if (error) {
            console.error('[Live/Streams] feed query failed:', error.message);
            return NextResponse.json({ error: 'Failed to load streams' }, { status: 500 });
        }

        // PostgREST can't ORDER BY CASE, so the live-first / soonest-scheduled
        // ordering is applied here (the feed is capped at 100 rows anyway).
        const streams = (data ?? []).sort((a, b) => {
            if (a.status !== b.status) return a.status === 'live' ? -1 : 1;
            if (a.status === 'live') {
                return (b.started_at ?? '').localeCompare(a.started_at ?? '');
            }
            return (a.scheduled_at ?? '9999').localeCompare(b.scheduled_at ?? '9999');
        });

        return NextResponse.json({ streams });
    } catch (err: any) {
        console.error('[Live/Streams] GET error:', err);
        return NextResponse.json({ error: 'Failed to load streams' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const gate = await requireBeta('live_broadcast');
        if (gate instanceof NextResponse) return gate;
        const { user } = gate;

        const body = await req.json().catch(() => ({}));

        const title = typeof body?.title === 'string' ? body.title.trim() : '';
        if (title.length < 3 || title.length > 120) {
            return NextResponse.json(
                { error: 'Title must be between 3 and 120 characters' },
                { status: 400 },
            );
        }

        const description =
            typeof body?.description === 'string' && body.description.trim().length > 0
                ? body.description.trim()
                : null;
        // The column has no CHECK cap (unlike title) — enforce one here so an
        // unbounded body can't park megabytes in every feed row.
        if (description !== null && description.length > 2000) {
            return NextResponse.json(
                { error: 'Description must be at most 2000 characters' },
                { status: 400 },
            );
        }
        const gameId =
            typeof body?.gameId === 'string' && body.gameId.length > 0
                ? body.gameId
                : typeof body?.game_id === 'string' && body.game_id.length > 0
                    ? body.game_id
                    : null;
        const visibility = body?.visibility === 'unlisted' ? 'unlisted' : 'public';

        let scheduledAt: string | null = null;
        const rawScheduledAt = body?.scheduledAt ?? body?.scheduled_at;
        if (rawScheduledAt != null) {
            const ts = Date.parse(String(rawScheduledAt));
            if (!Number.isFinite(ts)) {
                return NextResponse.json({ error: 'Invalid scheduled_at' }, { status: 400 });
            }
            scheduledAt = new Date(ts).toISOString();
        }

        const admin = createAdminClient();

        // Same purchase-time gate listings enforce: every lot sale is a direct
        // charge on the seller's connected account, so a host who can't
        // receive charges can't run a show at all.
        const { data: profile } = await admin
            .from('profiles')
            .select('stripe_account_id, stripe_charges_enabled')
            .eq('id', user.id)
            .maybeSingle<{ stripe_account_id: string | null; stripe_charges_enabled: boolean | null }>();

        if (!profile?.stripe_account_id || !profile?.stripe_charges_enabled) {
            return NextResponse.json(
                { error: SELLER_UNVERIFIED_TOAST, code: SELLER_UNVERIFIED_ERROR_CODE },
                { status: 409 },
            );
        }

        const { data: stream, error: insertErr } = await admin
            .from('streams')
            .insert({
                seller_id: user.id,
                title,
                description,
                game_id: gameId,
                visibility,
                status: 'scheduled',
                scheduled_at: scheduledAt,
            })
            .select()
            .single();

        if (insertErr || !stream) {
            console.error('[Live/Streams] insert failed:', insertErr?.message);
            return NextResponse.json({ error: 'Failed to create stream' }, { status: 500 });
        }

        return NextResponse.json({ success: true, stream });
    } catch (err: any) {
        console.error('[Live/Streams] POST error:', err);
        return NextResponse.json({ error: 'Failed to create stream' }, { status: 500 });
    }
}
