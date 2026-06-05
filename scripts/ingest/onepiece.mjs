// optcgapi.com -> pokemon_cards/pokemon_sets ingestion for the One Piece Card Game.
//
// Third catalog source (after Scryfall/MTG and YGOPRODeck/Yu-Gi-Oh), free, no key.
// optcgapi exposes /api/allSets/ and /api/sets/<SET-ID>/ with direct card images.
//
//   node scripts/ingest/onepiece.mjs OP-07 OP-08    # specific sets
//   node scripts/ingest/onepiece.mjs --all          # every set optcgapi lists
//   node scripts/ingest/onepiece.mjs                # defaults to a recent set
//
// IDs namespaced: set `op-<setid>` (op-op-07), card `op-<card_set_id>` (op-op07-015).
// optcgapi card names carry a trailing "(NNN)"; stripped so they match JustTCG names.
// Idempotent (upsert on PK).

import { createClient } from '@supabase/supabase-js';
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function optcg(path) {
  await sleep(200);
  const res = await fetch(`https://optcgapi.com${path}`, { headers: { 'User-Agent': 'CardStreetTCG/1.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`optcgapi ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const cleanName = (n) => (n || '').replace(/\s*\(\d+\)\s*$/, '').trim();

async function ingestSet(setId, setName) {
  const cards = await optcg(`/api/sets/${setId}/`);
  if (!Array.isArray(cards) || !cards.length) {
    console.error(`[op] no cards for ${setId}`);
    return;
  }
  const setRowId = `op-${setId.toLowerCase()}`;
  const { error: setErr } = await supabase.from('pokemon_sets').upsert(
    {
      id: setRowId,
      name: setName || cards[0].set_name,
      series: 'One Piece Card Game',
      printed_total: cards.length,
      total: cards.length,
      language: 'en',
      game: 'onepiece',
    },
    { onConflict: 'id' },
  );
  if (setErr) throw setErr;

  const rows = [];
  const seen = new Set();
  for (const c of cards) {
    const code = c.card_set_id; // e.g. OP07-015
    if (!code) continue;
    // Set-scoped id: One Piece reprints reuse the original card number across
    // sets (a Premium Booster can reprint OP07-015), so a global code-based id
    // would let a later set overwrite an earlier set's card. Scope by set.
    const rowId = `${setRowId}-${code.toLowerCase()}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    rows.push({
      id: rowId,
      name: cleanName(c.card_name),
      set_id: setRowId,
      number: (code.split('-').pop() || '').replace(/[^0-9]/g, '') || null,
      rarity: c.rarity || null,
      image_small: c.card_image || '',
      image_large: c.card_image || '',
      language: 'en',
      game: 'onepiece',
      raw_data: {
        card_set_id: code,
        color: c.card_color ?? null,
        type: c.card_type ?? null,
        cost: c.card_cost ?? null,
        power: c.card_power ?? null,
        optcg_market_price: c.market_price ?? null,
      },
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`[op] ${setName || setId} (${setId}): ${rows.length} cards -> ${setRowId}`);
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const ids = args.filter((a) => !a.startsWith('--'));

  const allSets = await optcg('/api/allSets/');
  const nameById = new Map(allSets.map((s) => [s.set_id.toUpperCase(), s.set_name]));

  let targets;
  if (all) targets = allSets.map((s) => s.set_id);
  else targets = ids.length ? ids : ['OP-07'];

  for (const id of targets) {
    try {
      await ingestSet(id.toUpperCase(), nameById.get(id.toUpperCase()));
    } catch (e) {
      console.error(`[op] FAILED ${id}:`, e.message);
    }
  }
}

main().then(() => process.exit(0));
