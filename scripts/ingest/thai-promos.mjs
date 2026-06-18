// Ingest the Thai promo expansions (M-P, S-P) from the official Thai site.
//
// These promo lines (Mega-era "NNN/M-P" and SV-era "NNN/S-P") were never in the
// catalog, so cards like "Iono's Bellibolt ex 047/M-P" couldn't be browsed,
// listed, or scanned. The standard derive-set pipeline assumes a Japanese twin
// (same set code, language='ja') for rarity / english_name, but no JA twin
// exists for these promos. So this self-contained ingest:
//   1. scrapes Thai name + collector number + image from asia.pokemon-card.com
//   2. derives english_name from a Thai-name -> english_name dictionary built
//      from the cards we already have (promos reprint main-set Pokemon)
//   3. stages a changeset and (with --commit) upserts the set + card rows
//
// Images keep their asia.pokemon-card.com URL; the monthly mirror cron
// (app/api/cron/mirror-images) self-hosts them into the card-images bucket.
// Real Thai prints -> pHash separately (scripts so the scanner can match them).
//
//   node scripts/ingest/thai-promos.mjs            # dry-run: stats + sample + write changeset
//   node scripts/ingest/thai-promos.mjs --commit   # create set rows + upsert cards
//
// Rollback: DELETE FROM pokemon_cards WHERE set_id IN ('M-P','S-P'); (+ pokemon_sets rows)

import { createClient } from '@supabase/supabase-js';
import { scrapeThaiSet } from '../lib/thai-catalog.mjs';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const COMMIT = process.argv.includes('--commit');

// Promo-line set codes mirror the Japanese designations: S-P = Sword & Shield
// era promos (gen-8 starters etc.), M-P = Mega-era promos. The collector
// numbering is Thailand-specific (it does NOT track the Japanese promo numbers).
const SETS = {
  'M-P': { name: 'การ์ดโปรโมชัน (เมกะ)', series: 'Mega Evolution', release_date: '2025-02-01' },
  'S-P': { name: 'การ์ดโปรโมชัน (ซอร์ด & ชีลด์)', series: 'Sword & Shield', release_date: '2020-12-04' },
};

// strip the angle brackets the official title wraps trainer-owner suffixes in
// ("ฮาราบารีex <ของนันจาโม>" -> "ฮาราบารีex ของนันจาโม"), collapse whitespace.
const cleanName = (s) => (s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
// match key: drop spaces / brackets / NFC so promo names line up with main-set prints
const matchKey = (s) => cleanName(s).normalize('NFC').replace(/\s+/g, '').toLowerCase();
// a real promo number looks like "047/M-P"; the site also returns one stray
// entry numbered just "M-P" (Champion Festival / victory mark) — skip those.
const hasNumber = (n) => /\d+\s*\//.test(n || '');

async function buildDictionary() {
  // Thai name -> { english_name, rarity } from cards we already hold.
  const dict = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('pokemon_cards')
      .select('name, english_name, rarity')
      .eq('language', 'th')
      .not('english_name', 'is', null)
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const c of data) {
      const k = matchKey(c.name);
      if (k && !dict.has(k)) dict.set(k, { english_name: c.english_name, rarity: c.rarity });
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return dict;
}

function buildRows(code, scraped, dict) {
  const rows = [];
  let enriched = 0;
  for (const s of scraped) {
    if (!hasNumber(s.number)) continue;
    const name = cleanName(s.thaiName);
    const hit = dict.get(matchKey(name));
    if (hit?.english_name) enriched++;
    rows.push({
      id: `${code}-${s.pad}`,
      set_id: code,
      language: 'th',
      game: 'pokemon',
      number: s.number,
      name,
      english_name: hit?.english_name ?? null,
      rarity: null, // promos print at promo rarity; main-set rarity would mislead
      supertype: 'Pokémon',
      image_small: s.imageUrl ?? null,
      image_large: s.imageUrl ?? null,
      raw_data: { image_origin: 'official_site', source_url: s.detailUrl },
    });
  }
  return { rows, enriched };
}

async function main() {
  const all = {};
  for (const code of Object.keys(SETS)) {
    const cacheFile = `scripts/out/thai-promo-${code.replace('-', '')}.json`;
    const scraped = fs.existsSync(cacheFile)
      ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      : await scrapeThaiSet(code, { maxPages: 60, concurrency: 10 });
    all[code] = scraped;
  }

  console.log('Building english_name dictionary from existing Thai cards...');
  const dict = await buildDictionary();
  console.log(`  dictionary: ${dict.size} distinct Thai names\n`);

  const changesetDir = 'scripts/out/changesets';
  fs.mkdirSync(changesetDir, { recursive: true });

  for (const code of Object.keys(SETS)) {
    const { rows, enriched } = buildRows(code, all[code], dict);
    const meta = SETS[code];
    const maxNum = rows.reduce((m, r) => Math.max(m, parseInt(r.number) || 0), 0);

    // changeset record for review
    fs.writeFileSync(`${changesetDir}/${code}.json`, JSON.stringify({
      setId: code, generatedAt: new Date().toISOString(),
      setMeta: { id: code, ...meta, total: rows.length, printed_total: maxNum, language: 'th', game: 'pokemon' },
      stats: { scraped: all[code].length, rows: rows.length, enriched },
      rows,
    }, null, 2));

    console.log(`=== ${code} (${meta.name}) ===`);
    console.log(`  scraped ${all[code].length} -> ${rows.length} card rows; english_name on ${enriched}/${rows.length}`);
    console.log('  sample:');
    for (const r of rows.slice(0, 6))
      console.log(`    ${r.number.padEnd(9)} ${r.name.padEnd(24)} en=${r.english_name ?? '-'}`);
    const bell = rows.find((r) => r.number.startsWith('047'));
    if (bell) console.log(`  [check] ${bell.number} ${bell.name} en=${bell.english_name}`);

    if (COMMIT) {
      const { error: setErr } = await supabase.from('pokemon_sets').upsert({
        id: code, name: meta.name, series: meta.series, release_date: meta.release_date,
        total: rows.length, printed_total: maxNum, language: 'th', game: 'pokemon',
      }, { onConflict: 'id' });
      if (setErr) { console.error(`  set upsert failed: ${setErr.message}`); process.exit(1); }
      let written = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 100), { onConflict: 'id' });
        if (error) { console.error(`  card batch ${i} failed: ${error.message}`); process.exit(1); }
        written += Math.min(100, rows.length - i);
      }
      console.log(`  committed: 1 set row + ${written} cards`);
    }
    console.log('');
  }

  if (!COMMIT) console.log('Dry-run. Changesets written to scripts/out/changesets/. Re-run with --commit to write.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
