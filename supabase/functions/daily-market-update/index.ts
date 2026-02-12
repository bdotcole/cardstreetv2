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
async function fetchJustTCGPrice(cardName: string, language: 'en' | 'jp'): Promise<number | null> {
    try {
        const url = `https://api.justtcg.com/v1/prices/search?q=${encodeURIComponent(cardName)}&game=pokemon&language=${language}`;

        const response = await fetch(url, {
            headers: {
                'x-api-key': Deno.env.get('JUSTTCG_API_KEY') || '',
            },
        });

        if (!response.ok) return null;

        const data = await response.json();

        if (data.success && data.data && data.data.length > 0) {
            const nmPrices = data.data.filter((p: any) => p.condition === 'NM');
            const prices = nmPrices.length > 0 ? nmPrices : data.data;
            const sum = prices.reduce((acc: number, p: any) => acc + p.market_price, 0);
            return sum / prices.length;
        }

        return null;
    } catch (error) {
        console.error('JustTCG error:', error);
        return null;
    }
}

// Fetch prices from PokeData++
async function fetchPokeDataPrice(cardName: string): Promise<number | null> {
    try {
        const url = `https://pokedata-api.p.rapidapi.com/cards/search?name=${encodeURIComponent(cardName)}`;

        const response = await fetch(url, {
            headers: {
                'X-RapidAPI-Key': Deno.env.get('RAPIDAPI_KEY') || '',
                'X-RapidAPI-Host': 'pokedata-api.p.rapidapi.com',
            },
        });

        if (!response.ok) return null;

        const data = await response.json();

        if (data.success && data.data && data.data.length > 0) {
            const validPrices = data.data
                .filter((p: any) => p.market_price > 0)
                .map((p: any) => p.market_price);

            if (validPrices.length === 0) return null;

            const sum = validPrices.reduce((acc: number, p: number) => acc + p, 0);
            return sum / validPrices.length;
        }

        return null;
    } catch (error) {
        console.error('PokeData++ error:', error);
        return null;
    }
}

// Main handler
serve(async (req) => {
    try {
        // Create Supabase client
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        console.log('Starting daily market data update...');

        let mapped = 0;
        let priced = 0;
        let failed = 0;

        // Step 1: Get Thai cards from specific sets that need matching
        const thaiSetsToMatch = ['MA1', 'MA2', 'SV10s', 'SV9s', 'SV11s'];

        // Optimize: Fetch ALL target cards first (dataset is small, ~1000 cards)
        // This avoids the "URL too long" error from passing thousands of IDs to a .not.in() filter
        let allTargetCards: any[] = [];
        let page = 0;
        const pageSize = 1000;

        while (true) {
            const { data, error } = await supabase
                .from('pokemon_cards')
                .select('*, pokemon_sets!inner(release_date)')
                .eq('language', 'th')
                .in('set_id', thaiSetsToMatch)
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                throw new Error(`Failed to fetch Thai cards: ${error.message}`);
            }
            if (!data || data.length === 0) break;
            allTargetCards = allTargetCards.concat(data);
            if (data.length < pageSize) break;
            page++;
        }

        console.log(`Fetched ${allTargetCards.length} candidates from target sets.`);

        // Find which ones are already mapped in chunks
        const cardIds = allTargetCards.map(c => c.id);
        const mappedSet = new Set<string>();
        const chunkSz = 200; // Safe chunk size for URL length

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

        // Filter out mapped cards in memory and SHUFFLE to avoid getting stuck on unmatchable cards
        const thaiCards = allTargetCards
            .filter(c => !mappedSet.has(c.id))
            .sort(() => Math.random() - 0.5)
            .slice(0, 50); // Process 50 at a time

        console.log(`Found ${mappedSet.size} existing mappings for these sets.`);
        console.log(`Processing ${thaiCards.length} unmapped Thai cards...`);

        // Strict Rarity Mapping Function
        function getStrictEnglishRarity(thaiRarity: string): string[] {
            const map: { [key: string]: string[] } = {
                // Standard mappings
                'C': ['Common', 'common'],
                'Common': ['Common', 'common'],
                'U': ['Uncommon', 'uncommon'],
                'Uncommon': ['Uncommon', 'uncommon'],
                'R': ['Rare', 'rare'],
                'Rare': ['Rare', 'rare'],
                'RR': ['Double Rare', 'Double rare'],
                'Double Rare': ['Double Rare', 'Double rare'],

                // Specific requested mappings
                'SR': ['Ultra Rare', 'Ultra rare'],
                'Super Rare': ['Ultra Rare', 'Ultra rare'],
                'UR': ['Hyper Rare', 'Hyper rare'],
                'Ultra Rare': ['Hyper Rare', 'Hyper rare'], // Handles if Thai card uses English rarity name
                'AR': ['Illustration Rare', 'Illustration rare', 'Art Rare'],
                'Art Rare': ['Illustration Rare', 'Illustration rare', 'Art Rare'],
                'SAR': ['Special Illustration Rare', 'Special illustration rare', 'Special Art Rare'],
                'Special Art Rare': ['Special Illustration Rare', 'Special illustration rare'],
                'Secret Rare': ['Ultra Rare', 'Hyper Rare', 'Secret Rare']
            };
            return map[thaiRarity] || [];
        }

        // Step 2: Match Thai cards to EN (Strict Logic)
        for (const thaiCard of thaiCards || []) {
            // Check if already mapped
            const { data: existingMapping } = await supabase
                .from('card_mappings')
                .select('*')
                .eq('card_id_th', thaiCard.id)
                .single();

            if (existingMapping) continue;

            if (thaiCard.english_name) {
                const targetRarities = getStrictEnglishRarity(thaiCard.rarity);

                if (targetRarities.length === 0) {
                    // console.log(`Skipping ${thaiCard.name} (${thaiCard.id}) - Unknown rarity: ${thaiCard.rarity}`);
                    continue;
                }

                const strictSetMapping: { [key: string]: string | string[] } = {
                    'MA2': 'me02', // Phantasmal Flames
                    'MA1': 'me01', // Mega Evolution
                    'SV10s': 'sv10', // Destined Rivals
                    'SV9s': 'sv09', // Journey Together
                    'SV11s': ['sv10.5b', 'sv10.5w'] // Black Bolt & White Flare
                };

                const targetSetId = strictSetMapping[thaiCard.set_id];
                let searchSetIds: string[] | null = null;

                if (targetSetId) {
                    if (Array.isArray(targetSetId)) {
                        searchSetIds = targetSetId;
                        // console.log(`Using strict set mapping: ${thaiCard.set_id} -> [${targetSetId.join(', ')}]`);
                    } else {
                        searchSetIds = [targetSetId];
                        // console.log(`Using strict set mapping: ${thaiCard.set_id} -> ${targetSetId}`);
                    }
                }

                // Query for English cards with EXACT name match and strict rarity
                let query = supabase
                    .from('pokemon_cards')
                    .select('*, pokemon_sets!inner(release_date)')
                    .eq('language', 'en')
                    .in('rarity', targetRarities)
                    .ilike('name', thaiCard.english_name.trim());

                // If specific set mapped, filter by it
                if (searchSetIds) {
                    query = query.in('set_id', searchSetIds);
                }

                const { data: enCards } = await query;

                if (enCards && enCards.length > 0) {
                    let bestMatch = null;

                    for (const enCard of enCards) {
                        // If we used strict set mapping, we skip the date check
                        if (searchSetIds) {
                            bestMatch = enCard;
                            console.log(`✓ Strict Set Match: ${thaiCard.english_name} (${thaiCard.set_id}) -> ${enCard.name} (${enCard.set_id})`);
                            break;
                        }

                        // Otherwise, use Release Date Window (3 months)
                        let isDateValid = false;
                        let monthsDiff = 999;

                        if (thaiCard.pokemon_sets?.release_date && enCard.pokemon_sets?.release_date) {
                            const thaiDate = new Date(thaiCard.pokemon_sets.release_date);
                            const enDate = new Date(enCard.pokemon_sets.release_date);

                            const diffTime = Math.abs(thaiDate.getTime() - enDate.getTime());
                            monthsDiff = diffTime / (1000 * 60 * 60 * 24 * 30);

                            isDateValid = monthsDiff <= 3.0; // Strict 3 month window
                        }

                        if (isDateValid) {
                            bestMatch = enCard;
                            console.log(`✓ Date Match: ${thaiCard.english_name} (${thaiCard.set_id}) -> ${enCard.name} (${enCard.set_id}) [Diff: ${monthsDiff.toFixed(1)}mo]`);
                            break;
                        }
                    }

                    if (bestMatch) {
                        await supabase.from('card_mappings').insert({
                            card_id_th: thaiCard.id,
                            card_id_en: bestMatch.id,
                            match_method: searchSetIds ? 'strict_set_map' : 'strict_name_rarity_date_v2',
                            confidence_score: 1.0,
                            verified: true, // Auto-verify strict matches
                        });
                        mapped++;
                    }
                }
            }
        }

        // Step 3: Comprehensive Pricing Snapshot
        // Iterate through ALL cards in target sets to ensure every single one has a price
        // Priority: Mapped EN/JP Price -> Default 10 THB

        console.log('Starting comprehensive pricing snapshot...');

        // 1. Get a batch of cards from target sets
        // We fetch 200 candidates and filter in memory to avoid complex join filters that might fail or hit URL limits
        const { data: cardsToPrice, error: cardsError } = await supabase
            .from('pokemon_cards')
            .select('id, name, set_id, language')
            .in('set_id', thaiSetsToMatch) // MA1, MA2, SV10s, SV9s, SV11s
            .eq('language', 'th')
            .limit(200);

        if (cardsError) {
            console.error('Error fetching cards to price:', cardsError);
        }

        let pricingCandidates = cardsToPrice || [];

        // Shuffle to ensure we cover different cards over time
        pricingCandidates.sort(() => Math.random() - 0.5);

        // Take top 50
        const unpricedCandidates = pricingCandidates.slice(0, 50);

        console.log(`Force checking prices for ${unpricedCandidates.length} candidates...`);

        for (const card of unpricedCandidates) {
            try {
                // Check if mapped
                const { data: mapping } = await supabase
                    .from('card_mappings')
                    .select('card_id_en, card_id_jp')
                    .eq('card_id_th', card.id)
                    .single();

                let calculatedPrice = 0;
                let pricingMethod = 'default_floor';
                let sourceLinks = [];

                if (mapping) {
                    // 1. Try English Price
                    if (mapping.card_id_en) {
                        const { data: enCard } = await supabase
                            .from('pokemon_cards')
                            .select('name')
                            .eq('id', mapping.card_id_en)
                            .single();

                        if (enCard) {
                            const [justTcgPrice, pokeDataPrice] = await Promise.all([
                                fetchJustTCGPrice(enCard.name, 'en'),
                                fetchPokeDataPrice(enCard.name),
                            ]);

                            const prices = [];
                            if (justTcgPrice) prices.push({ price: justTcgPrice, weight: 0.6 });
                            if (pokeDataPrice) prices.push({ price: pokeDataPrice, weight: 0.4 });

                            if (prices.length > 0) {
                                const totalWeight = prices.reduce((sum, p) => sum + p.weight, 0);
                                const weightedSum = prices.reduce((sum, p) => sum + (p.price * p.weight), 0);
                                const enAvg = weightedSum / totalWeight;
                                calculatedPrice = enAvg * 0.6 * 35.85; // USD -> THB (approx rate) * 0.6 factor
                                pricingMethod = 'en_0.6x';
                                sourceLinks = ['JustTCG', 'PokeData++'];
                                console.log(`Price found for ${card.name} (EN): ${calculatedPrice.toFixed(2)} THB`);
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
                                console.log(`Price found for ${card.name} (JP): ${calculatedPrice.toFixed(2)} THB`);
                            }
                        }
                    }
                }

                // 3. Apply Minimum Floor & Default
                // If no price found (unmapped or API fail), default to 10 THB
                // If price found but < 10 THB, floor at 10 THB
                const finalPrice = Math.max(Math.round(calculatedPrice), 10);

                if (calculatedPrice === 0) {
                    console.log(`Using default 10 THB for ${card.name} (${card.id})`);
                } else if (finalPrice === 10 && calculatedPrice < 10) {
                    console.log(`Flooring price to 10 THB for ${card.name} (calc: ${calculatedPrice.toFixed(2)})`);
                }

                // Upsert into market_values
                await supabase.from('market_values').upsert({
                    card_id: card.id,
                    language: 'th',
                    condition: 'Raw_NM',
                    market_avg: finalPrice,
                    source_links: sourceLinks,
                    source_prices: { raw_calculated: calculatedPrice, method: pricingMethod },
                    currency: 'THB',
                    last_updated: new Date().toISOString()
                }, { onConflict: 'card_id, language, condition' });

                priced++;

            } catch (error) {
                console.error(`Failed to price card ${card.id}:`, error);
                failed++;
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                mapped,
                priced,
                failed,
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
