import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// ---------------------------------------------------------------------------
// Rarity Table (from Rarity Table - Sheet1.csv)
// Maps Thai/JP rarity symbols → English rarity names
// PB and EH have NO English equivalent, so they get no rarity filter when matching.
// ---------------------------------------------------------------------------
const RARITY_MAP: Record<string, string[]> = {
    'C': ['Common'],
    'U': ['Uncommon'],
    'R': ['Rare'],
    'RR': ['Double Rare'],
    'SR': ['Ultra Rare'],
    'AR': ['Illustration Rare'],
    'SAR': ['Special Illustration Rare'],
    'UR': ['Hyper Rare'],
    // Pass-through if Thai already uses English names
    'Common': ['Common'],
    'Uncommon': ['Uncommon'],
    'Rare': ['Rare'],
    'Double Rare': ['Double Rare'],
    'Ultra Rare': ['Ultra Rare'],
    'Illustration Rare': ['Illustration Rare'],
    'Special Illustration Rare': ['Special Illustration Rare'],
    'Hyper Rare': ['Hyper Rare'],
};

// PB / EH have no English equivalent — match only by card number, ignore rarity
const NO_EN_RARITY = new Set(['PB', 'EH']);

function mapRarityToEnglish(thaiRarity: string): string[] | null {
    if (NO_EN_RARITY.has(thaiRarity)) return null; // null = skip rarity filter
    return RARITY_MAP[thaiRarity] ?? [thaiRarity];
}

// ---------------------------------------------------------------------------
// Levenshtein / similarity helpers
// ---------------------------------------------------------------------------
function levenshteinDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]);
        }
    }
    return dp[m][n];
}

function similarity(a: string, b: string): number {
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length < b.length ? a : b;
    if (longer.length === 0) return 1.0;
    const dist = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
    return (longer.length - dist) / longer.length;
}

// ---------------------------------------------------------------------------
// Normalise a card number for comparison
// e.g. "001" → "1", "012a" → "12a"
// ---------------------------------------------------------------------------
function normaliseNumber(n: string): string {
    // Strip leading zeros but keep trailing letters (e.g. 012a → 12a)
    return n.replace(/^0+(\d)/, '$1').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (_req) => {
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const stats = { matched: 0, skipped: 0, failed: 0, already_mapped: 0 };
    const log: any[] = [];

    try {
        // ------------------------------------------------------------------
        // 1. Load set_bridge — all Thai→English set pairs
        // ------------------------------------------------------------------
        const { data: bridgeRows, error: bridgeErr } = await supabase
            .from('set_bridge')
            .select('thai_set_id, english_set_id');


        if (bridgeErr || !bridgeRows?.length) {
            return new Response(
                JSON.stringify({ error: 'set_bridge is empty or unreadable. Run 20260304_seed_set_bridge.sql first.', bridgeErr }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Build map: thai_set_id → [english_set_id, ...] (a Thai set can map to multiple EN sets)
        const thaiToEnSets: Record<string, string[]> = {};
        for (const row of bridgeRows) {
            if (!row.english_set_id) continue; // skip unresolved rows
            if (!thaiToEnSets[row.thai_set_id]) thaiToEnSets[row.thai_set_id] = [];
            thaiToEnSets[row.thai_set_id].push(row.english_set_id);
        }

        const thaiSetIds = Object.keys(thaiToEnSets);
        console.log(`set_bridge loaded: ${thaiSetIds.length} Thai sets with resolved English counterparts`);

        // ------------------------------------------------------------------
        // 2. Load all Thai cards from tracked sets (not yet mapped)
        // ------------------------------------------------------------------
        // Get already-mapped thai card IDs
        const { data: existingMappings } = await supabase
            .from('card_mappings')
            .select('card_id_th');

        const alreadyMapped = new Set((existingMappings ?? []).map((m: any) => m.card_id_th));
        stats.already_mapped = alreadyMapped.size;
        console.log(`Already mapped: ${alreadyMapped.size} Thai cards`);

        // Fetch all Thai cards from tracked sets (all of them, filter in memory below)
        let allThaiCards: any[] = [];
        let page = 0;
        const PAGE = 1000;
        while (true) {
            const { data, error } = await supabase
                .from('pokemon_cards')
                .select('id, name, english_name, number, rarity, set_id')
                .eq('language', 'th')
                .in('set_id', thaiSetIds)
                .range(page * PAGE, (page + 1) * PAGE - 1);

            if (error || !data?.length) break;
            allThaiCards = allThaiCards.concat(data);
            if (data.length < PAGE) break;
            page++;
        }

        // Filter out already-mapped cards in memory (avoids large .not().in() query)
        allThaiCards = allThaiCards.filter(c => !alreadyMapped.has(c.id));


        console.log(`Unmatched Thai cards to process: ${allThaiCards.length}`);

        // ------------------------------------------------------------------
        // 3. Pre-load all English cards for the relevant sets
        // ------------------------------------------------------------------
        // Collect all English set IDs we need
        const allEnSetIds = [...new Set(Object.values(thaiToEnSets).flat())];

        let allEnCards: any[] = [];
        page = 0;
        while (true) {
            const { data, error } = await supabase
                .from('pokemon_cards')
                .select('id, name, number, rarity, set_id')
                .eq('language', 'en')
                .in('set_id', allEnSetIds)
                .range(page * PAGE, (page + 1) * PAGE - 1);

            if (error || !data?.length) break;
            allEnCards = allEnCards.concat(data);
            if (data.length < PAGE) break;
            page++;
        }

        console.log(`English candidate pool: ${allEnCards.length} cards`);

        // Index English cards by set_id for fast lookup
        const enBySet: Record<string, any[]> = {};
        for (const c of allEnCards) {
            if (!enBySet[c.set_id]) enBySet[c.set_id] = [];
            enBySet[c.set_id].push(c);
        }

        // ------------------------------------------------------------------
        // 4. Matching loop
        // Strategy (in priority order):
        //   A. Card number + rarity match within the bridged English set(s)
        //   B. Card number match only (for PB/EH, or when rarity yields no results)
        //   C. Name similarity ≥ 0.85 + same number as tiebreaker
        // ------------------------------------------------------------------
        const toInsert: any[] = [];

        for (const thaiCard of allThaiCards) {
            const enSetIds = thaiToEnSets[thaiCard.set_id];
            if (!enSetIds?.length) {
                stats.skipped++;
                continue;
            }

            const thaiNum = normaliseNumber(thaiCard.number ?? '');
            const englishRarities = mapRarityToEnglish(thaiCard.rarity);
            const isNoRarityMatch = englishRarities === null; // PB or EH

            let bestMatch: any = null;
            let bestConfidence = 0;
            let matchMethod = '';

            for (const enSetId of enSetIds) {
                const candidates = enBySet[enSetId] ?? [];

                // (A) Number + rarity match
                if (!isNoRarityMatch && englishRarities) {
                    const byNumRarity = candidates.filter(c =>
                        normaliseNumber(c.number ?? '') === thaiNum &&
                        englishRarities.some(r => r.toLowerCase() === (c.rarity ?? '').toLowerCase())
                    );

                    if (byNumRarity.length === 1) {
                        bestMatch = byNumRarity[0];
                        bestConfidence = 1.0;
                        matchMethod = 'number_rarity';
                        break;
                    }

                    // Multiple hits → apply name similarity tiebreaker
                    if (byNumRarity.length > 1) {
                        const searchName = (thaiCard.english_name ?? thaiCard.name ?? '').toLowerCase();
                        let topSim = 0;
                        for (const c of byNumRarity) {
                            const sim = similarity(searchName, c.name.toLowerCase());
                            if (sim > topSim) { topSim = sim; bestMatch = c; }
                        }
                        bestConfidence = topSim;
                        matchMethod = 'number_rarity_name';
                        if (topSim >= 0.85) break;
                    }
                }

                // (B) Number-only match (covers PB/EH and rarity ambiguity)
                const byNum = candidates.filter(c =>
                    normaliseNumber(c.number ?? '') === thaiNum
                );

                if (byNum.length === 1 && bestConfidence < 0.9) {
                    // Single number match is fairly reliable
                    bestMatch = byNum[0];
                    bestConfidence = isNoRarityMatch ? 0.9 : 0.75;
                    matchMethod = isNoRarityMatch ? 'number_only_pb_eh' : 'number_only';
                } else if (byNum.length > 1) {
                    // Multiple number hits — apply name similarity
                    const searchName = (thaiCard.english_name ?? thaiCard.name ?? '').toLowerCase();
                    for (const c of byNum) {
                        const sim = similarity(searchName, c.name.toLowerCase());
                        if (sim > bestConfidence) {
                            bestConfidence = sim;
                            bestMatch = c;
                            matchMethod = 'number_name_fuzzy';
                        }
                    }
                }

                // (C) Name similarity fallback (only if no number match found)
                if (!bestMatch && thaiCard.english_name) {
                    const searchName = thaiCard.english_name.toLowerCase();
                    for (const c of candidates) {
                        const sim = similarity(searchName, c.name.toLowerCase());
                        if (sim >= 0.85 && sim > bestConfidence) {
                            bestConfidence = sim;
                            bestMatch = c;
                            matchMethod = 'name_fuzzy';
                        }
                    }
                }
            }

            if (bestMatch && bestConfidence >= 0.75) {
                toInsert.push({
                    card_id_th: thaiCard.id,
                    card_id_en: bestMatch.id,
                    match_method: matchMethod,
                    confidence_score: Math.min(1.0, parseFloat(bestConfidence.toFixed(2))),
                    verified: false,
                });
                stats.matched++;

                if (log.length < 50) {
                    log.push({
                        thai: `${thaiCard.set_id}#${thaiCard.number} ${thaiCard.english_name ?? thaiCard.name} [${thaiCard.rarity}]`,
                        en: `${bestMatch.set_id}#${bestMatch.number} ${bestMatch.name} [${bestMatch.rarity}]`,
                        method: matchMethod,
                        confidence: bestConfidence.toFixed(2),
                    });
                }
            } else {
                stats.skipped++;
            }
        }

        // ------------------------------------------------------------------
        // 5. Bulk insert matches into card_mappings
        // ------------------------------------------------------------------
        if (toInsert.length > 0) {
            const CHUNK = 500;
            for (let i = 0; i < toInsert.length; i += CHUNK) {
                const chunk = toInsert.slice(i, i + CHUNK);
                const { error: insertErr } = await supabase
                    .from('card_mappings')
                    .upsert(chunk, { onConflict: 'card_id_th' });

                if (insertErr) {
                    console.error('Insert chunk error:', insertErr);
                    stats.failed += chunk.length;
                    stats.matched -= chunk.length;
                }
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                stats,
                sample_matches: log,
                timestamp: new Date().toISOString(),
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        console.error('Fatal:', err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
})
