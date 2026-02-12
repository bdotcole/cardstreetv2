const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStatus() {
    const targetSets = ['MA', 'MA1', 'MA2', 'SV11s', 'SV10s', 'SV9s'];
    console.log(`Checking coverage for sets: ${targetSets.join(', ')}`);

    // 1. Fetch all Thai cards in these sets
    const { data: cards, error: wError } = await supabase
        .from('pokemon_cards')
        .select('id, set_id, name')
        .eq('language', 'th')
        .in('set_id', targetSets);

    if (wError) {
        console.error('Error fetching cards:', wError);
        return;
    }

    console.log(`Total Thai cards found: ${cards.length}`);

    // 2. Fetch all mappings
    // We can't fetch all mappings efficiently if there are too many, but for these sets it should be fine.
    // Better: fetch mappings for the card IDs we just found.
    const cardIds = cards.map(c => c.id);

    // Chunking to avoid URL too large errors
    const chunkSize = 50;
    const mappedCardIds = new Set();

    for (let i = 0; i < cardIds.length; i += chunkSize) {
        const chunk = cardIds.slice(i, i + chunkSize);
        const { data: mappings, error: mError } = await supabase
            .from('card_mappings')
            .select('card_id_th')
            .in('card_id_th', chunk);

        if (mError) {
            console.error('Error fetching mappings:', mError);
            return;
        }

        mappings.forEach(m => mappedCardIds.add(m.card_id_th));
    }

    // 3. Aggregate results
    const stats = {};
    targetSets.forEach(set => {
        stats[set] = { total: 0, mapped: 0 };
    });

    cards.forEach(card => {
        if (!stats[card.set_id]) stats[card.set_id] = { total: 0, mapped: 0 };
        stats[card.set_id].total++;
        if (mappedCardIds.has(card.id)) {
            stats[card.set_id].mapped++;
        }
    });

    // 4. Print Table
    console.log('\n--- Mapping Coverage ---');
    console.log('Set ID | Total | Mapped | Coverage %');
    console.log('-------|-------|--------|-----------');

    let grandTotal = 0;
    let grandMapped = 0;

    for (const set of targetSets) {
        const data = stats[set];
        const pct = data.total > 0 ? ((data.mapped / data.total) * 100).toFixed(1) : '0.0';
        console.log(`${set.padEnd(7)}| ${data.total.toString().padEnd(6)}| ${data.mapped.toString().padEnd(7)}| ${pct}%`);

        grandTotal += data.total;
        grandMapped += data.mapped;
    }

    console.log('-------|-------|--------|-----------');
    const totalPct = grandTotal > 0 ? ((grandMapped / grandTotal) * 100).toFixed(1) : '0.0';
    console.log(`TOTAL  | ${grandTotal.toString().padEnd(6)}| ${grandMapped.toString().padEnd(7)}| ${totalPct}%`);
}

checkStatus();
