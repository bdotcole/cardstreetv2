// YGOPRODeck -> pokemon_cards/pokemon_sets ingestion for Yu-Gi-Oh!.
//
// Second catalog source after Scryfall, deliberately a different shape (numeric
// passcode ids, card_sets[] with per-printing set codes/rarities, card_images[]),
// to prove the multi-game pipeline isn't Scryfall-specific. Free, no API key.
//
//   node scripts/ingest/ygoprodeck.mjs BLZD RA05     # sets by YGOPRODeck set code
//   node scripts/ingest/ygoprodeck.mjs               # defaults to a recent set
//
// One catalog row per *printing* (set code, e.g. BLZD-EN096) so distinct collector
// numbers/rarities in a set are preserved. IDs namespaced ygo-<setcode>.
// Rerun is idempotent (upsert on PK).

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
async function ygo(url) {
  await sleep(120);
  const res = await fetch(url, { headers: { 'User-Agent': 'CardStreetTCG/1.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`YGOPRODeck ${res.status} for ${url}: ${await res.text()}`);
  return res.json();
}

async function ingestSet(code, setMeta) {
  const meta = setMeta.get(code.toUpperCase());
  if (!meta) {
    console.error(`[ygo] unknown set code ${code}`);
    return;
  }
  const setRowId = `ygo-${code.toLowerCase()}`;
  const { error: setErr } = await supabase.from('pokemon_sets').upsert(
    {
      id: setRowId,
      name: meta.set_name,
      series: 'Yu-Gi-Oh!',
      printed_total: meta.num_of_cards || 0,
      total: meta.num_of_cards || 0,
      release_date: meta.tcg_date || null,
      symbol_url: meta.set_image || null,
      logo_url: meta.set_image || null,
      language: 'en',
      game: 'yugioh',
    },
    { onConflict: 'id' },
  );
  if (setErr) throw setErr;

  // cardinfo is queried by set NAME, returns every card in that set.
  const info = await ygo(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(meta.set_name)}`);
  const rows = [];
  const seen = new Set();
  for (const card of info.data || []) {
    const img = card.card_images?.[0] || {};
    for (const cs of card.card_sets || []) {
      if (cs.set_name !== meta.set_name) continue; // a card may belong to many sets
      const setCode = cs.set_code; // e.g. BLZD-EN096
      const rowId = `ygo-${(setCode || `${code}-${card.id}`).toLowerCase()}`;
      if (seen.has(rowId)) continue;
      seen.add(rowId);
      const number = (setCode?.split('-').pop() || '').replace(/[^0-9]/g, '') || null;
      rows.push({
        id: rowId,
        name: card.name,
        set_id: setRowId,
        number,
        rarity: cs.set_rarity || null,
        image_small: img.image_url_small || '',
        image_large: img.image_url || '',
        language: 'en',
        game: 'yugioh',
        raw_data: {
          ygo_id: card.id,
          set_code: setCode,
          type: card.type ?? null,
          attribute: card.attribute ?? null,
          race: card.race ?? null,
        },
      });
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`[ygo] ${meta.set_name} (${code}): ${rows.length} printings -> ${setRowId}`);
}

async function main() {
  const codes = process.argv.slice(2);
  const targets = codes.length ? codes : ['BLZD']; // Blazing Dominion, recent core set
  const allSets = await ygo('https://db.ygoprodeck.com/api/v7/cardsets.php');
  const setMeta = new Map(allSets.filter((s) => s.set_code).map((s) => [s.set_code.toUpperCase(), s]));
  for (const code of targets) {
    try {
      await ingestSet(code, setMeta);
    } catch (e) {
      console.error(`[ygo] FAILED ${code}:`, e.message);
    }
  }
}

main().then(() => process.exit(0));
