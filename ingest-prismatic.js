import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TCGDEX_API = 'https://api.tcgdex.net/v2/en';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function ingestPrismatic() {
    console.log("Starting ingestion for Prismatic Evolutions (sv08.5 -> sv8pt5)");

    const setResponse = await fetch(`${TCGDEX_API}/sets/sv08.5`);
    const setData = await setResponse.json();
    const cardList = setData.cards || [];

    console.log(`Found ${cardList.length} cards in TCGdex.`);

    const transformedCards = [];
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
                id: c.id.replace('sv08.5', 'sv8pt5'), // Ensure ID contains sv8pt5
                name: c.name,
                english_name: c.name,
                language: 'en',
                set_id: 'sv8pt5',
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
                    set: { id: 'sv8pt5', name: c.set.name, printedTotal: c.set.cardCount?.official }
                },
            });
        }
        process.stdout.write(`.`);
    }

    console.log(`\nUpserting ${transformedCards.length} cards...`);

    for (let j = 0; j < transformedCards.length; j += 50) {
        const batch = transformedCards.slice(j, j + 50);
        const { error } = await supabase.from('pokemon_cards').upsert(batch, { onConflict: 'id' });
        if (error) {
            console.error("\nUpsert error:", error);
        }
    }

    console.log("\nDone!");
}

ingestPrismatic().catch(console.error);
