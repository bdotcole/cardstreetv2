const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function mockSearchCards(query) {
    console.log(`\n\n--- Testing Search: "${query}" ---`);
    const cleanQuery = query.toLowerCase().trim();

    // 1. Fetch all set names 
    const { data: allSetsDbCache } = await supabase.from('pokemon_sets').select('id, name');
    
    let matchedSetIds = [];
    let queryWithoutSet = cleanQuery;
    let matchedSetName = null;
    
    if (allSetsDbCache && allSetsDbCache.length > 0) {
        const sortedSets = [...allSetsDbCache].sort((a, b) => b.name.length - a.name.length);
        
        for (const set of sortedSets) {
            const setNameLower = set.name.toLowerCase();
            const setIdLower = set.id.toLowerCase();
            
            if (cleanQuery === setNameLower || cleanQuery === setIdLower) {
                matchedSetIds.push(set.id);
                matchedSetName = set.name;
                queryWithoutSet = '';
                break;
            }
            
            const idRegex = new RegExp(`\\b${setIdLower}\\b`, 'i');
            if (idRegex.test(cleanQuery)) {
                matchedSetIds.push(set.id);
                matchedSetName = set.name;
                queryWithoutSet = cleanQuery.replace(idRegex, '').trim();
                break;
            }
            
            const escapedSetName = setNameLower.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
            const nameRegex = new RegExp(`\\b${escapedSetName}\\b`, 'i');
            if (nameRegex.test(cleanQuery)) {
                matchedSetIds.push(set.id);
                matchedSetName = set.name;
                queryWithoutSet = cleanQuery.replace(nameRegex, '').trim();
                break;
            }
        }
    }

    console.log(`Matched Sets: ${matchedSetIds.length > 0 ? matchedSetName + ' (' + matchedSetIds[0] + ')' : 'None'}`);
    console.log(`Remaining Query: "${queryWithoutSet}"`);

    let dbQuery = supabase
        .from('pokemon_cards')
        .select(`id, name, set_id, pokemon_sets(name)`);

    if (matchedSetIds.length > 0) {
        dbQuery = dbQuery.in('set_id', matchedSetIds);
        if (queryWithoutSet.length > 0) {
            dbQuery = dbQuery.or(`name.ilike.%${queryWithoutSet}%,english_name.ilike.%${queryWithoutSet}%`);
        }
    } else {
        const { data: partialSets } = await supabase.from('pokemon_sets').select('id').ilike('name', `%${cleanQuery}%`);
        const partialSetIds = partialSets?.map(s => s.id) || [];
        
        let orStr = `name.ilike.%${cleanQuery}%,english_name.ilike.%${cleanQuery}%`;
        if (partialSetIds.length > 0) {
            orStr += `,set_id.in.(${partialSetIds.join(',')})`;
        }
        dbQuery = dbQuery.or(orStr);
    }

    const { data: cards, error } = await dbQuery.limit(5);

    if (error) {
        console.error('Search error:', error);
        return;
    }

    console.log(`Results found: ${cards.length}`);
    cards.forEach(c => {
        console.log(` - ${c.name} [${c.pokemon_sets?.name || c.set_id}]`);
    });
}

async function runTests() {
    await mockSearchCards("Paldean Fates");
    await mockSearchCards("sv4a");
    await mockSearchCards("Charizard Paldean Fates");
    await mockSearchCards("Charizard sv4a");
    await mockSearchCards("Pikachu 151");
    // Partial test
    await mockSearchCards("Paldean");
}

runTests();
