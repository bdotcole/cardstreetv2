import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';

// Daily Thai price refresh. One set-based call to apply_thai_price_rule (migration
// 20260907): every Thai card with a >= 0.99 English twin is re-derived at 60% of the
// twin's current price, realized in-app sales override it, admin pins are skipped,
// and 10-baht placeholders on cards with no qualifying twin are removed.
//
// Scheduled after the PriceCharting refresh (03:00 UTC) so the English side is
// fresh when the Thai side is derived from it. daily-market-update still prices
// the English side; this cron is the only whole-catalog Thai writer.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const started = Date.now();

    const { data, error } = await supabase.rpc('apply_thai_price_rule');
    if (error) {
        // Before the migration runs the function does not exist; report and exit
        // clean so the cron does not page every night for a known step.
        const missing = /apply_thai_price_rule/.test(error.message) && /not exist|could not find/i.test(error.message);
        if (!missing) {
            Sentry.captureException(new Error(`recompute-thai-prices failed: ${error.message}`));
        }
        return NextResponse.json({ ok: false, error: error.message, missingFunction: missing }, { status: missing ? 200 : 500 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ ok: true, ...(row || {}), tookMs: Date.now() - started });
}
