// One-shot: normalize Thai card rarities to JP-style abbreviations.
// Mirrors supabase/migrations/20260525_normalize_thai_rarities.sql.
//
// Run: node scripts/apply-thai-rarity-fix.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// dotenv shim with quote-stripping (see CLAUDE.md)
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env[m[1]] = v;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// (fromRarityLower[]) -> targetCode
const groups = [
  [['common'], 'C'],
  [['uncommon'], 'U'],
  [['rare', 'holo rare', 'rare holo', 'black & white rare'], 'R'],
  [['double rare', 'holo rare v', 'holo rare vmax', 'holo rare vstar', 'rare holo v', 'rare holo vmax', 'rare holo vstar'], 'RR'],
  [['ultra rare', 'radiant rare', 'amazing rare'], 'SR'],
  [['illustration rare', 'shiny rare'], 'AR'],
  [['special illustration rare', 'secret rare'], 'SAR'],
  [['hyper rare', 'shiny ultra rare', 'mega hyper rare'], 'UR'],
  [['ace spec rare'], 'ACE'],
];

async function main() {
  let totalUpdated = 0;

  for (const [fromList, target] of groups) {
    // Fetch matching ids for this group, then update in bulk by id.
    // We do select-then-update because Supabase REST doesn't accept a raw
    // lower(rarity) predicate; matching by exact string per casing variant
    // would need to enumerate.
    const matchedIds = [];

    // Paginate (in case >1000 rows match a single group)
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('pokemon_cards')
        .select('id, rarity')
        .eq('language', 'th')
        .range(from, from + 999);
      if (error) {
        console.error('Fetch error:', error);
        return;
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const r = (row.rarity || '').toLowerCase().trim();
        if (fromList.includes(r)) matchedIds.push(row.id);
      }
      if (data.length < 1000) break;
      from += 1000;
    }

    if (matchedIds.length === 0) {
      console.log(`  ${target.padStart(3)} ← (${fromList.join(' | ')}):  0 rows`);
      continue;
    }

    // Update in chunks of 500
    let updated = 0;
    for (let i = 0; i < matchedIds.length; i += 500) {
      const chunk = matchedIds.slice(i, i + 500);
      const { error } = await supabase
        .from('pokemon_cards')
        .update({ rarity: target })
        .in('id', chunk);
      if (error) {
        console.error(`Update error (target=${target}):`, error);
        return;
      }
      updated += chunk.length;
    }
    console.log(`  ${target.padStart(3)} ← (${fromList.join(' | ')}):  ${updated} rows`);
    totalUpdated += updated;
  }

  console.log(`\nDone. Total rows updated: ${totalUpdated}`);
}

main().catch(console.error);
