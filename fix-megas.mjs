/**
 * fix-megas.mjs
 * Manually overrides the specific 6 rarity mismatched cards from the user's screenshot.
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function fixRarities() {
  console.log('=== FIXING MEGA RARITIES ===');

  const manualFixes = [
    { th: 'MA3-246', en: 'me02.5-290' }, // Mega Dragonite ex SAR
    { th: 'MA3-223', en: 'me02-125' },   // Mega Charizard X ex MA
    { th: 'MA3-234', en: 'me02.5-277' }, // Pikachu ex SAR
    { th: 'MA3-250', en: 'me02.5-295' }, // Mega Dragonite ex MUR
    { th: 'MA3-210', en: 'me02.5-155' }, // N's Zekrom 
    { th: 'MA3-240', en: 'me02.5-284' }, // Mega Gengar ex SAR
    { th: 'MA3-261', en: 'me02.5-294' }  // Mega Charizard Y ex HR
  ];

  const toUpsert = manualFixes.map(f => ({
    card_id_th: f.th,
    card_id_en: f.en,
    match_method: 'manual_qc',
    confidence_score: 1.0,
    verified: true
  }));

  const { error } = await supabase.from('card_mappings').upsert(toUpsert, { onConflict: 'card_id_th' });
  if (error) {
    console.error("Error inserting manual fixes:", error);
  } else {
    console.log(`✓ Inserted ${manualFixes.length} exact rarity manual overrides.`);
  }
}

fixRarities();
