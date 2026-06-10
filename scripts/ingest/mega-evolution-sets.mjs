// TCGdex -> pokemon_sets/pokemon_cards ingestion for English Mega Evolution sets.
//
// English Pokemon catalog comes from TCGdex (free, no API key). The siblings
// me01/me02/me02.5 were ingested this way; this script adds later sets in the
// same series by their TCGdex id.
//
//   node scripts/ingest/mega-evolution-sets.mjs me03 me04   # specific sets
//   node scripts/ingest/mega-evolution-sets.mjs              # defaults to me03 me04
//
// Set/card ids reuse the TCGdex id verbatim (me03, me03-001, ...) to match the
// existing me0x rows. Rerun is idempotent: rows are upserted on their primary key.
// game defaults to 'pokemon' and language to 'en' at the column level, but both
// are set explicitly here so the rows surface in /api/sets (which filters on them).

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

const TCGDEX_API = 'https://api.tcgdex.net/v2/en';
const SET_IDS = process.argv.slice(2).length ? process.argv.slice(2) : ['me03', 'me04'];

async function tcgdex(path) {
  const res = await fetch(`${TCGDEX_API}${path}`);
  if (!res.ok) throw new Error(`TCGdex ${res.status} for ${path}`);
  return res.json();
}

async function ingestSet(setId) {
  console.log(`\n=== ${setId} ===`);
  const set = await tcgdex(`/sets/${setId}`);

  const { error: setErr } = await supabase.from('pokemon_sets').upsert([{
    id: setId,
    name: set.name,
    series: set.serie?.name || set.serie || 'Mega Evolution',
    printed_total: set.cardCount?.official || 0,
    total: set.cardCount?.total || 0,
    release_date: set.releaseDate || null,
    symbol_url: set.symbol || null,
    logo_url: set.logo || null,
    game: 'pokemon',
    language: 'en',
  }], { onConflict: 'id' });
  if (setErr) throw new Error(`set upsert: ${setErr.message}`);
  console.log(`set: ${set.name} (${set.cardCount?.total} cards)`);

  const cardList = set.cards || [];
  const transformed = [];
  const chunkSize = 15;
  for (let j = 0; j < cardList.length; j += chunkSize) {
    const chunk = cardList.slice(j, j + chunkSize);
    const details = await Promise.all(
      chunk.map((c) => fetch(`${TCGDEX_API}/cards/${c.id}`).then((r) => (r.ok ? r.json() : null)))
    );
    for (const c of details) {
      if (!c) continue;
      transformed.push({
        id: c.id,
        name: c.name,
        english_name: c.name,
        language: 'en',
        game: 'pokemon',
        set_id: setId,
        number: c.localId,
        supertype: c.category === 'Pokemon' ? 'Pokémon' : c.category,
        subtypes: c.subtypes || [],
        rarity: c.rarity,
        hp: c.hp || null,
        types: c.types || [],
        attacks: c.attacks || null,
        weaknesses: c.weaknesses || null,
        resistances: c.resistances || null,
        retreat_cost: c.retreat ? Array(c.retreat).fill('Colorless') : [],
        abilities: c.abilities || null,
        rules: c.rules || [],
        regulation_mark: c.regulationMark || null,
        // Match the stored format of the sibling me0x rows: no extension. The
        // cardMapper/imageUtils append the right TCGdex variant (low.webp/high.webp).
        image_small: c.image ? `${c.image}/low` : null,
        image_large: c.image ? `${c.image}/high` : null,
        tcgplayer_url: null,
        cardmarket_url: null,
        raw_data: {
          ...c,
          tcgplayer: c.pricing?.tcgplayer || null,
          set: { id: setId, name: set.name, printedTotal: set.cardCount?.official },
        },
      });
    }
    process.stdout.write('.');
  }

  for (let j = 0; j < transformed.length; j += 50) {
    const batch = transformed.slice(j, j + 50);
    const { error } = await supabase.from('pokemon_cards').upsert(batch, { onConflict: 'id' });
    if (error) throw new Error(`card upsert: ${error.message}`);
  }
  console.log(`\ncards: ${transformed.length} upserted`);
}

(async () => {
  for (const id of SET_IDS) {
    await ingestSet(id);
  }
  console.log('\nDone.');
})().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
