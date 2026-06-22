/**
 * Backfill pokemon_cards.english_name for Thai rows from their Japanese twin.
 *
 * Thai sets reprint a Japanese set 1:1 with identical numbering, so the Pokemon at
 * th <set>/<number> is the same as ja <set>/<number>. Where the catalog holds the
 * JA twin under the same set code, we can copy ja.english_name -> th.english_name
 * deterministically (no cross-language name guessing). This is the ONLY safe source:
 * the EN twin renumbers, so an EN number-match would mislabel cards. (The set_bridge
 * in scripts/build_set_bridge.ts maps Thai->EN for PRICING, not names.)
 *
 *   node scripts/backfill-thai-english-name.mjs            # dry-run (auto-detects JP-bridgeable sets)
 *   node scripts/backfill-thai-english-name.mjs --commit   # write
 *
 * Idempotent (only fills rows where english_name is null/empty). Reversible per set:
 *   UPDATE pokemon_cards SET english_name = NULL
 *   WHERE language='th' AND set_id IN (...) AND english_name IS NOT NULL;
 */
import { getSupabase } from './lib/thai-catalog.mjs';

const COMMIT = process.argv.includes('--commit');
const sb = getSupabase();
const norm = n => (n || '').split('/')[0].trim();

// Find th sets with english_name gaps
const gap = new Map();
let from = 0; const P = 1000;
for (;;) {
  const { data, error } = await sb.from('pokemon_cards')
    .select('id,set_id,number,english_name').eq('language', 'th').order('id').range(from, from + P - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data.length) break;
  for (const r of data) {
    if (r.english_name && r.english_name.trim()) continue;
    const s = gap.get(r.set_id) || []; s.push(r); gap.set(r.set_id, s);
  }
  from += P; if (data.length < P) break;
}

const updates = [];
const perSet = [];
for (const [setId, rows] of gap) {
  // Look up JA twin under the same set code
  const { data: ja } = await sb.from('pokemon_cards')
    .select('number,english_name').ilike('set_id', setId).eq('language', 'ja');
  if (!ja || !ja.length) continue;
  const jaMap = new Map();
  for (const r of ja) { const n = norm(r.number); if (r.english_name && r.english_name.trim() && !jaMap.has(n)) jaMap.set(n, r.english_name.trim()); }
  let filled = 0;
  for (const r of rows) {
    const en = jaMap.get(norm(r.number));
    if (en) { updates.push({ id: r.id, english_name: en }); filled++; }
  }
  if (filled) perSet.push({ setId, filled, gap: rows.length, samples: rows.slice(0, 2).map(r => `${r.number}->${jaMap.get(norm(r.number)) || '-'}`) });
}

console.log('Per-set fills (via JA twin number-match):');
for (const p of perSet) console.log(`  ${p.setId.padEnd(8)} ${p.filled}/${p.gap}   e.g. ${p.samples.join(', ')}`);
console.log(`\nTotal rows to fill: ${updates.length}`);

if (!COMMIT) { console.log('\nDRY-RUN. Re-run with --commit to write.'); process.exit(0); }

let written = 0;
for (const u of updates) {
  const { error } = await sb.from('pokemon_cards').update({ english_name: u.english_name }).eq('id', u.id);
  if (error) { console.error('update failed', u.id, error.message); process.exit(1); }
  written++;
  if (written % 100 === 0) console.log(`  ...${written}`);
}
console.log(`\nCommitted ${written} english_name backfills.`);
