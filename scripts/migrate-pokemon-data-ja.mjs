/**
 * Pokemon TCG Japanese Migration using TCGdex API
 * Run with: node scripts/migrate-pokemon-data-ja.mjs
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
const TCGDEX_API = 'https://api.tcgdex.net/v2/ja';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
}

// Fetch with retry
async function fetchWithRetry(url, retries = 5, backoff = 5000) {
    for (let i = 0; i < retries; i++) {
        try {
            if (i > 0) {
                await new Promise(r => setTimeout(r, backoff));
            }

            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                },
                signal: AbortSignal.timeout(30000)
            });

            if (response.status === 429 || response.status === 504 || response.status === 502) {
                backoff *= 2;
                continue;
            }

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
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

async function migrate() {
    console.log('🚀 Starting Japanese Pokemon TCG migration...\n');

    let totalCards = 0;
    let totalSets = 0;

    try {
        // 1. Fetch All Sets
        console.log('📦 Fetching Japanese sets list...');
        const setsResponse = await fetch(`${TCGDEX_API}/sets`);
        if (!setsResponse.ok) throw new Error(`Failed to fetch sets: ${setsResponse.status}`);
        const rawSets = await setsResponse.json();

        // Deduplicate sets by ID
        const uniqueSetsMap = new Map();
        rawSets.forEach(s => uniqueSetsMap.set(s.id, s));
        const sets = Array.from(uniqueSetsMap.values());

        totalSets = sets.length;
        console.log(`✅ Found ${totalSets} unique Japanese sets (from ${rawSets.length} total). Importing metadata...`);

        // Import sets
        for (let i = 0; i < sets.length; i += 50) {
            const batch = sets.slice(i, i + 50).map(s => ({
                id: s.id,
                name: s.name,
                series: s.serie?.name || s.serie || '',
                printed_total: s.cardCount?.official || 0,
                total: s.cardCount?.total || 0,
                release_date: s.releaseDate,
                symbol_url: s.logo ? `${s.logo}/symbol` : null,
                logo_url: s.logo || null,
                language: 'ja'
            }));
            await supabaseUpsert('pokemon_sets', batch);
            console.log(`   ✓ Imported sets ${i + 1} to ${Math.min(i + 50, sets.length)}`);
        }

        // 2. Fetch Cards per set
        console.log('\n📝 Importing Japanese card details set-by-set...');
        for (let i = 0; i < sets.length; i++) {
            const set = sets[i];
            const progress = (((i + 1) / totalSets) * 100).toFixed(1);
            console.log(`\n[${i + 1}/${totalSets}] (${progress}%) Processing: ${set.name} (${set.id})`);

            try {
                const setResponse = await fetch(`${TCGDEX_API}/sets/${set.id}`);
                if (!setResponse.ok) continue;
                const setData = await setResponse.json();
                const cardList = setData.cards || [];

                if (cardList.length === 0) continue;

                const transformedCardsMap = new Map();
                const chunkSize = 15;

                for (let j = 0; j < cardList.length; j += chunkSize) {
                    const chunk = cardList.slice(j, j + chunkSize);
                    const detailPromises = chunk.map(c =>
                        fetch(`${TCGDEX_API}/cards/${c.id}`).then(r => r.ok ? r.json() : null)
                    );

                    const details = await Promise.all(detailPromises);

                    for (const c of details) {
                        if (!c) continue;

                        // Map to the object and use Map for deduplication in the same batch
                        transformedCardsMap.set(c.id, {
                            id: c.id,
                            name: c.name || 'Unknown',
                            set_id: c.set?.id || set.id,
                            number: String(c.localId || ''),
                            supertype: c.category === 'Pokemon' ? 'Pokémon' : (c.category || 'Unknown'),
                            subtypes: c.subtypes || [],
                            rarity: c.rarity || null,
                            hp: c.hp || null,
                            types: c.types || [],
                            attacks: c.attacks || null,
                            weaknesses: c.weaknesses || null,
                            resistances: c.resistances || null,
                            retreat_cost: c.retreat ? Array(c.retreat).fill('Colorless') : [],
                            abilities: c.abilities || null,
                            rules: c.rules || [],
                            regulation_mark: c.regulationMark || null,
                            image_small: c.image ? `${c.image}/low` : null,
                            image_large: c.image ? `${c.image}/high` : null,
                            tcgplayer_url: null,
                            cardmarket_url: null,
                            language: 'ja',
                            raw_data: {
                                ...c,
                                tcgplayer: c.pricing?.tcgplayer || null,
                                set: { id: c.set?.id, name: c.set?.name, printedTotal: c.set?.cardCount?.official }
                            },
                        });
                    }
                    process.stdout.write(`.`);
                }

                const transformedCards = Array.from(transformedCardsMap.values());
                if (transformedCards.length > 0) {
                    for (let j = 0; j < transformedCards.length; j += 50) {
                        const batch = transformedCards.slice(j, j + 50);
                        await supabaseUpsert('pokemon_cards', batch);
                    }
                    console.log(`\n   ✅ Imported ${transformedCards.length} unique cards`);
                    totalCards += transformedCards.length;
                }
            } catch (err) {
                console.error(`\n   ❌ Error processing ${set.name}:`, err.message);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('🎉 Japanese Migration successful!');
        console.log(`📊 Summary: ${totalSets} Sets | ${totalCards} Cards`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ Fatal Migration Error:', error.message);
        process.exit(1);
    }
}

migrate().catch(console.error);
