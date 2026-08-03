import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    buildProductByIdUrl,
    gradedRowsFromProduct,
    centsToUsd,
    thaiSealedEstimateThb,
} from '@/lib/pricecharting';
import { PUBLIC_MIN_LISTING_PRICE_THB } from '@/lib/pricingFloors';

// Daily PriceCharting refresh. Graded + sealed prices move slowly, so this only
// re-fetches a bounded, stalest-first slice each run (by PriceCharting product id,
// so no re-matching). The initial backfill is the .mjs ingest; this keeps it fresh.
//
// Cadence is daily rather than weekly because the caps below bound throughput, not
// the schedule: pricecharting_map has grown to ~56k rows, so at GRADED_CAP per run a
// weekly cron needed ~141 weeks for a full cycle and most rows sat months stale.
//
// WALL CLOCK, NOT THE CAPS, IS THE REAL LIMIT. Each item costs ~875ms end to end
// (PriceCharting round trip + two Supabase writes), so the old 50s budget only ever
// got through ~57 cards — 14% of GRADED_CAP. Worse, graded ran first against a single
// shared budget and consumed all of it, so the sealed loop below broke on its very
// first overBudget() check and `sealedUpdated` was 0 on every run: sealed prices sat
// frozen from 2026-06-29/07-04 onward. Two fixes:
//   1. maxDuration 300s (same as /api/scan and /api/cron/mirror-images, so the plan
//      already supports it) with the budget widened to match.
//   2. Sealed gets a RESERVED slice at the end. Graded stops early at
//      GRADED_DEADLINE_MS so the sealed pass can never be starved again.
//
// THAT WAS NOT ENOUGH, because the work was still strictly sequential. Measured
// 2026-08-03: throughput rose from ~57/day to ~145/day, but `pricecharting_map` had
// grown to 71,809 rows (the Japanese Yu-Gi-Oh ingest added 15,557), so a full graded
// cycle still took ~1.4 YEARS and sealed ~89 days.
//
// The bottleneck is PriceCharting's own latency, not our rate limiting: a sequential
// product fetch measured 819ms, while 16 issued concurrently completed in 2,242ms
// total — 140ms each, a 5.9x speedup with 16/16 succeeding. So each pass now runs a
// bounded worker pool instead of a for-loop. Per item that turns ~1,160ms of
// wall clock into ~90ms, and the CAPS become the binding constraint again, so they
// are raised to match. Expected yield: ~1,000 graded cards + ~600 sealed per run,
// i.e. a ~72-day graded cycle and a ~8-day sealed cycle.
//
// Concurrency is deliberately below the measured-safe 16 to leave headroom, and
// fetchProduct retries 429/5xx with backoff so a rate limit degrades into slower
// progress rather than a burned budget.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` (same as the other crons).
// Needs PRICECHARTING_TOKEN in the Vercel env.

export const runtime = 'nodejs';
export const maxDuration = 300;

// 1000 is PostgREST's hard response ceiling — `.limit(1500)` verifiably still
// returns 1000 rows. Raising this alone buys nothing; going past it needs a paged
// candidate query, and paging an `order by last_priced_at` full of NULL ties can
// duplicate or skip rows, so it is not worth it for the extra ~24 days of cycle.
const GRADED_CAP = 1000;  // mapped cards refreshed per run
const SEALED_CAP = 600;   // sealed products refreshed per run
const GRADED_CONCURRENCY = 12;
const SEALED_CONCURRENCY = 8;   // gentler: each sealed item may also run a sales lookup
const TIME_BUDGET_MS = 280_000;
const SEALED_RESERVE_MS = 120_000;  // tail of the budget the graded pass may not touch
const GRADED_DEADLINE_MS = TIME_BUDGET_MS - SEALED_RESERVE_MS;
const FETCH_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `worker` over `items` with at most `concurrency` in flight, stopping early
 * once `stop()` goes true. Workers pull from a shared cursor rather than being
 * pre-sharded, so one slow item can't leave a whole lane idle.
 */
async function pool<T>(
    items: T[],
    concurrency: number,
    stop: () => boolean,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let next = 0;
    const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            if (stop()) return;
            const i = next++;
            if (i >= items.length) return;
            await worker(items[i]);
        }
    });
    await Promise.all(lanes);
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = process.env.PRICECHARTING_TOKEN;
    if (!token) {
        return NextResponse.json({ error: 'PRICECHARTING_TOKEN not configured' }, { status: 503 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const overBudget = () => elapsed() > TIME_BUDGET_MS;
    const gradedOverDeadline = () => elapsed() > GRADED_DEADLINE_MS;

    // Retries 429/5xx with backoff. With a worker pool the throttle is the
    // concurrency cap rather than a fixed inter-request sleep, so a rate limit has
    // to be absorbed here or it would just burn budget on failures.
    async function fetchProduct(id: string) {
        for (let attempt = 0; ; attempt++) {
            const res = await fetch(buildProductByIdUrl(token!, id));
            if (res.ok) return res.json();
            const retryable = res.status === 429 || res.status >= 500;
            if (!retryable || attempt >= FETCH_RETRIES) throw new Error(`PriceCharting ${res.status}`);
            await sleep(500 * (attempt + 1));
        }
    }

    let gradedCards = 0, gradedRows = 0, sealedUpdated = 0;
    const errors: string[] = [];

    // --- Graded: stalest-mapped cards ------------------------------------------
    const { data: maps } = await supabase
        .from('pricecharting_map')
        .select('card_id, pricecharting_id')
        .order('last_priced_at', { ascending: true, nullsFirst: true })
        .limit(GRADED_CAP);

    // The market_values unique key includes language; reuse the card's market
    // language (ja -> jp) so refreshes update the same row the ingest wrote.
    // Chunked to stay clear of PostgREST's 1000-row response cap, which GRADED_CAP now
    // sits exactly on. A truncated lookup fails SILENTLY and badly: every missing card
    // falls back to 'en', writing English-language price rows onto Japanese and Thai
    // cards instead of updating the rows the ingest actually wrote.
    const cardIds = (maps || []).map((m) => m.card_id);
    const langByCard = new Map<string, string>();
    const jpOnePiece = new Set<string>();
    for (let i = 0; i < cardIds.length; i += 500) {
        const { data: cards } = await supabase
            .from('pokemon_cards')
            .select('id, language, game')
            .in('id', cardIds.slice(i, i + 500));
        for (const c of cards || []) {
            langByCard.set(c.id, c.language === 'ja' ? 'jp' : (c.language || 'en'));
            if (c.game === 'onepiece' && c.language === 'ja') jpOnePiece.add(c.id);
        }
    }

    await pool(maps || [], GRADED_CONCURRENCY, gradedOverDeadline, async (m) => {
        try {
            const product = await fetchProduct(m.pricecharting_id);
            const lang = langByCard.get(m.card_id) || 'en';
            const rows = gradedRowsFromProduct(product).map((r) => ({
                card_id: m.card_id,
                language: lang,
                condition: r.condition,
                printing: null,
                market_avg: r.usd,
                currency: 'USD',
                last_updated: new Date().toISOString(),
            }));
            // JP One Piece has no JustTCG coverage, so PriceCharting's loose price
            // is the only ungraded source — refresh the Raw_NM headline row too.
            if (jpOnePiece.has(m.card_id)) {
                const loose = centsToUsd(product['loose-price']);
                if (loose != null) {
                    rows.push({
                        card_id: m.card_id,
                        language: lang,
                        condition: 'Raw_NM',
                        printing: null,
                        market_avg: loose,
                        currency: 'USD',
                        last_updated: new Date().toISOString(),
                    });
                }
            }
            if (rows.length) {
                const { error } = await supabase.from('market_values').upsert(rows, { onConflict: 'card_id,language,condition' });
                if (error) throw error;
                gradedRows += rows.length;
            }
            await supabase.from('pricecharting_map').update({ last_priced_at: new Date().toISOString() }).eq('card_id', m.card_id);
            gradedCards++;
        } catch (e: any) {
            if (errors.length < 5) errors.push(`graded ${m.pricecharting_id}: ${e.message}`);
        }
    });

    const gradedElapsedMs = elapsed();

    // --- Sealed: stalest sealed products ---------------------------------------
    const { data: sealed } = await supabase
        .from('sealed_products')
        .select('id, pricecharting_id, currency, product_type')
        .not('pricecharting_id', 'is', null)
        .order('last_updated', { ascending: true, nullsFirst: true })
        .limit(SEALED_CAP);

    await pool(sealed || [], SEALED_CONCURRENCY, overBudget, async (s) => {
        try {
            const product = await fetchProduct(s.pricecharting_id);
            if (s.currency === 'THB') {
                // Feature B: if this Thai sealed product already sold, its price is
                // learned from a realized sale — don't overwrite it with the JP-box
                // estimate. sealed_products has no `source` column, so guard by the
                // presence of a market_value_sales row (sealed listing card_id ===
                // sealed_products.id, e.g. 'pc-<...>').
                //
                // Sub-floor sales are admin seed listings and never set a price
                // (lib/pricingFloors.ts), so they must not block the estimate either —
                // otherwise a 1-baht seed sale would freeze the product on whatever
                // stale estimate it happened to carry.
                const { data: sold } = await supabase
                    .from('market_value_sales')
                    .select('order_id')
                    .eq('card_id', s.id)
                    .eq('language', 'th')
                    .eq('is_sealed', true)
                    .gte('sale_amount_thb', PUBLIC_MIN_LISTING_PRICE_THB)
                    .limit(1)
                    .maybeSingle();
                if (sold) { return; }

                // Thai estimate row: pricecharting_id points at the JP TWIN's box.
                // Re-derive the THB estimate from the JP box market; never write the
                // JP USD price into a THB row.
                const jpBoxUsd = centsToUsd(product['new-price'])
                    ?? centsToUsd(product['cib-price'])
                    ?? centsToUsd(product['loose-price']);
                const est = thaiSealedEstimateThb(s.product_type, jpBoxUsd);
                if (est != null) {
                    const { error } = await supabase.from('sealed_products').update({
                        new_price: est,
                        last_updated: new Date().toISOString(),
                    }).eq('id', s.id);
                    if (error) throw error;
                    sealedUpdated++;
                }
            } else {
                const { error } = await supabase.from('sealed_products').update({
                    loose_price: centsToUsd(product['loose-price']),
                    cib_price: centsToUsd(product['cib-price']),
                    new_price: centsToUsd(product['new-price']),
                    last_updated: new Date().toISOString(),
                }).eq('id', s.id);
                if (error) throw error;
                sealedUpdated++;
            }
        } catch (e: any) {
            if (errors.length < 10) errors.push(`sealed ${s.pricecharting_id}: ${e.message}`);
        }
    });

    return NextResponse.json({
        success: true,
        gradedCards, gradedRows, sealedUpdated,
        // Phase timings make the budget split auditable: sealedUpdated === 0 with a
        // non-trivial sealedElapsedMs means sealed genuinely had no stale rows, not
        // that it was starved again.
        gradedElapsedMs,
        sealedElapsedMs: elapsed() - gradedElapsedMs,
        gradedHitDeadline: gradedCards > 0 && gradedElapsedMs >= GRADED_DEADLINE_MS,
        elapsedMs: elapsed(),
        errors,
        timestamp: new Date().toISOString(),
    });
}
