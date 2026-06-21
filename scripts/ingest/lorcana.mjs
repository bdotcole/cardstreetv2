// LorcanaJSON -> pokemon_cards/pokemon_sets ingestion for Disney Lorcana.
//
// Sixth catalog source. LorcanaJSON (lorcanajson.org) is a single allCards.json
// with a `sets` dict + a `cards` array, official Ravensburger CDN images, and an
// `externalLinks.tcgPlayerId` per card — so JustTCG pricing joins exactly on
// tcgplayer_id (the MTG/Riftbound path). It's cards-only (no sealed products).
//
//   node scripts/ingest/lorcana.mjs              # every set in the dataset
//   node scripts/ingest/lorcana.mjs 1 Q1         # one or more sets by setCode
//
// IDs are namespaced (set `lorcana-<setCode>`, card `lorcana-<lorcanaJsonId>`,
// the id being globally unique) so they never collide with Pokemon rows.
// Idempotent (upsert on PK).

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

const ALL_CARDS_URL = 'https://lorcanajson.org/files/current/en/allCards.json';

// LorcanaJSON gives no set logo, and the SetBrowser tile falls back to a bare
// letter when set.images.logo is empty. Represent the set by an iconic card
// instead: prefer a Legendary Character, highest rarity, lowest number.
const RARITY_RANK = { Legendary: 0, 'Super Rare': 1, Rare: 2, Enchanted: 3, Uncommon: 4, Common: 5, Special: 6 };
function pickCover(rows) {
  return [...rows].sort((a, b) => {
    const ca = a.raw_data.type === 'Character' ? 0 : 1;
    const cb = b.raw_data.type === 'Character' ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const ra = RARITY_RANK[a.rarity] ?? 9, rb = RARITY_RANK[b.rarity] ?? 9;
    if (ra !== rb) return ra - rb;
    return (parseInt(a.number) || 999) - (parseInt(b.number) || 999);
  })[0];
}

async function ingestSet(setCode, setMeta, cards) {
  const setRowId = `lorcana-${String(setCode).toLowerCase()}`;
  const rows = cards.map((c) => ({
    id: `lorcana-${c.id}`,
    name: c.fullName || c.name,
    set_id: setRowId,
    number: c.number != null ? String(c.number) : null,
    rarity: c.rarity || null,
    image_small: c.images?.thumbnail || c.images?.full || '',
    image_large: c.images?.full || c.images?.thumbnail || '',
    language: 'en',
    game: 'lorcana',
    raw_data: {
      // tcgplayer_id is the JustTCG join key (see justtcg-prices.mjs loadCatalog).
      tcgplayer_id: c.externalLinks?.tcgPlayerId ?? null,
      images: c.images ?? null,
      type: c.type ?? null,
      color: c.color ?? null,
      cost: c.cost ?? null,
      inkwell: c.inkwell ?? null,
      strength: c.strength ?? null,
      willpower: c.willpower ?? null,
      lore: c.lore ?? null,
      rarity: c.rarity ?? null,
      full_identifier: c.fullIdentifier ?? null,
    },
  }));

  const cover = pickCover(rows);
  const { error: setErr } = await supabase.from('pokemon_sets').upsert(
    {
      id: setRowId,
      name: setMeta?.name || `Set ${setCode}`,
      series: 'Disney Lorcana',
      printed_total: rows.length,
      total: rows.length,
      release_date: setMeta?.releaseDate || null,
      // No upstream set logo — represent the set by an iconic card's art.
      symbol_url: cover?.image_small || null,
      logo_url: cover?.image_small || null,
      language: 'en',
      game: 'lorcana',
    },
    { onConflict: 'id' },
  );
  if (setErr) throw setErr;

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
    if (error) throw error;
  }
  console.log(`[lorcana] ${setMeta?.name || setCode} (${setCode}): ${rows.length} cards -> ${setRowId}`);
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const data = await (await fetch(ALL_CARDS_URL, { headers: { 'User-Agent': 'CardStreetTCG/1.0', Accept: 'application/json' } })).json();
  const sets = data.sets || {};
  const cards = data.cards || [];

  // Group cards by setCode (matches the keys of the sets dict).
  const bySet = new Map();
  for (const c of cards) {
    const code = c.setCode;
    if (!code) continue;
    if (!bySet.has(code)) bySet.set(code, []);
    bySet.get(code).push(c);
  }

  const targets = only.length ? only : [...bySet.keys()];
  for (const code of targets) {
    const group = bySet.get(code);
    if (!group?.length) {
      console.error(`[lorcana] no cards for set ${code}`);
      continue;
    }
    try {
      await ingestSet(code, sets[code], group);
    } catch (e) {
      console.error(`[lorcana] FAILED ${code}:`, e.message);
    }
  }
}

main().then(() => process.exit(0));
