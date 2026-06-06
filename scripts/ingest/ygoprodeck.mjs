// YGOPRODeck -> pokemon_cards/pokemon_sets ingestion for Yu-Gi-Oh!.
//
// Second catalog source after Scryfall, deliberately a different shape (numeric
// passcode ids, card_sets[] with per-printing set codes/rarities, card_images[]),
// to prove the multi-game pipeline isn't Scryfall-specific. Free, no API key.
//
//   node scripts/ingest/ygoprodeck.mjs BLZD RA05     # sets by YGOPRODeck set code
//   node scripts/ingest/ygoprodeck.mjs --all         # every set in the YGOPRODeck catalog
//   node scripts/ingest/ygoprodeck.mjs --all --since=2020-01-01   # sets released on/after a date
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
  // YGOPRODeck stores some set names with HTML-encoded entities (e.g. Legendary
  // 5D&apos;s Decks). cardinfo.php matches on the *decoded* name, and we want the
  // clean name stored, so decode before both the lookup and the upsert.
  const setName = (meta.set_name || '').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  // cardinfo is queried by set NAME, returns every card in that set. Fetch BEFORE
  // writing the set row so a set YGOPRODeck lists but hasn't linked cards to (e.g.
  // a just-announced set) doesn't leave an empty set row in the catalog.
  const info = await ygo(`https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(setName)}`);
  const rows = [];
  const seen = new Set();
  for (const card of info.data || []) {
    const img = card.card_images?.[0] || {};
    for (const cs of card.card_sets || []) {
      if (cs.set_name !== setName) continue; // a card may belong to many sets
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
  if (!rows.length) {
    console.warn(`[ygo] ${setName} (${code}): no cards linked upstream — skipping (no set row written)`);
    return;
  }

  const { error: setErr } = await supabase.from('pokemon_sets').upsert(
    {
      id: setRowId,
      name: setName,
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

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`[ygo] ${setName} (${code}): ${rows.length} printings -> ${setRowId}`);
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const since = args.find((a) => a.startsWith('--since='))?.split('=')[1];
  const codes = args.filter((a) => !a.startsWith('--'));

  const allSets = await ygo('https://db.ygoprodeck.com/api/v7/cardsets.php');
  const setMeta = new Map(allSets.filter((s) => s.set_code).map((s) => [s.set_code.toUpperCase(), s]));

  let targets;
  if (all) {
    // Every set with at least one card; optionally only those released on/after --since.
    // Sorted oldest-first so a mid-run failure leaves a contiguous recent gap, not holes.
    targets = allSets
      .filter((s) => s.set_code && (+s.num_of_cards || 0) > 0 && (!since || (s.tcg_date && s.tcg_date >= since)))
      .sort((a, b) => (a.tcg_date || '').localeCompare(b.tcg_date || ''))
      .map((s) => s.set_code);
  } else {
    targets = codes.length ? codes : ['BLZD']; // Blazing Dominion, recent core set
  }

  console.log(`[ygo] ingesting ${targets.length} set(s)`);
  let done = 0;
  for (const code of targets) {
    try {
      await ingestSet(code, setMeta);
    } catch (e) {
      console.error(`[ygo] FAILED ${code}:`, e.message);
    }
    if (++done % 25 === 0) console.log(`[ygo] progress ${done}/${targets.length}`);
  }
}

main().then(() => process.exit(0));
