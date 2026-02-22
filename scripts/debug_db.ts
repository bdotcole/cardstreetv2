import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixStaleUnknownSets() {
    console.log("Fixing Unknown Set in collection_items...");

    // Get all collection items with Unknown Set
    const { data: items, error: err } = await supabase.from('collection_items').select('id, card_id, card_data').limit(1000);
    if (!items) return;

    let fixedCount = 0;
    for (const item of items) {
        if (item.card_data && item.card_data.set === 'Unknown Set') {
            // Lookup real set
            const { data: realCard } = await supabase.from('pokemon_cards').select('set_id, pokemon_sets(name)').eq('id', item.card_id).single();
            if (realCard && realCard.pokemon_sets) {
                const thaiSetMap: Record<string, string> = {
                    'SV1V': 'Violet ex', 'SV1S': 'Scarlet ex', 'SV2D': 'Clay Burst',
                    'SV2P': 'Snow Hazard', 'SV5K': 'Wild Force', 'SV5M': 'Cyber Judge',
                    'MA1': 'Mega Evolution', 'MA2': 'Crimson Haze', 'MA3': 'Mega Evolution Dream ex',
                    'SV10s': 'The Unbeatable Hero', 'SV9s': 'Destiny Threads'
                };
                let setName = (realCard.pokemon_sets as any).name || (realCard.pokemon_sets as any)[0]?.name || 'Unknown Set';
                const engName = thaiSetMap[realCard.set_id];
                if (engName && !setName.includes(engName)) {
                    setName = `${engName} (${setName})`;
                }

                item.card_data.set = setName;
                await supabase.from('collection_items').update({ card_data: item.card_data }).eq('id', item.id);
                fixedCount++;
            }
        }
    }
    console.log(`Fixed ${fixedCount} collection_items.`);
}

fixStaleUnknownSets();
