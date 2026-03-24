import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function debugCards() {
  const names = ["N's Zekrom", "Emboar", "Mega Charizard X ex", "Mega Dragonite ex", "Pikachu ex", "Mega Gengar ex"];
  for (const n of names) {
    const {data} = await supabase.from('pokemon_cards').select('id, name, set_id, number, rarity').eq('language','en').ilike('name', `%${n}%`);
    console.log(n, data);
  }
}
debugCards();
