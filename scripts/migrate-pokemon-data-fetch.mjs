/**
 * Pokemon TCG Migration using Node 18+ fetch
 * Run with: node scripts/migrate-pokemon-data-fetch.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');

// Load .env.local
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (match) {
            process.env[match[1].trim()] = match[2].trim();
        }
    });
    console.log('✅ Loaded environment variables\n');
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_URL = 'https://api.pokemontcg.io/v2';
const POKEMON_API_KEY = '03760b8b-36b7-429b-96d2-43b96b1fdec2';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
}

// Fetch with retry
async function fetchWithRetry(url, retries = 5, backoff = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            // Add a small random jitter to avoid synchronized requests
            const jitter = Math.random() * 2000;
            if (i > 0) {
                console.log(`   (Waiting ${((backoff + jitter) / 1000).toFixed(1)}s before retry ${i}/${retries})`);
                await new Promise(r => setTimeout(r, backoff + jitter));
            }

            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'X-Api-Key': POKEMON_API_KEY,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': 'https://pokemontcg.io/',
                    'Origin': 'https://pokemontcg.io',
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(30000) // 30 second timeout
            });

            if (response.status === 429 || response.status === 504 || response.status === 502) {
                const waitTime = response.status === 429 ? 10000 : backoff;
                console.warn(`⏳ API ${response.status} (instability). Retrying...`);
                backoff *= 2;
                continue;
            }

            if (!response.ok) {
                const text = await response.text();
                console.error(`❌ API Error ${response.status} for ${url}`);
                throw new Error(`API Error: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            console.warn(`🔄 Request attempt ${i + 1} failed: ${error.message}`);
            backoff *= 2;
        }
    }
}


// Supabase upsert
async function supabaseUpsert(table, data) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Supabase error: ${response.status} - ${error}`);
    }
}

const TCGDEX_API = 'https://api.tcgdex.net/v2/en';

async function migrate() {
    console.log('🚀 Starting migration using TCGdex API (Stable)...\n');

    let totalCards = 0;
    let totalSets = 0;

    try {
        // 1. Fetch All Sets
        console.log('📦 Fetching sets list from TCGdex...');
        const setsResponse = await fetch(`${TCGDEX_API}/sets`);
        if (!setsResponse.ok) throw new Error(`Failed to fetch sets: ${setsResponse.status}`);
        const sets = await setsResponse.json();
        totalSets = sets.length;
        console.log(`✅ Found ${totalSets} sets. Importing metadata...`);

        // Import sets in batches
        for (let i = 0; i < sets.length; i += 50) {
            const batch = sets.slice(i, i + 50).map(s => ({
                id: s.id,
                name: s.name,
                series: s.serie?.name || s.serie || '',
                printed_total: s.cardCount?.official || 0,
                total: s.cardCount?.total || 0,
                release_date: s.releaseDate,
                symbol_url: s.logo ? `${s.logo}/symbol` : null, // TCGdex usually has logo/symbol pattern
                logo_url: s.logo || null,
            }));
            await supabaseUpsert('pokemon_sets', batch);
            console.log(`   ✓ Imported sets ${i + 1} to ${Math.min(i + 50, sets.length)}`);
        }

        // 2. Fetch Cards per set
        console.log('\n📝 Importing full card details set-by-set...');
        for (let i = 0; i < sets.length; i++) {
            const set = sets[i];
            const progress = (((i + 1) / totalSets) * 100).toFixed(1);
            console.log(`\n[${i + 1}/${totalSets}] (${progress}%) Processing: ${set.name} (${set.id})`);

            try {
                // First get the list of cards in the set
                const setResponse = await fetch(`${TCGDEX_API}/sets/${set.id}`);
                if (!setResponse.ok) continue;
                const setData = await setResponse.json();
                const cardList = setData.cards || [];

                if (cardList.length === 0) continue;

                const transformedCards = [];

                // For each card, we need full details (TCGdex requires individual fetches for full detail)
                // We'll do this in small parallel chunks to be efficient
                const chunkSize = 15;
                for (let j = 0; j < cardList.length; j += chunkSize) {
                    const chunk = cardList.slice(j, j + chunkSize);
                    const detailPromises = chunk.map(c =>
                        fetch(`${TCGDEX_API}/cards/${c.id}`).then(r => r.ok ? r.json() : null)
                    );

                    const details = await Promise.all(detailPromises);

                    for (const c of details) {
                        if (!c) continue;

                        transformedCards.push({
                            id: c.id,
                            name: c.name,
                            set_id: c.set.id,
                            number: c.localId,
                            supertype: c.category === 'Pokemon' ? 'Pokémon' : c.category,
                            subtypes: c.subtypes || [],
                            rarity: c.rarity,
                            hp: c.hp || null,
                            types: c.types || [],
                            attacks: c.attacks || null,
                            weaknesses: c.weaknesses || null,
                            resistances: c.resistances || null,
                            retreat_cost: c.retreat ? Array(c.retreat).fill('Colorless') : [],
                            abilities: c.abilities || null,
                            rules: c.rules || [],
                            regulation_mark: c.regulationMark || null,
                            image_small: `${c.image}/low`,
                            image_large: `${c.image}/high`,
                            tcgplayer_url: null, // TCGdex doesn't give direct URL easily
                            cardmarket_url: null,
                            raw_data: {
                                ...c,
                                tcgplayer: c.pricing?.tcgplayer || null, // Map prices to match our app's logic
                                set: { id: c.set.id, name: c.set.name, printedTotal: c.set.cardCount?.official }
                            },
                        });
                    }

                    process.stdout.write(`.`); // Progress indicator
                }

                if (transformedCards.length > 0) {
                    // Import cards in batches of 50
                    for (let j = 0; j < transformedCards.length; j += 50) {
                        const batch = transformedCards.slice(j, j + 50);
                        await supabaseUpsert('pokemon_cards', batch);
                    }
                    console.log(`\n   ✅ Imported ${transformedCards.length} cards`);
                    totalCards += transformedCards.length;
                }
            } catch (err) {
                console.error(`\n   ❌ Error processing ${set.name}:`, err.message);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('🎉 Migration successful using TCGdex API!');
        console.log(`📊 Summary: ${totalSets} Sets | ${totalCards} Cards`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ Fatal Migration Error:', error.message);
        process.exit(1);
    }
}

migrate().catch(error => {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
});
