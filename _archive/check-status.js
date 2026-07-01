const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fdxgzddvywtmnqsaqysx.supabase.co';
// Supabase connection. Never hard-code the service-role key — read it from
// .env.local like the other scripts (CRLF-safe, strips surrounding quotes).
const env = {};
for (const line of require('fs').readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
}
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkStatus() {
    console.log('Checking status...');

    // 1. Total Thai Cards
    const { count: totalCards, error: e1 } = await supabase
        .from('pokemon_cards')
        .select('*', { count: 'exact', head: true })
        .eq('language', 'th');

    if (e1) console.error('Error counting total cards:', e1);

    // 2. Mapped Cards
    const { count: mappedCards, error: e2 } = await supabase
        .from('card_mappings')
        .select('*', { count: 'exact', head: true });

    if (e2) console.error('Error counting mapped cards:', e2);

    // 3. Verified Maps
    const { count: verifiedMaps, error: e3 } = await supabase
        .from('card_mappings')
        .select('*', { count: 'exact', head: true })
        .eq('verified', true);

    if (e3) console.error('Error counting verified maps:', e3);

    console.log(`Total Thai Cards: ${totalCards}`);
    console.log(`Mapped Cards: ${mappedCards}`);
    console.log(`Verified Maps: ${verifiedMaps}`);

    if (totalCards > 0) {
        console.log(`Coverage: ${((mappedCards / totalCards) * 100).toFixed(2)}%`);
    }

    // 4. Breakdown by Set for Thai Cards
    const { data: thaiCards, error: e4 } = await supabase
        .from('pokemon_cards')
        .select('id, set_id, name, english_name, number, rarity')
        .eq('language', 'th');

    if (e4) {
        console.error('Error fetching thai cards:', e4);
        return;
    }

    const { data: mappings, error: e5 } = await supabase
        .from('card_mappings')
        .select('card_id_th');

    if (e5) {
        console.error('Error fetching mappings:', e5);
        return;
    }

    const mappedSet = new Set(mappings.map(m => m.card_id_th));

    const setStats = {};
    const unmappedExamples = [];

    thaiCards.forEach(card => {
        if (!setStats[card.set_id]) {
            setStats[card.set_id] = { total: 0, mapped: 0 };
        }
        setStats[card.set_id].total++;

        if (mappedSet.has(card.id)) {
            setStats[card.set_id].mapped++;
        } else {
            if (unmappedExamples.length < 5) {
                unmappedExamples.push({
                    set_id: card.set_id,
                    name: card.name,
                    english_name: card.english_name,
                    number: card.number,
                    rarity: card.rarity,
                    id: card.id
                });
            }
        }
    });

    console.log('--- Set Stats ---');
    console.table(setStats);

    console.log('--- Unmapped Examples (First 5) ---');
    console.log(JSON.stringify(unmappedExamples, null, 2));

    // Debug Gligar failure
    console.log('\n--- Debugging Gligar (MA2) ---');

    // Get MA2 release date
    const { data: ma2Set } = await supabase
        .from('pokemon_sets')
        .select('release_date')
        .eq('id', 'MA2')
        .single();
    console.log('MA2 Release Date:', ma2Set?.release_date);

    // Get English Gligars
    const { data: enGligars } = await supabase
        .from('pokemon_cards')
        .select('name, set_id, rarity, pokemon_sets(release_date)')
        .eq('language', 'en')
        .ilike('name', 'Gligar')
        //.eq('rarity', 'Common') // Relax rarity for debug
        .not('pokemon_sets', 'is', null);

    console.log('English Gligars found:', enGligars?.length);
    if (enGligars && ma2Set?.release_date) {
        enGligars.forEach(c => {
            const thaiDate = new Date(ma2Set.release_date);
            const enDate = new Date(c.pokemon_sets.release_date);
            const diffTime = Math.abs(thaiDate - enDate);
            const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30);
            console.log(`- ${c.name} (${c.set_id}, ${c.rarity}): ${c.pokemon_sets.release_date} (Diff: ${diffMonths.toFixed(1)} months)`);
        });
    }

    // Replicate exact match logic from Edge Function
    console.log('\n--- Replicating Edge Function matching for Gligar ---');
    if (ma2Set?.release_date) {
        const thaiCardDate = new Date(ma2Set.release_date);
        console.log(`Thai Date: ${thaiCardDate.toISOString()}`);

        const { data: enCards, error: matchError } = await supabase
            .from('pokemon_cards')
            .select('id, name, rarity, pokemon_sets!inner(release_date)')
            .eq('language', 'en')
            .in('rarity', ['Common']) // Gligar is Common
            .ilike('name', `%Gliga%`) // Gligar substring(0,5)
            .limit(50);

        if (matchError) {
            console.error("Error in replication query:", matchError);
        } else {
            console.log(`Found ${enCards.length} candidates.`);
            let found = false;
            enCards.forEach(c => {
                const enDate = new Date(c.pokemon_sets.release_date);
                const diffTime = Math.abs(thaiCardDate - enDate);
                const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30);
                const nameSim = 1.0; // "Gligar" vs "Gligar"
                const isDateValid = diffMonths <= 3;

                if (c.name.includes("Gligar") && isDateValid) {
                    console.log(`MATCH FOUND: ${c.name} (${c.rarity}) - Diff: ${diffMonths.toFixed(2)} months`);
                    found = true;
                } else {
                    // console.log(`No match: ${c.name} - Diff: ${diffMonths.toFixed(2)} months`);
                }
            });

            if (!found) console.log("NO MATCH FOUND by logic.");
        }
    }
    // Check mapped examples to verify rarity
    console.log('\n--- Mapped Examples (MA2) ---');
    const { data: mappedExamples } = await supabase
        .from('card_mappings')
        .select(`
            card_id_th, 
            card_id_en,
            th:pokemon_cards!card_id_th(name, rarity),
            en:pokemon_cards!card_id_en(name, rarity,, set_id)
        `)
        .limit(10);

    if (mappedExamples) {
        mappedExamples.forEach(m => {
            console.log(`${m.th.name} (${m.th.rarity}) -> ${m.en.name} (${m.en.rarity}) [${m.en.set_id}]`);
        });
    }

    // specific SV11s check
    console.log('\n--- SV11s Mappings ---');
    const { data: sv11sMaps } = await supabase
        .from('card_mappings')
        .select(`
            card_id_th, 
            card_id_en,
            th:pokemon_cards!card_id_th(set_id),
            en:pokemon_cards!card_id_en(set_id, name)
        `)
        .eq('th.set_id', 'SV11s')
        .limit(10);

    // Note: Filtering by joined column in JS client is tricky, better to just grab last 20 mappings and check set_id
    const { data: recentMaps } = await supabase
        .from('card_mappings')
        .select(`
            card_id_th, 
            th:pokemon_cards!card_id_th(set_id, name),
            en:pokemon_cards!card_id_en(set_id, name)
        `)
        .order('created_at', { ascending: false })
        .limit(20);

    if (recentMaps) {
        recentMaps.filter(m => m.th.set_id === 'SV11s').forEach(m => {
            console.log(`SV11s Match: ${m.th.name} -> ${m.en.name} (${m.en.set_id})`);
        });
    }
}

checkStatus();
