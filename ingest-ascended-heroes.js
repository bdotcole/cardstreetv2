import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
const TCGDEX_API = 'https://api.tcgdex.net/v2/en';
const TCGDEX_SET_ID = 'me02.5';
const DB_SET_ID = 'me02.5'; // Use same ID — it's our internal reference

async function ingest() {
    console.log("Step 1: Upserting Ascended Heroes set metadata...");

    const setRes = await fetch(`${TCGDEX_API}/sets/${TCGDEX_SET_ID}`);
    const setData = await setRes.json();

    // Upsert the set row
    const { error: setErr } = await supabase.from('pokemon_sets').upsert([{
        id: DB_SET_ID,
        name: setData.name,
        series: setData.serie?.name || setData.serie || 'Scarlet & Violet',
        printed_total: setData.cardCount?.official || 0,
        total: setData.cardCount?.total || 0,
        release_date: setData.releaseDate || null,
        symbol_url: setData.symbol || null,
        logo_url: setData.logo || null,
    }], { onConflict: 'id' });

    if (setErr) {
        console.error('Set upsert error:', setErr.message);
        return;
    }
    console.log(`✅ Set upserted: ${setData.name} (${DB_SET_ID})`);

    console.log('\nStep 2: Fetching and ingesting cards...');
    const cardList = setData.cards || [];
    console.log(`Found ${cardList.length} cards to process.`);

    const transformedCards = [];
    const chunkSize = 15;

    for (let j = 0; j < cardList.length; j += chunkSize) {
        const chunk = cardList.slice(j, j + chunkSize);
        const details = await Promise.all(
            chunk.map(c => fetch(`${TCGDEX_API}/cards/${c.id}`).then(r => r.ok ? r.json() : null))
        );

        for (const c of details) {
            if (!c) continue;
            transformedCards.push({
                id: c.id,
                name: c.name,
                english_name: c.name,
                language: 'en',
                set_id: DB_SET_ID,
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
                image_small: `${c.image}/low.png`,
                image_large: `${c.image}/high.png`,
                tcgplayer_url: null,
                cardmarket_url: null,
                raw_data: {
                    ...c,
                    tcgplayer: c.pricing?.tcgplayer || null,
                    set: { id: DB_SET_ID, name: setData.name, printedTotal: setData.cardCount?.official }
                },
            });
        }
        process.stdout.write('.');
    }

    console.log(`\nUpserting ${transformedCards.length} cards...`);
    for (let j = 0; j < transformedCards.length; j += 50) {
        const batch = transformedCards.slice(j, j + 50);
        const { error } = await supabase.from('pokemon_cards').upsert(batch, { onConflict: 'id' });
        if (error) console.error('\nCard upsert error:', error.message);
    }

    console.log(`✅ Done! ${transformedCards.length} cards ingested for Ascended Heroes.`);
}

ingest().catch(console.error);
