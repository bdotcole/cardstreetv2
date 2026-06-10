/**
 * Derive a Thai set into a staged changeset (no production writes).
 *
 * Usage: node scripts/derive-set.mjs <CODE> [CODE2 ...]
 *
 * For each code: scrape the official Thai site, overlay the JA twin for rarity /
 * English name, validate, and write scripts/out/changesets/<CODE>.json.
 * Review the printed diff, then apply with apply-changeset.mjs.
 */

import { getSupabase, scrapeThaiSet, loadTwin, getSetMeta, buildChangeset, writeChangeset, printDiff } from './lib/thai-catalog.mjs';

const codes = process.argv.slice(2);
if (codes.length === 0) {
  console.error('Usage: node scripts/derive-set.mjs <CODE> [CODE2 ...]');
  process.exit(1);
}

const supabase = getSupabase();

for (const code of codes) {
  console.log(`\n[${code}] scraping official Thai site...`);
  const scraped = await scrapeThaiSet(code);
  console.log(`[${code}] scraped ${scraped.length} cards; loading JA twin...`);
  const twin = await loadTwin(supabase, code);
  const setMeta = await getSetMeta(supabase, code);
  const cs = buildChangeset({ code, scraped, twin, setMeta });
  const file = writeChangeset(cs);
  printDiff(cs);
  console.log(`\nwritten: ${file.replace(process.cwd(), '.')}`);
}
