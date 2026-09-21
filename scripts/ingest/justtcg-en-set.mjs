// JustTCG -> pokemon_sets/pokemon_cards ingestion for ENGLISH Pokemon sets.
//
// NOT THE USUAL ENGLISH PATH. English Pokemon normally comes from TCGdex via
// `mega-evolution-sets.mjs`, which is richer (attacks, abilities, types, HP).
// This script exists for the window where a set is ON SALE but TCGdex has not
// published it yet -- exactly what happened to 30th Celebration (2026-09-16):
// TCGdex 404'd every plausible id (me06, me05.5, cel30), pokemontcg.io had
// nothing, and Limitless had no English set page at all. JustTCG was the only
// upstream carrying the card list on release day.
//
// PREFER TCGdex ONCE IT CATCHES UP. This script writes name/number/rarity/art
// only; it cannot fill attacks or abilities. Re-running `mega-evolution-sets.mjs`
// over the same set id later is the upgrade path and is safe -- it upserts on
// the same ids.
//
//   node scripts/ingest/justtcg-en-set.mjs me05.5 --slug=me-30th-celebration-pokemon \
//        --name="30th Celebration" --printed-total=128 --total=161 \
//        --release=2026-09-16 --series="Mega Evolution"
//   node scripts/ingest/justtcg-en-set.mjs me05.5 --slug=... --dry-run
//
// Deliberate behaviours, each one a bug someone already hit:
//
//   1. MIRRORED ART IS NEVER CLOBBERED. A re-run rebuilds image URLs from the
//      TCGplayer CDN, which would silently undo mirroring and put the catalog
//      back on a third-party host. Existing rows whose image_small is already on
//      supabase.co keep their mirrored URLs. (Same trap that bit jp-modern-sets
//      and onepiece.mjs.)
//
//   2. SEALED PRODUCTS ARE FILTERED OUT. JustTCG mixes booster boxes, tins and
//      cases into the card list with number "N/A" -- 47 of the 182 items in
//      30th Celebration. Ingesting those creates junk cards with no number.
//
//   3. NAME SUFFIXES ARE STRIPPED. JustTCG disambiguates parallels in the NAME
//      ("Pikachu ex - 150/128"). Left alone, every alt art stores a dirty name
//      that breaks search and looks wrong in the UI.
//
//   4. `--total` IS THE TRUE SET SIZE, NOT WHAT WE INGEST. Upstream publishes
//      the main set first and the secrets later, so an early run lands a partial
//      set on purpose. Recording the real total keeps the QC completeness check
//      flagging the set until the rest arrives -- which is the point.
//
//   5. COLLISION GUARD. pokemon_sets.id is the PRIMARY KEY, so one code holds
//      exactly one language. Refuse to touch an id owned by another language
//      rather than overwrite it (the incident that clobbered 19 Thai set rows).
//
// Rerun is idempotent: rows upsert on their primary key, so a later sweep picks
// up newly-published cards without disturbing what is already there.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// --- env (.env.local), stripping surrounding quotes per CLAUDE.md gotcha -------
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
const JUSTTCG_KEY = (env.JUSTTCG_API_KEY || '').trim();

// --- args ---------------------------------------------------------------------
const raw = process.argv.slice(2);
const positional = [];
const flags = {};
for (const a of raw) {
  if (a.startsWith('--')) {
    const [k, ...rest] = a.slice(2).split('=');
    flags[k] = rest.length ? rest.join('=') : true;
  } else positional.push(a);
}
const SET_ID = positional[0];
const SLUG = flags.slug;
const DRY = !!flags['dry-run'];
if (!SET_ID || !SLUG) {
  console.error('usage: node scripts/ingest/justtcg-en-set.mjs <SET_ID> --slug=<justtcg-set-slug> [--name=..] [--series=..] [--release=YYYY-MM-DD] [--printed-total=N] [--total=N] [--dry-run]');
  process.exit(1);
}

// TCGplayer CDN, same pattern as scripts/ingest/tcgplayer-jp-images.mjs.
const imgLarge = (id) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_1000x1000.jpg`;
const imgSmall = (id) => `https://product-images.tcgplayer.com/fit-in/437x437/${id}.jpg`;

async function fetchAllCards(slug) {
  const out = [];
  let calls = 0;
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(
      `https://api.justtcg.com/v1/cards?game=pokemon&set=${encodeURIComponent(slug)}&limit=100&offset=${offset}`,
      { headers: { 'x-api-key': JUSTTCG_KEY } },
    );
    calls++;
    if (!r.ok) throw new Error(`JustTCG ${r.status} for ${slug}`);
    const j = await r.json();
    out.push(...(j.data || []));
    if (!j.meta?.hasMore) break;
  }
  return { items: out, calls };
}

(async () => {
  // 5. collision guard
  const { data: existingSet, error: exErr } = await supabase
    .from('pokemon_sets').select('id, name, language').eq('id', SET_ID).maybeSingle();
  if (exErr) throw new Error(`collision check: ${exErr.message}`);
  if (existingSet && existingSet.language !== 'en') {
    throw new Error(`SKIPPED: id "${SET_ID}" is held by a ${existingSet.language} set ("${existingSet.name}"). Overwriting it would destroy that row.`);
  }

  const { items, calls } = await fetchAllCards(SLUG);
  // 2. drop sealed products
  const cards = items.filter((c) => c.number && c.number !== 'N/A');

  const rows = [];
  const seen = new Set();
  for (const c of cards) {
    const m = String(c.number).match(/^([0-9]+)([A-Za-z]*)(?:\/([0-9]+))?/);
    if (!m) { console.log(`  skip unparseable number "${c.number}" (${c.name})`); continue; }
    const num = m[1].padStart(3, '0') + m[2];
    const id = `${SET_ID}-${num}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // 3. strip the parallel-disambiguating number suffix from the name
    const name = String(c.name).replace(/\s*-\s*\d+\/\d+\s*$/, '').trim();
    const printings = [...new Set((c.variants || []).map((v) => v.printing).filter(Boolean))];
    rows.push({
      id,
      name,
      // english_name stays NULL: on EN rows `name` IS the English name, and a
      // duplicate double-indexes the row in buildMatcher (_shared/cardMatch.ts),
      // which makes every card in the set ambiguous and silently unpriceable.
      // me05.5 sat at inflated launch prices for 5 days this way (2026-09-21).
      english_name: null,
      language: 'en',
      game: 'pokemon',
      set_id: SET_ID,
      number: num,
      rarity: c.rarity || null,
      image_small: c.tcgplayerId ? imgSmall(c.tcgplayerId) : null,
      image_large: c.tcgplayerId ? imgLarge(c.tcgplayerId) : null,
      raw_data: {
        source: 'justtcg',
        justtcg_id: c.id,
        justtcg_set: SLUG,
        tcgplayerId: c.tcgplayerId || null,
        printedNumber: c.number,
        printings,
        set: { id: SET_ID, name: flags.name || existingSet?.name || SET_ID, printedTotal: Number(flags['printed-total']) || null },
      },
    });
  }
  rows.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  // 1. never clobber mirrored art
  const { data: priorRows, error: priorErr } = await supabase
    .from('pokemon_cards').select('id, image_small, image_large').eq('set_id', SET_ID);
  if (priorErr) throw new Error(`prior-image lookup: ${priorErr.message}`);
  const priorIds = new Set((priorRows || []).map((r) => r.id));
  const mirrored = new Map(
    (priorRows || []).filter((r) => (r.image_small || '').includes('supabase.co')).map((r) => [r.id, r]),
  );
  let kept = 0;
  for (const r of rows) {
    const prior = mirrored.get(r.id);
    if (!prior) continue;
    r.image_small = prior.image_small;
    r.image_large = prior.image_large || prior.image_small;
    kept++;
  }

  const newRows = rows.filter((r) => !priorIds.has(r.id));
  console.log(`[${SET_ID}] JustTCG ${SLUG}: ${items.length} items -> ${cards.length} cards -> ${rows.length} rows`);
  console.log(`[${SET_ID}] existing ${priorIds.size} | NEW ${newRows.length} | kept mirrored art for ${kept}`);
  if (newRows.length) {
    console.log('  new: ' + newRows.map((r) => `${r.number} ${r.name} [${r.rarity}]`).join('\n       '));
  }
  console.log(`[${SET_ID}] JustTCG calls: ${calls}`);

  if (DRY) { console.log('dry-run; no writes'); return; }
  if (!rows.length) { console.log('nothing to write'); return; }

  const setRow = {
    id: SET_ID,
    name: flags.name || existingSet?.name || SET_ID,
    game: 'pokemon',
    language: 'en',
  };
  if (flags.series) setRow.series = flags.series;
  if (flags.release) setRow.release_date = flags.release;
  if (flags['printed-total']) setRow.printed_total = Number(flags['printed-total']);
  // 4. true set size, not what we ingested
  if (flags.total) setRow.total = Number(flags.total);

  const { error: se } = await supabase.from('pokemon_sets').upsert([setRow], { onConflict: 'id' });
  if (se) throw new Error(`set upsert: ${se.message}`);

  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 50), { onConflict: 'id' });
    if (error) throw new Error(`card upsert: ${error.message}`);
  }

  // so batch-price-english can resolve the set without a code change
  const { error: me } = await supabase
    .from('marketplace_configs').upsert([{ set_id: SET_ID, justtcg_slug: SLUG, active: true }], { onConflict: 'set_id' });
  if (me) throw new Error(`marketplace_configs upsert: ${me.message}`);

  console.log(`[${SET_ID}] committed ${rows.length} rows (${newRows.length} new).`);
  if (newRows.length) {
    console.log('  follow-ups: node scripts/ingest/mirror-card-images.mjs --game=pokemon --language=en --host=tcgplayer');
    console.log('              node scripts/backfill-phashes.mjs --game=pokemon --language=en');
  }
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
