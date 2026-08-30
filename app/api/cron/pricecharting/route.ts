import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    buildProductByIdUrl,
    buildCsvDownloadUrl,
    gradedRowsFromCsv,
    parseCsvLine,
    csvDollarsToUsd,
    centsToUsd,
    thaiSealedEstimateThb,
    PC_CATEGORY,
} from '@/lib/pricecharting';
import { PUBLIC_MIN_LISTING_PRICE_THB } from '@/lib/pricingFloors';

// Daily PriceCharting refresh. Graded + sealed prices move slowly, so this only
// re-fetches a bounded, stalest-first slice each run (by PriceCharting product id,
// so no re-matching). The initial backfill is the .mjs ingest; this keeps it fresh.
//
// Cadence is daily rather than weekly because the caps below bound throughput, not
// the schedule: pricecharting_map has grown to ~56k rows, so at the old per-run cap a
// weekly cron needed ~141 weeks for a full cycle and most rows sat months stale.
//
// WALL CLOCK, NOT THE CAPS, IS THE REAL LIMIT. Each item costs ~875ms end to end
// (PriceCharting round trip + two Supabase writes), so the old 50s budget only ever
// got through ~57 cards — 14% of that cap. Worse, graded ran first against a single
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
// THE GRADED PASS NOW TAKES THAT SECOND OPTION, and the per-product JSON API is gone
// from it. Measured 2026-08-30, the arithmetic was no longer arguable: 71,939 mapped
// rows against a hard ceiling of ~243 items/run is a 295-DAY cycle. Worse, the
// `nullsFirst` ordering meant the 10,164 never-priced Japanese Yu-Gi-Oh rows absorbed
// every run's entire budget, so MTG, Lorcana and English Yu-Gi-Oh had not been
// refreshed ONCE since the 2026-06-29 ingest — a starvation *inside* the ordering that
// no amount of pacing could fix.
//
// One bulk CSV covers a whole category, so the vendor cost of refreshing a category
// drops from thousands of throttled requests to ONE. Measured for pokemon-cards:
// 92,667 rows / 14.1MB in 29s, of which ~28s is PriceCharting generating the file
// (a fixed per-category cost; the transfer itself is ~1.3s). Every one of our 20,217
// mapped Pokemon ids was present — a 100% hit rate, because the CSV `id` column IS
// `pricecharting_map.pricecharting_id`, so nothing needs re-matching.
//
// One category per run, chosen stalest-first (see pickStalestGame). Five categories
// against a daily cron puts every mapped card on a ~5-day cycle instead of 295 days,
// and because the choice is driven by last_priced_at the rotation is self-balancing:
// refreshing a category stamps its rows, which drops it to the back of the queue.
//
// The 1-request/second token bucket still governs the SEALED pass, which is still
// per-product (sealed rows live in sealed_products, keyed differently, and a sealed
// product's THB estimate needs a sales lookup the CSV cannot answer). Graded no longer
// competing for those slots is why sealed can now use the whole rate-limited budget.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` (same as the other crons).
// Needs PRICECHARTING_TOKEN in the Vercel env.

export const runtime = 'nodejs';
export const maxDuration = 300;

// Mapped cards pulled per page. 1000 is PostgREST's hard response ceiling —
// `.limit(1500)` verifiably still returns 1000 rows — so it is a page size, not a
// run cap: the graded pass now pages until the category is done or the deadline hits.
const GRADED_PAGE = 1000;
// Ordering ties are the reason paging is safe here. `order by last_priced_at` over a
// bulk-stamped column is full of exact ties, and a tie can reshuffle between pages,
// which duplicates or skips rows. Adding card_id as a tiebreaker makes the sort total
// and therefore stable across pages. Do not drop it.
const SEALED_CAP = 600;   // sealed products refreshed per run
const SEALED_CONCURRENCY = 3;   // sealed items may also run a sales lookup
// market_values rows per upsert. The graded pass writes ~6 rows per card, so a large
// category is ~200k rows; batching at 1000 keeps each round trip well inside
// PostgREST's request limits while holding the write count to ~200 calls.
const UPSERT_BATCH = 1000;
// Cap on the CSV we will buffer. pokemon-cards measured 14.1MB; 96MB is ~7x the
// largest category and still far under the function's memory, but it bounds a
// pathological response instead of letting it OOM the run.
const CSV_MAX_BYTES = 96 * 1024 * 1024;
// The CSV is one request but a SLOW one (~28s of server-side generation before the
// first byte). It must not be able to eat the whole graded deadline if the vendor
// stalls, so it gets its own ceiling well inside GRADED_DEADLINE_MS.
const CSV_TIMEOUT_MS = 90_000;
// 280s left almost no headroom under maxDuration: a manual run on 2026-08-04 was
// killed with FUNCTION_INVOCATION_TIMEOUT at exactly 300s and returned no body at
// all, so the diagnostics never surfaced. The gap must cover the slowest in-flight
// operation a lane can still be holding when the budget expires (one FETCH_TIMEOUT_MS
// plus its Supabase writes) with room to serialize the response.
const TIME_BUDGET_MS = 250_000;
const SEALED_RESERVE_MS = 120_000;  // tail of the budget the graded pass may not touch
const GRADED_DEADLINE_MS = TIME_BUDGET_MS - SEALED_RESERVE_MS;
// Budget / interval IS the run's whole yield now, so this constant alone sets
// throughput. 1000ms is MEASURED OPTIMAL, not a cautious guess — 850ms was tried and
// reverted. Same code, same queue, back to back:
//   1000ms -> 249 slots, 243 x 200,  3 x 429  -> 243 items
//    850ms -> 288 slots, 243 x 200, 38 x 429  -> 243 items
// The 200 count is identical. Every one of the 39 extra requests the tighter interval
// bought came back 429: slots convert to rejections 1:1 and yield nothing. The bucket
// admits ~243 successes per 250s run (~0.96 req/s) and that is a hard CEILING, not a
// rate we are approaching. Do not tighten this again.
//
// Racing the quota did extract 295 items, but 850ms proves steady pacing cannot reach
// that at all — it appears to be burst capacity a fixed interval never sees, and it
// costs ~15x the request volume. Not worth chasing.
const REQUEST_INTERVAL_MS = 1_000;
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

    // --- Graded: one whole category per run, from the bulk CSV ------------------
    //
    // Which category? The one owning the stalest mapped rows. Sampling the head of
    // the stalest-first ordering and taking the modal game is deliberately more
    // robust than reading a single row: one orphaned map row (a card_id no longer in
    // pokemon_cards) would otherwise pin the whole run to the wrong category forever.
    let gradedGame: string | null = null;
    let gradedCategory: string | null = null;
    let gradedMapped = 0;
    let gradedUnresolved = 0;
    let gradedCsvRows = 0;
    let gradedComplete = false;

    const { data: staleHead } = await supabase
        .from('pricecharting_map')
        .select('game')
        .not('game', 'is', null)
        .order('last_priced_at', { ascending: true, nullsFirst: true })
        .order('card_id', { ascending: true })
        .limit(500);
    if (staleHead?.length) {
        const tally = new Map<string, number>();
        for (const r of staleHead) tally.set(r.game, (tally.get(r.game) || 0) + 1);
        gradedGame = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
        gradedCategory = PC_CATEGORY[gradedGame] ?? null;
    }

    if (gradedGame && gradedCategory) {
        try {
            // ONE request for the entire category. Prices here are DOLLAR STRINGS, not
            // the cents the JSON product API returns — see csvDollarsToUsd.
            const csvRes = await fetch(buildCsvDownloadUrl(token, gradedCategory), {
                signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
            });
            noteStatus(`csv:${csvRes.status}`);
            if (!csvRes.ok) throw new Error(`CSV ${csvRes.status}`);
            const csvText = await csvRes.text();
            if (csvText.length > CSV_MAX_BYTES) throw new Error(`CSV too large: ${csvText.length}`);

            const csvLines = csvText.split('\n');
            const header = parseCsvLine(csvLines[0] || '');
            const colIndex: Record<string, number> = {};
            header.forEach((h, i) => { colIndex[h.trim()] = i; });
            const idCol = colIndex['id'];
            const looseCol = colIndex['loose-price'];
            if (idCol == null) throw new Error('CSV has no id column');

            // pcId -> graded rows (+ loose, for the JP One Piece ungraded fallback).
            const priceById = new Map<string, { graded: Array<{ condition: string; usd: number }>; loose: number | null }>();
            for (let i = 1; i < csvLines.length; i++) {
                if (!csvLines[i]) continue;
                const f = parseCsvLine(csvLines[i]);
                const pcId = f[idCol];
                if (!pcId) continue;
                priceById.set(pcId, {
                    graded: gradedRowsFromCsv(f, colIndex),
                    loose: looseCol == null ? null : csvDollarsToUsd(f[looseCol]),
                });
            }
            gradedCsvRows = priceById.size;

            // Walk this category's mapped cards stalest-first, ALWAYS taking the head
            // of the ordering rather than an increasing OFFSET.
            //
            // Offset paging is broken here and silently so: stamping a page sets
            // last_priced_at = now, which moves those rows to the BACK of the sort, so
            // the window slides out from under the offset and every page after the
            // first skips ~GRADED_PAGE rows. Taking range(0, N-1) each time makes the
            // stamp itself the cursor — processed rows leave the head on their own.
            //
            // The `lt runStart` filter is what terminates the loop: rows stamped by
            // THIS run are excluded, so the query drains to empty exactly when the
            // category is done, instead of handing back the rows we just wrote.
            const runStart = new Date().toISOString();
            while (!gradedOverDeadline()) {
                const { data: maps, error: mapErr } = await supabase
                    .from('pricecharting_map')
                    .select('card_id, pricecharting_id')
                    .eq('game', gradedGame)
                    .or(`last_priced_at.is.null,last_priced_at.lt.${runStart}`)
                    .order('last_priced_at', { ascending: true, nullsFirst: true })
                    .order('card_id', { ascending: true })
                    .range(0, GRADED_PAGE - 1);
                if (mapErr) throw mapErr;
                if (!maps?.length) { gradedComplete = true; break; }
                gradedMapped += maps.length;

                // The market_values unique key includes language; reuse the card's market
                // language (ja -> jp) so refreshes update the same row the ingest wrote.
                // Chunked to stay clear of PostgREST's 1000-row response cap, which a full
                // page sits exactly on. A truncated lookup used to fail SILENTLY and badly:
                // every missing card fell back to 'en', writing English-language price rows
                // onto Japanese and Thai cards. Unresolved cards are now SKIPPED and counted
                // rather than defaulted, so a lookup gap can never mislabel a row again.
                // `game` must be written EXPLICITLY for the same reason `language` must. The
                // column is NOT NULL DEFAULT 'pokemon', and an upsert only assigns the columns
                // it supplies, so omitting it is silent on refreshes (the existing row keeps
                // its game) and wrong on inserts (a brand-new row takes the default). That made
                // the bug invisible until a non-Pokemon catalog first grew graded rows: the JA
                // Yu-Gi-Oh ingest put 1,318 `ygo-*` rows under game='pokemon' in Aug 2026.
                const pageIds = maps.map((m) => m.card_id);
                const langByCard = new Map<string, string>();
                const gameByCard = new Map<string, string>();
                const jpOnePiece = new Set<string>();
                for (let i = 0; i < pageIds.length; i += 500) {
                    const { data: cards } = await supabase
                        .from('pokemon_cards')
                        .select('id, language, game')
                        .in('id', pageIds.slice(i, i + 500));
                    for (const c of cards || []) {
                        langByCard.set(c.id, c.language === 'ja' ? 'jp' : (c.language || 'en'));
                        if (c.game) gameByCard.set(c.id, c.game);
                        if (c.game === 'onepiece' && c.language === 'ja') jpOnePiece.add(c.id);
                    }
                }

                const stamp = new Date().toISOString();
                const rows: any[] = [];
                const stamped: string[] = [];
                for (const m of maps) {
                    // Stamp EVERY row the page hands us, before any skip decision.
                    // A row that is considered but never stamped stays at the head of
                    // the stalest ordering, so the very next query returns it again and
                    // the loop spins on it forever. Both skips below are permanent
                    // conditions, not transient ones: an orphaned map row (card_id no
                    // longer in pokemon_cards) and an id the CSV has no graded price for
                    // would each re-appear every iteration. Leaving rows unstamped is
                    // also the shape of the original bug — the never-priced NULLs that
                    // sat at the head and starved every other category.
                    stamped.push(m.card_id);
                    const priced = priceById.get(String(m.pricecharting_id));
                    const lang = langByCard.get(m.card_id);
                    const game = gameByCard.get(m.card_id);
                    if (!lang || !game) { gradedUnresolved++; continue; }
                    if (!priced) continue;
                    for (const r of priced.graded) {
                        rows.push({
                            card_id: m.card_id, language: lang, game,
                            condition: r.condition, printing: null,
                            market_avg: r.usd, currency: 'USD', last_updated: stamp,
                        });
                    }
                    // JP One Piece has no JustTCG coverage, so PriceCharting's loose price
                    // is the only ungraded source — refresh the Raw_NM headline row too.
                    if (jpOnePiece.has(m.card_id) && priced.loose != null) {
                        rows.push({
                            card_id: m.card_id, language: lang, game,
                            condition: 'Raw_NM', printing: null,
                            market_avg: priced.loose, currency: 'USD', last_updated: stamp,
                        });
                    }
                }

                for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
                    const { error } = await supabase.from('market_values')
                        .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'card_id,language,condition' });
                    if (error) throw error;
                    gradedRows += Math.min(UPSERT_BATCH, rows.length - i);
                }
                // Stamp last. If the upserts above threw, these rows stay stale and are
                // retried next run rather than being marked done on a failed write.
                for (let i = 0; i < stamped.length; i += UPSERT_BATCH) {
                    const { error } = await supabase.from('pricecharting_map')
                        .update({ last_priced_at: stamp })
                        .in('card_id', stamped.slice(i, i + UPSERT_BATCH));
                    if (error) throw error;
                }
                gradedCards += stamped.length;

                if (maps.length < GRADED_PAGE) { gradedComplete = true; break; }
            }
        } catch (e: any) {
            if (errors.length < ERROR_SAMPLE_CAP) errors.push(`graded ${gradedCategory}: ${e.message}`);
        }
    }

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
        // Which category this run refreshed, and whether it drained it. `gradedComplete`
        // false means the deadline cut the category short; the next run resumes it,
        // because its unstamped rows are still the stalest in the table.
        gradedGame, gradedCategory, gradedComplete,
        gradedMapped,
        // CSV rows the vendor returned for the category. A sudden collapse here is the
        // signal that a category slug has gone bad — PriceCharting answers an unknown
        // category with an unrelated fallback rather than a 404.
        gradedCsvRows,
        // Mapped rows whose card_id no longer resolves in pokemon_cards. Small and flat
        // is fine; a jump means an ingest deleted cards without cleaning the map.
        gradedUnresolved,
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
