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

// ── Price history capture (parity with batch-price-games — change both) ──────
// The /cards pages already carry each variant's daily priceHistory when asked
// (include_price_history=true costs no extra API calls), so every set visit also
// refreshes that card's real price series in price_snapshots. 90d covers the gap
// between visits under the stalest-first rotation with room to spare, and each
// visit re-upserts its whole window, so a missed night self-heals.
const HISTORY_DURATION = '90d';
// Mirrors constants.tsx EXCHANGE_RATES (THB base, USD: 0.028) — an edge function
// cannot import from the Next.js tree, so change both together. price_snapshots
// stores THB normalized at capture time, matching the price-snapshots cron.
const THB_PER_USD = 1 / 0.028;

// Variant priceHistory [{p: usd, t: unixSeconds}] -> per-UTC-day CHANGE points.
// One point per day (latest wins), then days where the rounded THB value merely
// held are dropped — /api/price-history forward-fills the flat stretches at read
// time, so storing them would only bloat the table. First and last days always
// survive (the last keeps the series' freshness visible).
function historyChangePoints(history: any[]): { day: string; usd: number; thb: number }[] {
    const byDay = new Map<string, number>();
    for (const p of history ?? []) {
        if (typeof p?.p !== 'number' || p.p <= 0 || typeof p?.t !== 'number') continue;
        byDay.set(new Date(p.t * 1000).toISOString().slice(0, 10), p.p);
    }
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const out: { day: string; usd: number; thb: number }[] = [];
    for (let i = 0; i < days.length; i++) {
        const [day, usd] = days[i];
        const thb = Math.max(1, Math.round(usd * THB_PER_USD));
        if (i > 0 && i < days.length - 1 && thb === out[out.length - 1]?.thb) continue;
        out.push({ day, usd, thb });
    }
    return out;
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

                // Stalest-first ordering (the same fix batch-price-games got in
                // v11): never-priced sets lead, then sets ordered by their oldest
                // Raw_NM last_updated. Without this the unordered pokemon_sets
                // heap order let the same ~60 leading sets win every night while
                // the pre-2017 tail stayed frozen at its 2026-06-29 stamp.
                // Pricing a set stamps it fresh, so the queue self-rotates.
                //
                // THE PROBE MUST PAGE TO EXHAUSTION. `!seen.has(id)` only means "never
                // priced" when `seen` covers EVERY priced set. If the probe stops early
                // it means "no row in the window we happened to read" — which is the
                // exact opposite, the FRESHEST sets. At the old 10-page cap against
                // ~20k EN Raw_NM rows that inverted the queue: measured 2026-08-09, the
                // leading bucket was the 74 sets already stamped that morning, so they
                // took positions 0-73 every night and the genuinely stale tail began at
                // 74 — past where MAX_API_CALLS and the wall clock end the run. 5,310
                // rows across 50 pre-2017 sets sat at their 2026-03-04 stamp for five
                // months as a result. 50 pages is ~2.5x the current row count; the
                // `complete` guard below covers the day that stops being true.
                try {
                    const PROBE_PAGE_CAP = 50;
                    const firstSeen: string[] = [];
                    const seen = new Set<string>();
                    let complete = false;
                    for (let page = 0; page < PROBE_PAGE_CAP; page++) {
                        const { data: probe, error: probeErr } = await supabase
                            .from('market_values')
                            .select('last_updated, pokemon_cards!inner(set_id)')
                            .eq('game', 'pokemon')
                            .eq('language', 'en')
                            .eq('condition', 'Raw_NM')
                            .order('last_updated', { ascending: true })
                            .range(page * 1000, page * 1000 + 999);
                        if (probeErr) throw new Error(probeErr.message);
                        for (const r of (probe ?? []) as any[]) {
                            const sid = r.pokemon_cards?.set_id;
                            if (sid && !seen.has(sid)) { seen.add(sid); firstSeen.push(sid); }
                        }
                        if (!probe || probe.length < 1000) { complete = true; break; }
                    }
                    const known = new Set(dbSetIds);
                    const unseen = dbSetIds.filter((id) => !seen.has(id));
                    const stalest = firstSeen.filter((id) => known.has(id));
                    // Trust `unseen` as "never priced, most urgent" only on a complete
                    // probe. On a truncated one those sets are merely outside a partial
                    // window, so they go to the BACK, where guessing wrong costs nothing.
                    const ordered = complete ? [...unseen, ...stalest] : [...stalest, ...unseen];
                    if (!complete) {
                        console.warn(`probe hit its ${PROBE_PAGE_CAP}-page cap; ${unseen.length} unclassified sets sent to the back`);
                    }
                    const orderedSet = new Set(ordered);
                    dbSetIds = [...ordered, ...dbSetIds.filter((id) => !orderedSet.has(id))];
                    console.log(`[${jobId}] queue head: ${dbSetIds.slice(0, 8).join(', ')}`);
                } catch (e) {
                    console.warn('stalest-first probe failed; using default order:', (e as Error).message);
                }
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
            // lacks one, and it has no JustTCG counterpart). One run reaches only
            // ~60 of 147 sets, and what ends it is WALL CLOCK -- DELAY_MS between
            // paginated calls against the EdgeRuntime.waitUntil task lifetime --
            // not this budget (60 sets is ~180 calls, under even this cap).
            //
            // So a single night was never going to cover the catalog; what matters
            // is that the ~60 slots go to the sets that need them. That is the
            // stalest-first ordering above, and pricing a set stamps it fresh and
            // drops it to the back, so the queue rotates instead of starving.
            // Raising this number does not buy coverage -- the clock still stops
            // the run at the same place.
            const MAX_API_CALLS = 250;

            for (const dbSetId of dbSetIds) {
                if (apiCalls >= MAX_API_CALLS) { console.log('[limit] API call limit reached'); break; }

                const slugValue = targetJustTCGId ?? dbSetIdMap[dbSetId] ?? null;
                if (!slugValue) {
                    console.warn(`[skip] No JustTCG mapping for "${dbSetId}"`);
                    continue;
                }
                // A config may map one DB set to SEVERAL JustTCG sets
                // (comma-separated): JustTCG splits gallery subsets (Shiny
                // Vault, Trainer/Galarian Gallery, Radiant Collection) into
                // standalone sets, while our catalog keeps them as the parent
                // set's letter-numbered rows (SV###/GG##/TG##/RC#).
                const jtcgIds = String(slugValue).split(',').map((s) => s.trim()).filter(Boolean);

                if (apiCalls > 0) await new Promise(r => setTimeout(r, DELAY_MS));

                try {
                    console.log(`[${apiCalls + 1}] ${dbSetId} → ${jtcgIds.join(' + ')}`);

                    // Paginate through ALL JustTCG results to get every card
                    // (sealed products come first and have number='N/A', cards appear later)
                    let allJtcgCards: any[] = [];
                    const limit = 100;
                    for (const jtcgId of jtcgIds) {
                        let offset = 0;
                        while (true) {
                            const resp = await jtcgFetch(
                                `/cards?game=pokemon&set=${encodeURIComponent(jtcgId)}&conditions=NM&include_price_history=true&priceHistoryDuration=${HISTORY_DURATION}&limit=${limit}&offset=${offset}`
                            );
                            apiCalls++;
                            const page: any[] = resp.data ?? [];
                            allJtcgCards = allJtcgCards.concat(page);
                            if (!resp.meta?.hasMore || page.length < limit) break;
                            offset += limit;
                            if (apiCalls >= MAX_API_CALLS) break;
                            await new Promise(r => setTimeout(r, DELAY_MS));
                        }
                        if (apiCalls >= MAX_API_CALLS) break;
                        if (jtcgIds.length > 1) await new Promise(r => setTimeout(r, DELAY_MS));
                    }

                    // Filter out sealed products (they have number='N/A' or null)
                    const jtcgCards: any[] = allJtcgCards.filter(
                        (c: any) => c.number && c.number !== 'N/A'
                    );

                    if (!jtcgCards.length) { console.warn(`  [empty] No single cards found for ${jtcgIds.join(' + ')}`); continue; }


                    // Fetch our DB cards for this set (number + name for matching)
                    const { data: dbCards } = await supabase
                        .from('pokemon_cards')
                        .select('id, name, number')
                        .eq('set_id', dbSetId)
                        .eq('language', 'en');

                    const byNumber = new Map((dbCards ?? []).map((c: any) => [String(c.number), c]));
                    const byName = new Map((dbCards ?? []).map((c: any) => [norm(c.name), c]));

                    const rows: any[] = [];
                    // Keyed subject|day: two JustTCG cards matching the same DB card
                    // must not put the same conflict key twice into one upsert batch
                    // (Postgres errors).
                    const snapshotsByKey = new Map<string, any>();
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

                        // Same variant the headline price comes from, so the series
                        // joins the live "Now" point without a seam.
                        for (const pt of historyChangePoints(bestVariant?.priceHistory)) {
                            snapshotsByKey.set(`${dbCard.id}|${pt.day}`, {
                                subject_id: dbCard.id,
                                language: 'en',
                                condition: 'Market',
                                is_sealed: false,
                                market_thb: pt.thb,
                                market_native: pt.usd,
                                currency: 'USD',
                                source: 'justtcg',
                                captured_on: pt.day,
                            });
                        }

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

                    // Real history -> price_snapshots. Same-day rows (incl. 20260710
                    // estimates) are replaced via the daily conflict key. Fails soft:
                    // a snapshot error must never block the pricing pass.
                    const snapshotRows = [...snapshotsByKey.values()];
                    for (let i = 0; i < snapshotRows.length; i += 1000) {
                        const { error: snapErr } = await supabase
                            .from('price_snapshots')
                            .upsert(snapshotRows.slice(i, i + 1000), { onConflict: 'subject_id,language,condition,captured_on' });
                        if (snapErr) { console.error(`  [error] snapshots:`, snapErr.message); break; }
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
