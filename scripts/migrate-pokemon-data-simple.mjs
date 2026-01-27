/**
 * Simplified Pokemon TCG Migration Script (No dependencies)
 * 
 * This version uses native Node.js modules only.
 * Run with: node scripts/migrate-pokemon-data-simple.mjs
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');

if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            process.env[key] = value;
        }
    });
    console.log('✅ Loaded environment variables from .env.local\n');
} else {
    console.error('❌ .env.local file not found!');
    console.error('Expected at:', envPath);
    process.exit(1);
}

const CONFIG = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    batchSize: 100,
    maxRetries: 4,
    initialBackoff: 1200,
};

if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    console.error('❌ Missing required environment variables in .env.local:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL:', CONFIG.supabaseUrl ? '✓' : '✗');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY:', CONFIG.supabaseKey ? '✓' : '✗');
    process.exit(1);
}

// Helper to make HTTPS requests
function httpsRequest(urlString, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const lib = url.protocol === 'https:' ? https : http;

        const requestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = lib.request(requestOptions, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsRequest(res.headers.location, options).then(resolve).catch(reject);
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
                } catch (e) {
                    resolve({ status: res.statusCode, data, headers: res.headers });
                }
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// Fetch with retry
async function fetchWithRetry(url, retries = CONFIG.maxRetries, backoff = CONFIG.initialBackoff) {
    try {
        const res = await httpsRequest(url, { headers: { Accept: 'application/json' } });

        if (res.status === 429) {
            if (retries > 0) {
                console.warn(`⏳ Rate limited. Waiting ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff));
                return fetchWithRetry(url, retries - 1, backoff * 2);
            }
            throw new Error('Rate limit exceeded');
        }

        if (res.status !== 200) {
            console.error(`API returned status ${res.status} for URL: ${url}`);
            console.error('Response:', typeof res.data === 'string' ? res.data.substring(0, 200) : res.data);
            throw new Error(`API Error: ${res.status}`);
        }
        return res.data;
    } catch (error) {
        if (retries > 0) {
            console.warn(`🔄 Retrying... (${retries} left)`);
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, retries - 1, backoff * 2);
        }
        throw error;
    }
}

// Supabase insert
async function supabaseInsert(table, data) {
    const url = `${CONFIG.supabaseUrl}/rest/v1/${table}`;
    const res = await httpsRequest(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': CONFIG.supabaseKey,
            'Authorization': `Bearer ${CONFIG.supabaseKey}`,
            'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(data)
    });

    if (res.status !== 201 && res.status !== 200) {
        throw new Error(`Supabase error: ${res.status} ${JSON.stringify(res.data)}`);
    }
    return res;
}

// Main migration
async function migrate() {
    console.log('🚀 Starting Pokemon TCG migration...\n');

    // Fetch all sets
    console.log('📦 Fetching sets...');
    const setsData = await fetchWithRetry('https://api.pokemontcg.io/v2/sets?pageSize=250');
    const sets = setsData.data || [];
    console.log(`✅ Found ${sets.length} sets\n`);

    // Import sets in batches
    console.log('💾 Importing sets to Supabase...');
    for (let i = 0; i < sets.length; i += CONFIG.batchSize) {
        const batch = sets.slice(i, i + CONFIG.batchSize).map(s => ({
            id: s.id,
            name: s.name,
            series: s.series,
            printed_total: s.printedTotal,
            total: s.total,
            release_date: s.releaseDate,
            symbol_url: s.images?.symbol,
            logo_url: s.images?.logo,
        }));

        await supabaseInsert('pokemon_sets', batch);
        console.log(`   ✓ Imported ${Math.min(i + CONFIG.batchSize, sets.length)}/${sets.length} sets`);
    }

    // Import cards for each set
    let totalCards = 0;
    for (let i = 0; i < sets.length; i++) {
        const set = sets[i];
        console.log(`\n[${i + 1}/${sets.length}] ${set.name} (${set.id})`);

        const cardsData = await fetchWithRetry(`https://api.pokemontcg.io/v2/cards?q=set.id:${set.id}&pageSize=250`);
        const cards = (cardsData.data || []).map(c => ({
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
            for (let j = 0; j < cards.length; j += CONFIG.batchSize) {
                const batch = cards.slice(j, j + CONFIG.batchSize);
                await supabaseInsert('pokemon_cards', batch);
            }
            console.log(`   ✅ Imported ${cards.length} cards`);
            totalCards += cards.length;
        }

        console.log(`   Progress: ${((i + 1) / sets.length * 100).toFixed(1)}%`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Migration completed!');
    console.log(`📊 Sets: ${sets.length} | Cards: ${totalCards}`);
    console.log('='.repeat(60));
}

migrate().catch(error => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
});
