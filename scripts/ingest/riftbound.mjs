// apitcg riftbound-tcg-data -> pokemon_cards/pokemon_sets ingestion for Riftbound
// (League of Legends Trading Card Game).
//
// Fifth catalog source. The community-maintained apitcg dataset is plain JSON on
// GitHub (no key), with TCGPlayer product ids and TCGPlayer-CDN image URLs baked
// in — so JustTCG pricing joins exactly on tcgplayer_id (the MTG/Scryfall path),
// and the images host is already allowlisted in next.config.js.
//
//   node scripts/ingest/riftbound.mjs                 # every set the repo lists
//   node scripts/ingest/riftbound.mjs origins         # one or more sets by id
//
// IDs are namespaced (set `rb-<setId>`, card `rb-<apitcgCardId>`) so they never
// collide with Pokemon rows. Sealed products (Booster Pack/Display — no cardType)
// are skipped; only actual cards are ingested. Idempotent (upsert on PK).

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

const RAW_BASE = 'https://raw.githubusercontent.com/apitcg/riftbound-tcg-data/main';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// apitcg sets carry no set logo/symbol, and the SetBrowser tile falls back to a
// bare letter when set.images.logo is empty. Use an iconic card as the set cover
// instead: prefer a base Champion Unit, highest rarity, lowest number.
const RARITY_RANK = { Epic: 0, Rare: 1, Uncommon: 2, Common: 3 };
function pickCover(rows) {
  return [...rows].sort((a, b) => {
    const ta = /champion/i.test(a.raw_data.card_type || '') ? 0 : (/legend/i.test(a.raw_data.card_type || '') ? 1 : 2);
    const tb = /champion/i.test(b.raw_data.card_type || '') ? 0 : (/legend/i.test(b.raw_data.card_type || '') ? 1 : 2);
    if (ta !== tb) return ta - tb;
    const ra = RARITY_RANK[a.rarity] ?? 9, rb = RARITY_RANK[b.rarity] ?? 9;
    if (ra !== rb) return ra - rb;
    return (parseInt(a.number) || 999) - (parseInt(b.number) || 999);
  })[0];
}

async function ghJson(path) {
  await sleep(150);
  const res = await fetch(`${RAW_BASE}${path}`, { headers: { 'User-Agent': 'CardStreetTCG/1.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`apitcg ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function ingestSet(set) {
  const cards = await ghJson(`/cards/en/${set.id}.json`);
  if (!Array.isArray(cards) || !cards.length) {
    console.error(`[rb] no cards for ${set.id}`);
    return;
  }

  const rows = [];
  const seen = new Set();
  for (const c of cards) {
    // Sealed products (Booster Pack/Display) carry no cardType and no rarity —
    // skip them so the catalog holds only playable cards.
    if (!c.cardType) continue;
    const rowId = `rb-${c.id}`;
    if (seen.has(rowId)) continue;
    seen.add(rowId);
    rows.push({
      id: rowId,
      name: c.name,
      set_id: `rb-${set.id}`,
      number: c.number || null,
      rarity: c.rarity || null,
      image_small: c.images?.small || '',
      image_large: c.images?.large || '',
      language: 'en',
      game: 'riftbound',
      raw_data: {
        // tcgplayer_id is the JustTCG join key (see justtcg-prices.mjs loadCatalog).
        tcgplayer_id: c.tcgplayer?.id ?? null,
        tcgplayer: c.tcgplayer ?? null,
        set: c.set ?? null,
        images: c.images ?? null,
        card_type: c.cardType ?? null,
        domain: c.domain ?? null,
        energy_cost: c.energyCost ?? null,
        power_cost: c.powerCost ?? null,
        might: c.might ?? null,
        description: c.description ?? null,
        flavor_text: c.flavorText ?? null,
      },
    });
  }

  const cover = pickCover(rows);
  const { error: setErr } = await supabase.from('pokemon_sets').upsert(
    {
      id: `rb-${set.id}`,
      name: set.name,
      series: 'Riftbound',
      printed_total: rows.length,
      total: rows.length,
      release_date: set.releaseDate || null,
      // No upstream set logo — represent the set by an iconic card's art.
      symbol_url: cover?.image_small || null,
      logo_url: cover?.image_small || null,
      language: 'en',
      game: 'riftbound',
    },
    { onConflict: 'id' },
  );
  if (setErr) throw setErr;

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`[rb] ${set.name} (${set.id}): ${rows.length} cards -> rb-${set.id}`);
}

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const allSets = await ghJson('/sets/en.json'); // plain JSON array
  const byId = new Map(allSets.map((s) => [s.id, s]));

  const targets = ids.length ? ids.map((id) => byId.get(id)).filter(Boolean) : allSets;
  if (ids.length && targets.length !== ids.length) {
    const missing = ids.filter((id) => !byId.has(id));
    console.error(`[rb] unknown set ids: ${missing.join(', ')} (have: ${allSets.map((s) => s.id).join(', ')})`);
  }

  for (const set of targets) {
    try {
      await ingestSet(set);
    } catch (e) {
      console.error(`[rb] FAILED ${set.id}:`, e.message);
    }
  }
}

main().then(() => process.exit(0));
