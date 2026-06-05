// Scryfall -> pokemon_cards/pokemon_sets ingestion for Magic: The Gathering.
//
// JustTCG provides prices but no images/catalog, so MTG catalog + images come
// from Scryfall (free, no API key). This script ingests one or more sets by code
// so Phase 1 can prove the multi-game path on a small subset before a full backfill.
//
//   node scripts/ingest/scryfall.mjs fdn dsk      # specific sets by code
//   node scripts/ingest/scryfall.mjs              # defaults to a small recent set
//
// IDs are namespaced (mtg-<scryfallId>, mtg-<setCode>) so they never collide with
// Pokemon rows or each other (listings.card_id has no FK). Rerun is idempotent:
// rows are upserted on their primary key.

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

const SCRYFALL_HEADERS = { 'User-Agent': 'CardStreetTCG/1.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scryfall(url) {
  // Scryfall asks for 50-100ms between requests.
  await sleep(120);
  const res = await fetch(url, { headers: SCRYFALL_HEADERS });
  if (!res.ok) throw new Error(`Scryfall ${res.status} for ${url}: ${await res.text()}`);
  return res.json();
}

function pickImages(card) {
  const u = card.image_uris || card.card_faces?.[0]?.image_uris || {};
  return { small: u.small || '', large: u.normal || u.large || '' };
}

function mapCard(card, setRowId) {
  const img = pickImages(card);
  return {
    id: `mtg-${card.id}`,
    name: card.name,
    set_id: setRowId,
    number: card.collector_number,
    rarity: card.rarity ? card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1) : null,
    image_small: img.small,
    image_large: img.large,
    language: 'en',
    game: 'mtg',
    // Keep identifiers JustTCG can match against, plus a few display fields.
    raw_data: {
      scryfall_id: card.id,
      tcgplayer_id: card.tcgplayer_id ?? null,
      oracle_id: card.oracle_id ?? null,
      type_line: card.type_line ?? null,
      set_name: card.set_name ?? null,
      images: img,
    },
  };
}

async function ingestSet(code) {
  const set = await scryfall(`https://api.scryfall.com/sets/${code}`);
  const setRowId = `mtg-${set.code}`;

  const { error: setErr } = await supabase.from('pokemon_sets').upsert(
    {
      id: setRowId,
      name: set.name,
      series: set.set_type || 'expansion',
      printed_total: set.card_count || 0,
      total: set.card_count || 0,
      release_date: set.released_at || null,
      symbol_url: set.icon_svg_uri || null,
      logo_url: set.icon_svg_uri || null,
      language: 'en',
      game: 'mtg',
    },
    { onConflict: 'id' },
  );
  if (setErr) throw setErr;

  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`set:${set.code} game:paper`)}&unique=prints&order=set`;
  let total = 0;
  while (url) {
    const page = await scryfall(url);
    const rows = (page.data || []).map((c) => mapCard(c, setRowId));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw error;
    }
    total += rows.length;
    url = page.has_more ? page.next_page : null;
  }
  console.log(`[scryfall] ${set.name} (${set.code}): ${total} cards -> ${setRowId}`);
}

async function main() {
  const args = process.argv.slice(2);
  const recent = args.includes('--recent');
  const since = args.find((a) => a.startsWith('--since='))?.split('=')[1] || '2023-01-01';
  const codeArgs = args.filter((a) => !a.startsWith('--'));

  let targets;
  if (recent) {
    // "Make Magic feel real": paper expansion/core sets from `since` onward
    // (current-era Standard + recent flagship sets). Skips digital-only,
    // commander/special/promo set types.
    const all = (await scryfall('https://api.scryfall.com/sets')).data || [];
    targets = all
      .filter((s) => ['expansion', 'core'].includes(s.set_type) && !s.digital && s.card_count > 0 && s.released_at && s.released_at >= since)
      .sort((a, b) => a.released_at.localeCompare(b.released_at))
      .map((s) => s.code);
    console.log(`[scryfall] --recent: ${targets.length} sets since ${since}: ${targets.join(', ')}`);
  } else {
    targets = codeArgs.length ? codeArgs : ['blb'];
  }

  for (const code of targets) {
    try {
      await ingestSet(code.toLowerCase());
    } catch (e) {
      console.error(`[scryfall] FAILED ${code}:`, e.message);
    }
  }
}

main().then(() => process.exit(0));
