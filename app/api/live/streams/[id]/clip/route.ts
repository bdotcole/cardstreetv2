/**
 * Clips for a live break.
 *
 * POST — the breaker marks the moment that just happened. Broadcaster-only.
 * GET  — list a show's clips (any signed-in viewer), newest first.
 *
 * A clip is a window into the VOD (see 20260820_stream_clips.sql), so creating
 * one is a single INSERT with no media work. That matters mid-break: the
 * breaker taps once, gets an instant confirmation, and keeps ripping.
 */

import { NextResponse } from 'next/server';
import {
    isMissingTableError,
    requireBroadcaster,
    requireViewerOrSeller,
} from '@/lib/liveBreaks';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * A clip captures what ALREADY happened, so the window reaches backwards. The
 * breaker reacts to a pull a beat after it lands, so PRE_ROLL has to cover the
 * reveal plus their reaction time; POST_ROLL catches the hold-up-to-camera.
 */
const PRE_ROLL_MS = 25_000;
const POST_ROLL_MS = 5_000;
/** Matches the CHECK constraint; enforced here too so a bad clamp 400s
 *  cleanly instead of hitting a Postgres error. */
const MAX_CLIP_MS = 120_000;

const CLIP_WINDOW_SECONDS = 60;
const CLIP_MAX_PER_WINDOW = 20;

interface StreamTiming {
    id: string;
    started_at: string | null;
    current_item_id: string | null;
    vod_url: string | null;
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

        // Cheap, but a stuck finger on a phone should not write hundreds of rows.
        const { allowed } = await checkRateLimit(`clip:${user.id}`, {
            windowSeconds: CLIP_WINDOW_SECONDS,
            max: CLIP_MAX_PER_WINDOW,
        });
        if (!allowed) {
            return NextResponse.json(
                { error: 'Slow down a moment', code: 'RATE_LIMITED' },
                { status: 429 },
            );
        }

        const admin = createAdminClient();
        const { data: timing } = await admin
            .from('streams')
            .select('id, started_at, current_item_id, vod_url')
            .eq('id', stream.id)
            .maybeSingle<StreamTiming>();

        // Offsets are measured from started_at because recording begins in the
        // same request that sets it (go-live starts the egress immediately
        // after the status flip), so the two are within a second or two of
        // each other. Without a start time there is nothing to offset from.
        if (!timing?.started_at) {
            return NextResponse.json(
                { error: 'The show has not started yet', code: 'NOT_STARTED' },
                { status: 409 },
            );
        }

        const body = await req.json().catch(() => ({}));
        const rawTitle = typeof body?.title === 'string' ? body.title.trim() : '';
        const title = rawTitle ? rawTitle.slice(0, 120) : null;

        const elapsedMs = Date.now() - Date.parse(timing.started_at);
        // A clock skew or an immediate tap must not produce a negative or
        // inverted window — clamp to the start of the recording.
        const startMs = Math.max(0, elapsedMs - PRE_ROLL_MS);
        const endMs = Math.min(
            Math.max(startMs + 1000, elapsedMs + POST_ROLL_MS),
            startMs + MAX_CLIP_MS,
        );

        const { data: clip, error } = await admin
            .from('stream_clips')
            .insert({
                stream_id: stream.id,
                created_by: user.id,
                stream_item_id: timing.current_item_id,
                title,
                start_ms: Math.round(startMs),
                end_ms: Math.round(endMs),
                // Usually null during the show; the egress webhook backfills it.
                vod_url: timing.vod_url,
            })
            .select('id, title, start_ms, end_ms, vod_url, created_at')
            .single();

        if (error) {
            if (isMissingTableError(error)) {
                return NextResponse.json(
                    { error: 'Clips are not enabled yet', code: 'SCHEMA_MISSING' },
                    { status: 503 },
                );
            }
            console.error('[Live/Clip] insert failed:', error.message);
            return NextResponse.json({ error: 'Could not save the clip' }, { status: 500 });
        }

        return NextResponse.json({ clip, pendingVod: !clip.vod_url });
    } catch (err) {
        console.error('[Live/Clip] error:', err);
        return NextResponse.json({ error: 'Could not save the clip' }, { status: 500 });
    }
}

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const ctx = await requireViewerOrSeller(id);
        if (ctx instanceof NextResponse) return ctx;

        const admin = createAdminClient();
        const { data, error } = await admin
            .from('stream_clips')
            .select('id, title, start_ms, end_ms, vod_url, created_at, stream_item_id')
            .eq('stream_id', id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            // Pre-migration: no clips is the correct answer, not a 500.
            if (isMissingTableError(error)) return NextResponse.json({ clips: [] });
            console.error('[Live/Clip] list failed:', error.message);
            return NextResponse.json({ error: 'Could not load clips' }, { status: 500 });
        }
        return NextResponse.json({ clips: data ?? [] });
    } catch (err) {
        console.error('[Live/Clip] list error:', err);
        return NextResponse.json({ error: 'Could not load clips' }, { status: 500 });
    }
}
