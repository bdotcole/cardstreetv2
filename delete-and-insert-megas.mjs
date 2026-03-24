/**
 * delete-and-insert-megas.mjs
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  console.log('=== FORCE FIXING MEGA RARIDADES ===');

  const manualFixes = [
    { th: 'MA3-246', en: 'me02.5-290' }, // Mega Dragonite ex SAR
    { th: 'MA3-223', en: 'me02-125' },   // Mega Charizard X ex MA
    { th: 'MA3-234', en: 'me02.5-277' }, // Pikachu ex SAR
    { th: 'MA3-250', en: 'me02.5-295' }, // Mega Dragonite ex MUR
    { th: 'MA3-210', en: 'me02.5-155' }, // N's Zekrom 
    { th: 'MA3-026', en: 'me02.5-273' }  // Emboar SAR (EH)
  ];

  const thIds = manualFixes.map(f => f.th);
  
  // 1. Hard Delete all existing mappings for these TH cards
  const { error: delErr } = await supabase.from('card_mappings').delete().in('card_id_th', thIds);
  if (delErr) {
    console.error("Failed to delete old mappings:", delErr);
    return;
  }
  console.log(`Deleted all old mappings for ${thIds.length} target cards.`);

  // 2. Insert fresh exact mappings
  const toInsert = manualFixes.map(f => ({
    card_id_th: f.th,
    card_id_en: f.en,
    match_method: 'manual_qc',
    confidence_score: 1.0,
    verified: true
  }));

  const { error: insErr } = await supabase.from('card_mappings').insert(toInsert);
  if (insErr) {
    console.error("Failed to insert mapping:", insErr);
  } else {
    console.log("✓ Successfully applied manual override mappings.");
  }
}
run();
