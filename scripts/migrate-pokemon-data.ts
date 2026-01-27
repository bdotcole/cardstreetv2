#!/usr/bin/env tsx
/**
 * Pokemon TCG Data Migration Script
 * 
 * This script fetches all Pokemon sets and cards from the Pokemon TCG API
 * and imports them into Supabase for improved performance.
 * 
 * Usage:
 *   npx tsx scripts/migrate-pokemon-data.ts
 * 
 * Environment variables required:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

// Configuration
const MIGRATION_CONFIG = {
    batchSize: 100,
    maxRetries: 4,
    initialBackoff: 1200,
    setsFilter: null as string[] | null, // e.g., ['sv4pt5', 'sv4'] to migrate specific sets
};

const API_URL = 'https://api.pokemontcg.io/v2';
const HEADERS = {
    'Accept': 'application/json',
};

// Initialize Supabase client with service role key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Fetch with retry logic for rate limiting
async function fetchWithRetry(
    url: string,
    retries = MIGRATION_CONFIG.maxRetries,
    backoff = MIGRATION_CONFIG.initialBackoff
): Promise<any> {
    try {
        const response = await fetch(url, { headers: HEADERS });

        if (response.status === 429) {
            if (retries > 0) {
                const retryAfter = response.headers.get('Retry-After');
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
                console.warn(`⏳ Rate limited. Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return fetchWithRetry(url, retries - 1, backoff * 2);
            }
            throw new Error('Rate limit exceeded. Please try again later.');
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
    } catch (error: any) {
        const isNetworkError = error instanceof TypeError ||
            error.message?.includes('Failed to fetch') ||
            error.message?.includes('network');

        if (retries > 0 && isNetworkError) {
            console.warn(`🔄 Network error. Retrying in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            return fetchWithRetry(url, retries - 1, backoff * 2);
        }
        throw error;
    }
}

// Fetch all sets from the API
async function fetchAllSets(): Promise<any[]> {
    console.log('📦 Fetching all Pokemon sets...');

    let page = 1;
    let allSets: any[] = [];
    let hasMore = true;

    while (hasMore) {
        const url = `${API_URL}/sets?page=${page}&pageSize=250&orderBy=releaseDate`;
        const data = await fetchWithRetry(url);

        if (data.data && data.data.length > 0) {
            allSets = allSets.concat(data.data);
            console.log(`   ✓ Fetched page ${page}: ${data.data.length} sets (Total: ${allSets.length})`);

            // Check if there are more pages
            hasMore = data.data.length === 250;
            page++;
        } else {
            hasMore = false;
        }
    }

    // Apply filter if specified
    if (MIGRATION_CONFIG.setsFilter) {
        allSets = allSets.filter(set => MIGRATION_CONFIG.setsFilter!.includes(set.id));
        console.log(`   🔍 Filtered to ${allSets.length} sets`);
    }

    return allSets;
}

// Fetch all cards for a specific set
async function fetchCardsForSet(setId: string): Promise<any[]> {
    let page = 1;
    let allCards: any[] = [];
    let hasMore = true;

    while (hasMore) {
        const url = `${API_URL}/cards?q=set.id:${setId}&page=${page}&pageSize=250&orderBy=number`;
        const data = await fetchWithRetry(url);

        if (data.data && data.data.length > 0) {
            allCards = allCards.concat(data.data);

            // Check if there are more pages
            hasMore = data.data.length === 250;
            page++;
        } else {
            hasMore = false;
        }
    }

    return allCards;
}

// Transform set data for Supabase
function transformSet(apiSet: any) {
    return {
        id: apiSet.id,
        name: apiSet.name,
        series: apiSet.series,
        printed_total: apiSet.printedTotal,
        total: apiSet.total,
        release_date: apiSet.releaseDate,
        symbol_url: apiSet.images?.symbol || null,
        logo_url: apiSet.images?.logo || null,
    };
}

// Transform card data for Supabase
function transformCard(apiCard: any) {
    return {
        id: apiCard.id,
        name: apiCard.name,
        set_id: apiCard.set.id,
        number: apiCard.number,
        supertype: apiCard.supertype,
        subtypes: apiCard.subtypes || [],
        rarity: apiCard.rarity || null,
        hp: apiCard.hp ? parseInt(apiCard.hp) : null,
        types: apiCard.types || [],
        attacks: apiCard.attacks || null,
        weaknesses: apiCard.weaknesses || null,
        resistances: apiCard.resistances || null,
        retreat_cost: apiCard.retreatCost || [],
        abilities: apiCard.abilities || null,
        rules: apiCard.rules || [],
        regulation_mark: apiCard.regulationMark || null,
        image_small: apiCard.images?.small || null,
        image_large: apiCard.images?.large || null,
        tcgplayer_url: apiCard.tcgplayer?.url || null,
        cardmarket_url: apiCard.cardmarket?.url || null,
        raw_data: apiCard, // Store full API response for prices and future-proofing
    };
}

// Batch upsert data to Supabase
async function batchUpsert<T>(
    table: string,
    data: T[],
    batchSize = MIGRATION_CONFIG.batchSize
): Promise<void> {
    for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);

        const { error } = await supabase
            .from(table)
            .upsert(batch, { onConflict: 'id' });

        if (error) {
            console.error(`❌ Error upserting batch to ${table}:`, error);
            throw error;
        }

        console.log(`   ✓ Upserted ${i + batch.length}/${data.length} records to ${table}`);
    }
}

// Check which sets already exist in Supabase
async function getExistingSets(): Promise<Set<string>> {
    const { data, error } = await supabase
        .from('pokemon_sets')
        .select('id');

    if (error) {
        console.warn('⚠️  Could not fetch existing sets:', error);
        return new Set();
    }

    return new Set((data || []).map((s: any) => s.id));
}

// Main migration function
async function migrate() {
    console.log('🚀 Starting Pokemon TCG data migration...\n');

    try {
        // Step 1: Fetch all sets from API
        const sets = await fetchAllSets();
        console.log(`\n✅ Total sets to migrate: ${sets.length}\n`);

        // Step 2: Transform and insert sets
        console.log('💾 Importing sets to Supabase...');
        const transformedSets = sets.map(transformSet);
        await batchUpsert('pokemon_sets', transformedSets);
        console.log(`✅ Successfully imported ${transformedSets.length} sets\n`);

        // Step 3: Check for existing sets to support resume capability
        const existingSets = await getExistingSets();

        // Step 4: Fetch and insert cards for each set
        let totalCards = 0;
        let skippedSets = 0;

        for (let i = 0; i < sets.length; i++) {
            const set = sets[i];

            // Check if we should skip this set (for resume capability)
            // Note: This is a simple check. For more robust resume, track card counts

            console.log(`\n[${i + 1}/${sets.length}] Processing set: ${set.name} (${set.id})`);
            console.log(`   📥 Fetching cards...`);

            const cards = await fetchCardsForSet(set.id);
            console.log(`   📝 Found ${cards.length} cards`);

            if (cards.length > 0) {
                console.log(`   💾 Importing to Supabase...`);
                const transformedCards = cards.map(transformCard);
                await batchUpsert('pokemon_cards', transformedCards);
                totalCards += cards.length;
                console.log(`   ✅ Imported ${cards.length} cards`);
            }

            // Progress indicator
            console.log(`   Progress: ${((i + 1) / sets.length * 100).toFixed(1)}% complete`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('🎉 Migration completed successfully!');
        console.log('='.repeat(60));
        console.log(`📊 Summary:`);
        console.log(`   - Sets imported: ${sets.length}`);
        console.log(`   - Cards imported: ${totalCards}`);
        console.log(`   - Average cards per set: ${(totalCards / sets.length).toFixed(1)}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run the migration
migrate();
