#!/usr/bin/env tsx
/**
 * Quick Sync Script for Pokemon TCG Data
 * 
 * This script syncs only the latest Pokemon sets (last 6 months)
 * Use this for regular updates after initial migration.
 * 
 * Usage:
 *   npx tsx scripts/sync-pokemon-data.ts
 */

import { createClient } from '@supabase/supabase-js';

const API_URL = 'https://api.pokemontcg.io/v2';
const HEADERS = { 'Accept': 'application/json' };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
    try {
        const response = await fetch(url, { headers: HEADERS });
        if (response.status === 429 && retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return fetchWithRetry(url, retries - 1);
        }
        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        return await response.json();
    } catch (error) {
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return fetchWithRetry(url, retries - 1);
        }
        throw error;
    }
}

async function syncLatestSets() {
    console.log('🔄 Syncing latest Pokemon sets...\n');

    // Get sets from last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const dateFilter = sixMonthsAgo.toISOString().split('T')[0];

    const { data: sets } = await fetchWithRetry(
        `${API_URL}/sets?orderBy=-releaseDate&pageSize=20`
    );

    const recentSets = (sets.data || []).filter((s: any) =>
        new Date(s.releaseDate) >= sixMonthsAgo
    );

    console.log(`📦 Found ${recentSets.length} sets to sync\n`);

    for (const set of recentSets) {
        console.log(`Syncing: ${set.name} (${set.id})`);

        // Upsert set
        await supabase.from('pokemon_sets').upsert({
            id: set.id,
            name: set.name,
            series: set.series,
            printed_total: set.printedTotal,
            total: set.total,
            release_date: set.releaseDate,
            symbol_url: set.images?.symbol,
            logo_url: set.images?.logo,
        });

        // Fetch and upsert cards
        const { data: cardsData } = await fetchWithRetry(
            `${API_URL}/cards?q=set.id:${set.id}&pageSize=250`
        );

        const cards = (cardsData.data || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            set_id: c.set.id,
            number: c.number,
            supertype: c.supertype,
            subtypes: c.subtypes || [],
            rarity: c.rarity,
            hp: c.hp ? parseInt(c.hp) : null,
            types: c.types || [],
            attacks: c.attacks || null,
            weaknesses: c.weaknesses || null,
            resistances: c.resistances || null,
            retreat_cost: c.retreatCost || [],
            abilities: c.abilities || null,
            rules: c.rules || [],
            regulation_mark: c.regulationMark || null,
            image_small: c.images?.small,
            image_large: c.images?.large,
            tcgplayer_url: c.tcgplayer?.url,
            cardmarket_url: c.cardmarket?.url,
            raw_data: c,
        }));

        if (cards.length > 0) {
            await supabase.from('pokemon_cards').upsert(cards);
            console.log(`   ✓ Synced ${cards.length} cards\n`);
        }
    }

    console.log('✅ Sync completed!');
}

syncLatestSets();
