import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';

// Daily market movers -> market_movers (compute_market_movers in
// 20261006_pricecharting_consolidation.sql). Rebuilds the 1-day and 7-day windows
// from price_snapshots: each card's newest point in the window against its last
// point before it, from the same source. Read by /api/market/movers.
//
// Scheduled after the last per-game PriceCharting run (04:40 UTC), so the day's
// change points are in.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.

export const runtime = 'nodejs';
export const maxDuration = 120;

const WINDOWS = [1, 7];

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const started = Date.now();
    const rows: Record<string, number> = {};
    const errors: string[] = [];

    for (const days of WINDOWS) {
        const { data, error } = await supabase.rpc('compute_market_movers', { p_days: days });
        if (error) {
            errors.push(`${days}d: ${error.message}`);
            continue;
        }
        rows[`${days}d`] = Number(data) || 0;
    }

    if (errors.length) {
        // Before the migration runs the function does not exist; that is a known
        // step, not an incident.
        const missing = errors.every((e) => /compute_market_movers/.test(e) && /not exist|could not find/i.test(e));
        if (!missing) Sentry.captureMessage(`market-movers: ${errors.join('; ')}`, { level: 'warning' });
        return NextResponse.json({ ok: false, rows, errors, missingFunction: missing }, { status: missing ? 200 : 500 });
    }
    return NextResponse.json({ ok: true, rows, tookMs: Date.now() - started });
}
