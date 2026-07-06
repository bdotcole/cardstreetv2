import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';

// Feature B weekly recompute / self-heal. Re-derives every learned-eligible key from
// market_value_sales, flipping keys that cross threshold and refreshing the recent-
// sales average as new sales land. The finalize hook already updates keys in real time
// on each sale; this cron backstops missed recomputes and re-averages steadily.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` (same as the other crons).
// Gated by INTERNAL_PRICING_ENABLED so it is inert until launch.

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIME_BUDGET_MS = 250_000;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (process.env.INTERNAL_PRICING_ENABLED !== 'true') {
        return NextResponse.json({ ok: true, skipped: 'flag off' });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const started = Date.now();
    const summary = { keys: 0, singles: 0, sealed: 0, errors: 0 };

    const { data: keys, error } = await supabase.rpc('list_internal_price_keys');
    if (error) {
        Sentry.captureException(new Error(`recompute-internal-prices query failed: ${error.message}`));
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const k of (keys || []) as Array<{ card_id: string; language: string; condition: string; is_sealed: boolean }>) {
        if (Date.now() - started > TIME_BUDGET_MS) break;
        try {
            if (k.is_sealed) {
                await supabase.rpc('recompute_thai_sealed_price', { p_sealed_id: k.card_id });
                summary.sealed++;
            } else {
                await supabase.rpc('recompute_internal_price', {
                    p_card_id: k.card_id,
                    p_language: k.language,
                    p_condition: k.condition,
                });
                summary.singles++;
            }
            summary.keys++;
        } catch (e: unknown) {
            summary.errors++;
            Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { extra: { key: k } });
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
