import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// =====================================================================
// batch-price-english Edge Function (JustTCG)
//
// Uses EdgeRuntime.waitUntil() to respond immediately with HTTP 202,
// then continues pricing ALL English cards in the background — bypassing
// the 60s gateway timeout. The job runs for ~2 minutes across ~80 sets.
//
// API: JustTCG GET /v1/cards?game=pokemon&set={jtcgId}&conditions=NM
// Our DB set IDs → JustTCG set IDs via SET_ID_MAP below
// =====================================================================

// .trim() guards against a secret stored with trailing whitespace (parity with batch-price-games).
const JUSTTCG_API_KEY = (Deno.env.get('JUSTTCG_API_KEY') ?? '').trim();
const JUSTTCG_BASE = 'https://api.justtcg.com/v1';
const DELAY_MS = 1300; // safe under 50 req/min



function norm(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function jtcgFetch(path: string) {
    const r = await fetch(`${JUSTTCG_BASE}${path}`, {
        headers: { 'x-api-key': JUSTTCG_API_KEY, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`JustTCG ${r.status}: ${await r.text()}`);
    return r.json();
}

Deno.serve(async (req) => {
    // Parse request
    let targetSetId: string | null = null;
    let targetJustTCGId: string | null = null;
    try {
        const body = await req.json();
        if (body?.setId) targetSetId = body.setId;
        if (body?.justTCGId) targetJustTCGId = body.justTCGId;
    } catch (_) { /* no body is fine */ }

    const jobId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // ── Background job ──────────────────────────────────────────────────
    // Runs AFTER HTTP 202 is returned, bypassing the 60s gateway timeout
    async function runPricingJob() {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        try {
            // Get English set IDs from DB.
            // Enumerate pokemon_sets (147 rows), NOT pokemon_cards: the row-level
            // query silently capped at PostgREST's 1000-row limit, so the "all
            // sets" run only ever saw the handful of set_ids in an arbitrary
            // heap-order window — and since the catalog went multi-game,
            // language='en' alone matched ygo/mtg rows whose sets have no
            // JustTCG mapping, leaving entire runs pricing nothing.
            let dbSetIds: string[];
            if (targetSetId) {
                dbSetIds = [targetSetId];
            } else {
                const { data, error } = await supabase
                    .from('pokemon_sets')
                    .select('id')
                    .eq('game', 'pokemon')
                    .eq('language', 'en');
                if (error) throw new Error(`DB query failed: ${error.message}`);
                dbSetIds = (data ?? []).map((r: any) => r.id);
            }
            console.log(`[${jobId}] ${dbSetIds.length} English sets to price`);

            // Fetch dynamic slugs from DB
            const { data: configs, error: configErr } = await supabase
                .from('marketplace_configs')
                .select('set_id, justtcg_slug');
            if (configErr) throw new Error(`Config query failed: ${configErr.message}`);
            
            const dbSetIdMap: Record<string, string> = {};
            for (const row of configs || []) {
                dbSetIdMap[row.set_id] = row.justtcg_slug;
            }

            let totalPriced = 0;
            let apiCalls = 0;
            // Per-invocation safety cap, matching batch-price-games. One job
            // runs this nightly, so this is also the daily ceiling, against a
            // Professional-plan quota of 5K/day and 50K/month.
            //
            // 950 sat ~14x above real usage: the busiest night on record
            // (2026-08-04) priced 6,733 EN rows, which is ~68 calls at limit=100.
            // 250 keeps ~3.7x headroom over that peak.
            //
            // This cap is NOT what limits EN set coverage, and neither are
            // missing slugs (146 of 147 EN sets have a justtcg_slug; only `exu`
            // lacks one, and it has no JustTCG counterpart). Coverage is bound by
            // two other things: `dbSetIds` above is selected with NO .order(), so
            // the same leading sets win every night, and the run is killed by wall
            // clock (DELAY_MS between paginated calls) at roughly 60 of 147 sets
            // before the EdgeRuntime.waitUntil task ends. The pre-2017 tail has
            // therefore sat at its 2026-06-29 backfill stamp. The fix is the
            // stalest-first ordering batch-price-games got in v11, not a bigger
            // budget -- 60 sets is only ~180 calls, well under even this cap.
            const MAX_API_CALLS = 250;

            for (const dbSetId of dbSetIds) {
                if (apiCalls >= MAX_API_CALLS) { console.log('[limit] API call limit reached'); break; }

                const jtcgId = targetJustTCGId ?? dbSetIdMap[dbSetId] ?? null;
                if (!jtcgId) {
                    console.warn(`[skip] No JustTCG mapping for "${dbSetId}"`);
                    continue;
                }

                if (apiCalls > 0) await new Promise(r => setTimeout(r, DELAY_MS));

                try {
                    console.log(`[${apiCalls + 1}] ${dbSetId} → ${jtcgId}`);

                    // Paginate through ALL JustTCG results to get every card
                    // (sealed products come first and have number='N/A', cards appear later)
                    let allJtcgCards: any[] = [];
                    let offset = 0;
                    const limit = 100;
                    while (true) {
                        const resp = await jtcgFetch(
                            `/cards?game=pokemon&set=${encodeURIComponent(jtcgId)}&conditions=NM&include_price_history=false&limit=${limit}&offset=${offset}`
                        );
                        apiCalls++;
                        const page: any[] = resp.data ?? [];
                        allJtcgCards = allJtcgCards.concat(page);
                        if (!resp.meta?.hasMore || page.length < limit) break;
                        offset += limit;
                        if (apiCalls >= MAX_API_CALLS) break;
                        await new Promise(r => setTimeout(r, DELAY_MS));
                    }

                    // Filter out sealed products (they have number='N/A' or null)
                    const jtcgCards: any[] = allJtcgCards.filter(
                        (c: any) => c.number && c.number !== 'N/A'
                    );

                    if (!jtcgCards.length) { console.warn(`  [empty] No single cards found for ${jtcgId}`); continue; }


                    // Fetch our DB cards for this set (number + name for matching)
                    const { data: dbCards } = await supabase
                        .from('pokemon_cards')
                        .select('id, name, number')
                        .eq('set_id', dbSetId)
                        .eq('language', 'en');

                    const byNumber = new Map((dbCards ?? []).map((c: any) => [String(c.number), c]));
                    const byName = new Map((dbCards ?? []).map((c: any) => [norm(c.name), c]));

                    const rows: any[] = [];
                    for (const jCard of jtcgCards) {
                        // JustTCG numbers include total (e.g. '188/159'), strip the '/xxx' part
                        const rawNum = jCard.number?.toString() ?? '';
                        const strippedNum = rawNum.includes('/') ? rawNum.split('/')[0] : rawNum;
                        // Also try without leading zeros
                        const strippedNumNoZeros = strippedNum.replace(/^0+/, '');

                        const dbCard = byNumber.get(strippedNum)
                            ?? byNumber.get(strippedNumNoZeros)
                            ?? byName.get(norm(jCard.name ?? ''));
                        if (!dbCard) continue;

                        // Score variants to handle troll listings (e.g. $5000 fake 'Normal' NM with 0 sales)
                        const enVariants = (jCard.variants ?? []).filter((v: any) => v.language === 'English' || !v.language);

                        const sortedVariants = enVariants.sort((a: any, b: any) => {
                            let scoreA = 0;
                            let scoreB = 0;

                            // Massive priority to variants with confirmed market adoption (avgPrice > 0)
                            if (a.avgPrice > 0) scoreA += 1000;
                            if (b.avgPrice > 0) scoreB += 1000;

                            // Condition priority
                            if (a.condition === 'Near Mint' || a.condition === 'NM') scoreA += 500;
                            else if (a.condition === 'Lightly Played' || a.condition === 'LP') scoreA += 200;

                            if (b.condition === 'Near Mint' || b.condition === 'NM') scoreB += 500;
                            else if (b.condition === 'Lightly Played' || b.condition === 'LP') scoreB += 200;

                            // Printing priority (Holos are usually the legitimate chase listing)
                            if (a.printing === 'Holofoil') scoreA += 100;
                            else if (a.printing === 'Reverse Holofoil') scoreA += 50;

                            if (b.printing === 'Holofoil') scoreB += 100;
                            else if (b.printing === 'Reverse Holofoil') scoreB += 50;

                            // Tie-breaker: prioritize lower price if both have 0 sales, to avoid $5000 troll outliers
                            if (scoreA === scoreB && a.avgPrice === 0 && b.avgPrice === 0) {
                                return (a.price || 99999) - (b.price || 99999);
                            }

                            return scoreB - scoreA;
                        });

                        const bestVariant = sortedVariants[0] ?? (jCard.variants ?? [])[0];
                        const price = bestVariant?.avgPrice || bestVariant?.price || 0;
                        if (price <= 0) continue;

                        rows.push({
                            card_id: dbCard.id,
                            language: 'en',
                            condition: 'Raw_NM',
                            market_avg: price,
                            source_links: [`https://justtcg.com/card/${jCard.id}`],
                            source_prices: {
                                market_price: price,
                                low_price: bestVariant?.minPrice30d ?? 0,
                                high_price: bestVariant?.maxPrice30d ?? 0,
                                source: 'justtcg',
                            },
                            currency: 'USD',
                            last_updated: new Date().toISOString(),
                            last_priced_at: new Date().toISOString(),
                        });
                    }

                    if (rows.length > 0) {
                        const { error: upsertErr } = await supabase
                            .from('market_values')
                            .upsert(Array.from(new Map(rows.map(r => [r.card_id, r])).values()), { onConflict: 'card_id,language,condition' });
                        if (upsertErr) console.error(`  [error] upsert:`, upsertErr.message);
                    }

                    totalPriced += rows.length;
                    console.log(`  ✓ ${dbSetId}: ${rows.length}/${jtcgCards.length} priced (from ${allJtcgCards.length} total results)`);


                } catch (err: any) {
                    console.error(`  ✗ ${dbSetId}:`, err.message);
                    apiCalls++;
                }
            }

            console.log(`[${jobId}] === DONE: api_calls=${apiCalls} total_priced=${totalPriced} ===`);

        } catch (err: any) {
            console.error(`[${jobId}] Fatal error:`, err.message);
        }
    }

    // Return 202 immediately, run job in background
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== 'undefined') {
        // @ts-ignore
        EdgeRuntime.waitUntil(runPricingJob());
    } else {
        runPricingJob(); // local dev fallback (no-await)
    }

    return new Response(
        JSON.stringify({
            accepted: true,
            job_id: jobId,
            started_at: startedAt,
            target: targetSetId ? `set:${targetSetId}` : 'all_english_sets',
            message: 'Pricing job started in background. Check Supabase Edge Function logs for progress.',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
    );
});
