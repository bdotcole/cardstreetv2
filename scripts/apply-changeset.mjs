/**
 * Apply a staged changeset to production. Dry-run by default.
 *
 * Usage:
 *   node scripts/apply-changeset.mjs scripts/out/changesets/S12.json          # dry-run
 *   node scripts/apply-changeset.mjs scripts/out/changesets/S12.json --commit  # write
 *
 * Idempotent: deterministic ids upsert on conflict. Reversible: every row shares
 * set_id, so a set can be rolled back with
 *   DELETE FROM pokemon_cards WHERE set_id='<CODE>' AND language='th';
 *
 * Refuses to commit a changeset with validation errors. Strips the _provenance
 * field (changeset metadata, not a DB column) before writing.
 */

import fs from 'fs';
import { getSupabase } from './lib/thai-catalog.mjs';

const file = process.argv[2];
const commit = process.argv.includes('--commit');
if (!file) {
  console.error('Usage: node scripts/apply-changeset.mjs <changeset.json> [--commit]');
  process.exit(1);
}

const cs = JSON.parse(fs.readFileSync(file, 'utf-8'));
const { setId, rows, validation, setMeta } = cs;

if (validation.errors.length) {
  console.error(`Refusing: ${validation.errors.length} validation error(s):\n  ` + validation.errors.join('\n  '));
  process.exit(1);
}

const supabase = getSupabase();

// guard: only auto-create net-new sets; warn if th rows already exist
const { count: existing } = await supabase
  .from('pokemon_cards').select('*', { count: 'exact', head: true })
  .eq('set_id', setId).eq('language', 'th');

console.log(`[${setId}] ${rows.length} proposed rows | ${existing} existing th rows | mode=${commit ? 'COMMIT' : 'DRY-RUN'}`);

if (!commit) {
  console.log('\nDry-run. Would upsert these (sample):');
  for (const r of rows.slice(0, 5)) console.log(`  ${r.id}  ${r.number}  ${r.name}`);
  console.log(`\nWould ensure pokemon_sets row for ${setId} (current: ${setMeta ? 'exists' : 'MISSING -> would create'}).`);
  console.log('\nRe-run with --commit to write.');
  process.exit(0);
}

// 1. ensure the set row exists
if (!setMeta) {
  const maxNum = rows.reduce((m, r) => Math.max(m, parseInt(r.number) || 0), 0);
  const { error } = await supabase.from('pokemon_sets').upsert({
    id: setId, name: setId, language: 'th', total: rows.length, printed_total: maxNum || rows.length,
  }, { onConflict: 'id' });
  if (error) { console.error('set upsert failed:', error.message); process.exit(1); }
  console.log(`created pokemon_sets row for ${setId} (name=${setId} — fill the Thai set name later)`);
}

// 2. upsert cards in batches
const clean = rows.map(({ _provenance, ...r }) => r);
let written = 0;
for (let i = 0; i < clean.length; i += 100) {
  const batch = clean.slice(i, i + 100);
  const { error } = await supabase.from('pokemon_cards').upsert(batch, { onConflict: 'id' });
  if (error) { console.error(`batch ${i} failed:`, error.message); process.exit(1); }
  written += batch.length;
}
console.log(`[${setId}] committed ${written} rows. Rollback: DELETE FROM pokemon_cards WHERE set_id='${setId}' AND language='th';`);
