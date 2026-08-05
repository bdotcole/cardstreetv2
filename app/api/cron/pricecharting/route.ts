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
// THAT DIAGNOSIS WAS WRONG, AND SO WAS EVERY "RAISE THE CAPS" INSTINCT BEFORE IT.
// The 16-concurrent latency test that justified the worker pool was run from a
// laptop, which PriceCharting does not throttle. Instrumenting the real run on
// 2026-08-04 showed 4,146 of 4,424 requests (93.7%) coming back 429 wrapped in a
// Cloudflare "Just a moment..." interstitial, admitting only 273.
//
// It is our API TOKEN being throttled, not our egress. Moving the route to iad1
// changed nothing (93.5% challenged; reverted in 0034345) — an identical rejection
// rate from two continents rules out IP/ASN scoring. What both runs share is the
// ADMITTED rate: 1.08/s from sin1, 1.20/s from iad1, against ~18/s attempted. That is
// a token bucket of roughly 1 request per second.
//
// So concurrency cannot buy anything here: 12 lanes yield exactly what 1 lane would,
// while firing ~4,200 rejected requests per run at a vendor we pay. Instead a single
// global gate paces every call to REQUEST_INTERVAL_MS, the pools shrink to just
// enough lanes to keep the Supabase writes off the critical path, and retries are
// gone — under a token bucket a retry spends a slot a fresh item could have used, and
// stalest-first ordering brings any dropped item back on a later run.
//
// This does not speed the cycle up. It stops wasting the vendor's capacity and makes
// the yield predictable. Raising the real ceiling needs PriceCharting to lift the
// token's quota, or a switch to the bulk price-guide CSV (one request per category).
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
// Concurrency no longer sets the request rate — the global gate below does. These
// only need enough lanes that a lane's Supabase writes (~100ms for the two round
// trips) overlap the next lane's wait for its slot, so the gate stays saturated. Any
// higher just queues callers against the same 1/s cadence.
const GRADED_CONCURRENCY = 3;
const SEALED_CONCURRENCY = 3;   // sealed items may also run a sales lookup
// 280s left almost no headroom under maxDuration: a manual run on 2026-08-04 was
// killed with FUNCTION_INVOCATION_TIMEOUT at exactly 300s and returned no body at
// all, so the diagnostics never surfaced. The gap must cover the slowest in-flight
// operation a lane can still be holding when the budget expires (one FETCH_TIMEOUT_MS
// plus its Supabase writes) with room to serialize the response.
const TIME_BUDGET_MS = 250_000;
const SEALED_RESERVE_MS = 120_000;  // tail of the budget the graded pass may not touch
const GRADED_DEADLINE_MS = TIME_BUDGET_MS - SEALED_RESERVE_MS;
// Budget / interval IS the run's whole yield now, so this constant alone sets
// throughput. Calibrated in two steps against the measured token bucket, which
// admitted 1.08-1.20 req/s while being raced:
//   1000ms -> 249 attempts, 243 x 200, 3 x 429 (97.6% clean) but only 243 items,
//             about 18% below the 295 that racing the quota had extracted.
//    850ms -> ~296 slots per run, restoring that yield while keeping the request
//             volume ~94% below the racing approach.
// 850 is a deliberate step toward the ceiling, not a safe floor: it sits inside the
// observed admit band rather than under it, so a few 429s are expected and fine. Push
// further only on evidence — if `statusCounts` shows 429s climbing past a few percent,
// the bucket is refusing the extra rate and the slots are being wasted again, so go
// back to 1000ms. Watch statusCounts, never guess.
const REQUEST_INTERVAL_MS = 850;
// THE BUDGETS ABOVE WERE UNENFORCEABLE WITHOUT THIS. `pool()` can only check stop()
// between items, so an in-flight fetch is not preemptible: a connection that hangs
// parks its worker lane forever, neither deadline can bound it, and Promise.all over
// the lanes never resolves — which is exactly the 300s kill above. Measured latency
// to this host is avg 245ms / P99 3.62s, so 10s is ~3x the tail: generous for a slow
// response, fatal to a hung one.
// Nothing is retried now, so this also caps what a single bad item can cost.
const FETCH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serializes every outbound PriceCharting call onto a shared `interval`-spaced
 * schedule, across both passes — the quota is per token, so a per-pass or per-lane
 * limiter would not bound the account-wide rate that actually matters.
 *
 * Callers reserve their slot synchronously before awaiting, so two lanes arriving in
 * the same tick take consecutive slots rather than the same one. That is only safe
 * because JS runs the reservation to completion without interleaving; do not add an
 * await between reading and writing `next`.
 */
function rateLimiter(interval: number) {
    let next = 0;
    return async function acquire() {
        const now = Date.now();
        const slot = Math.max(now, next);
        next = slot + interval;
        if (slot > now) await sleep(slot - now);
    };
}

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

    // Per-attempt HTTP status tally. Vercel's own numbers could not settle what this
    // host returns to the sin1 egress: its External APIs panel reports two
    // contradictory latencies for the same host and window (per-endpoint row P75
    // 22.8ms vs hostname chart avg 245ms / P75 251ms / P99 3.62s), so we count it
    // ourselves rather than reason from either.
    //
    // `inFlight` is the load-bearing one. A parked lane is invisible in latency
    // percentiles — a request that never completes is never sampled — so a hang looks
    // identical to idleness. inFlight pinned at the concurrency cap while
    // fetchAttempts stops climbing is the signature, and nothing else shows it.
    const statusCounts: Record<string, number> = {};
    const bodySamples: string[] = [];
    let fetchAttempts = 0;
    let inFlight = 0;
    function noteStatus(key: string, body?: string) {
        statusCounts[key] = (statusCounts[key] || 0) + 1;
        // A challenge/block page identifies itself in its first line; two samples is
        // enough to tell Cloudflare from a plain rate-limit JSON without bloating
        // the response.
        if (body !== undefined && bodySamples.length < 2) {
            bodySamples.push(`${key}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
        }
    }

    // One attempt per item, gated on the shared 1/s schedule. No retry loop: under a
    // token bucket every retry spends a slot that a fresh item could have used, so
    // retrying trades new work for repeated work at exactly 1:1. A dropped item is not
    // lost — stalest-first ordering floats it back up on a later run.
    const acquireSlot = rateLimiter(REQUEST_INTERVAL_MS);
    async function fetchProduct(id: string) {
        await acquireSlot();
        fetchAttempts++;
        let res: Response;
        inFlight++;
        try {
            res = await fetch(buildProductByIdUrl(token!, id), {
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
        } catch (e: any) {
            // A transport-level failure never reaches the status tally otherwise, and
            // would be indistinguishable from a slow success in the totals.
            // AbortSignal.timeout surfaces as TimeoutError, so a hang is counted under
            // its own key rather than blurred into generic network errors.
            noteStatus(`network:${e?.name || 'error'}`);
            throw e;
        } finally {
            inFlight--;
        }
        // Only drain the body while samples are still wanted. A 429 here now means the
        // pacing is still too fast for the quota, so statusCounts is the dial to watch.
        const wantSample = !res.ok && bodySamples.length < 2;
        noteStatus(String(res.status), wantSample ? await res.clone().text() : undefined);
        if (res.ok) return res.json();
        throw new Error(`PriceCharting ${res.status}`);
    }

    let gradedCards = 0, gradedRows = 0, sealedUpdated = 0;

    // The response body is not a reliable channel: when the function is killed at
    // maxDuration there is no body at all, which is how the 2026-08-04 investigation
    // lost its diagnostics. stdout survives the kill, so emit the same numbers on a
    // timer. A timer rather than a per-item counter on purpose — if lanes are parked,
    // the counters stop moving and per-item logging goes silent exactly when the
    // evidence matters most.
    const snapshot = () => ({
        elapsedMs: elapsed(), gradedCards, gradedRows, sealedUpdated,
        fetchAttempts, inFlight, statusCounts,
    });
    // Self-limiting: if either pass throws, the clearInterval below is skipped, and on
    // a warm instance an orphaned timer would log forever. Stopping itself past the
    // budget bounds that without wrapping the whole handler in try/finally.
    const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
        if (elapsed() > TIME_BUDGET_MS + 30_000) { clearInterval(heartbeat); return; }
        console.log('[pricecharting] heartbeat', JSON.stringify(snapshot()));
    }, HEARTBEAT_MS);

    // Raised from 5/10: the old caps truncated the evidence to a handful of ids and
    // hid whether failures were uniform or clustered. Bounded well below the item
    // count so a total outage still cannot balloon the response.
    const ERROR_SAMPLE_CAP = 40;
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
            if (errors.length < ERROR_SAMPLE_CAP) errors.push(`graded ${m.pricecharting_id}: ${e.message}`);
        }
    });

    const gradedElapsedMs = elapsed();
    console.log('[pricecharting] graded pass done', JSON.stringify(snapshot()));

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
            if (errors.length < ERROR_SAMPLE_CAP) errors.push(`sealed ${s.pricecharting_id}: ${e.message}`);
        }
    });

    clearInterval(heartbeat);
    console.log('[pricecharting] run complete', JSON.stringify(snapshot()));

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
        // With one attempt per item, fetchAttempts is now simply how many slots the
        // run consumed, and elapsedMs / fetchAttempts should sit at REQUEST_INTERVAL_MS.
        // Drifting above it means the pools are too narrow to keep the gate saturated.
        fetchAttempts,
        // inFlight should be 0 here. Anything else means a lane outlived its pass.
        inFlight,
        statusCounts,
        bodySamples,
        errors,
        timestamp: new Date().toISOString(),
    });
}
