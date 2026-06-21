// JustTCG -> market_values price ingestion (game-generic, set-scoped).
//
// Catalog + images come from per-game sources (Scryfall for MTG, etc.); JustTCG
// supplies live pricing. This pulls prices ONLY for sets we have ingested, so it
// stays inside the Starter plan budget (10K req/month, 1K/day, 50 req/min, 100
// cards/request).
//
//   node scripts/ingest/justtcg-prices.mjs mtg            # all our sets for the game
//   node scripts/ingest/justtcg-prices.mjs mtg --set=blb  # one set (our scryfall code suffix)
//
// Join: card.tcgplayerId (Scryfall stores tcgplayer_id in raw_data) -> exact.
//       fallback set+number+name.
// Prices are USD; market_values.currency='USD' so cardMapper converts to THB.
// Idempotent via the daily-unique index (card_id, language, condition, printing, date).

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

const API_KEY = env.JUSTTCG_API_KEY;
const BASE = 'https://api.justtcg.com/v1';
const PAGE = 100; // Starter plan: 100 cards per request
const RATE_MS = 1300; // Starter plan: 50 req/min -> >=1.2s between requests
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Our game id -> JustTCG game slug (confirmed via GET /games).
const GAME_SLUG = {
  mtg: 'magic-the-gathering',
  pokemon: 'pokemon',
  'pokemon-jp': 'pokemon-japan',
  yugioh: 'yugioh',
  onepiece: 'one-piece-card-game',
  riftbound: 'riftbound-league-of-legends-trading-card-game',
  lorcana: 'disney-lorcana',
};

// Our set_id -> JustTCG set id, for sets whose names don't match by
// normalization (JustTCG prefixes the SM era with "SM - ", etc.).
const SET_ID_OVERRIDES = {
  sm1: 'sm-base-set-pokemon',
  sm2: 'sm-guardians-rising-pokemon',
  sm3: 'sm-burning-shadows-pokemon',
  sm4: 'sm-crimson-invasion-pokemon',
  sm5: 'sm-ultra-prism-pokemon',
  sm6: 'sm-forbidden-light-pokemon',
  sm7: 'sm-celestial-storm-pokemon',
  sm8: 'sm-lost-thunder-pokemon',
  sm9: 'sm-team-up-pokemon',
  sm10: 'sm-unbroken-bonds-pokemon',
  sm11: 'sm-unified-minds-pokemon',
  sm12: 'sm-cosmic-eclipse-pokemon',
  smp: 'sm-promos-pokemon',
  // Lorcana: LorcanaJSON names it "The Reign of Jafar"; JustTCG drops the "The".
  'lorcana-8': 'reign-of-jafar-disney-lorcana',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function jtcg(path) {
  await sleep(RATE_MS);
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': API_KEY } });
  if (res.status === 429) {
    // Rate limited despite pacing — back off and retry once.
    await sleep(5000);
    return jtcg(path);
  }
  if (!res.ok) throw new Error(`JustTCG ${res.status} for ${path}: ${await res.text()}`);
  return res.json();
}

// Our catalog rows for this game: index by tcgplayerId and by set/number/name.
// setFilter is a comma list of set ids; each entry matches either the literal
// set_id (Pokemon sets aren't namespaced, e.g. "me03") or the game-namespaced
// form (Scryfall/ygoprodeck ids, e.g. "mtg-blb" from "--set=blb").
// "SM05" -> "sm5": case-insensitive, leading zeros in the numeric part stripped
const normNum = (s) => String(s || '').toLowerCase().replace(/(\D)0+(?=\d)/, '$1').replace(/^0+(?=\d)/, '');

async function loadCatalog(ourGame, setFilter) {
  const byTcgId = new Map();
  const byName = new Map(); // `${ourSetId}|${normName}` -> our card id (first printing)
  const byNumber = new Map(); // `${ourSetId}|${normNum}` -> our card id
  const ourSets = new Map(); // normalized set name -> our set_id
  const setIds = setFilter
    ? setFilter.split(',').flatMap((s) => [s.trim(), `${ourGame}-${s.trim()}`])
    : null;
  let from = 0;
  for (;;) {
    let q = supabase
      .from('pokemon_cards')
      .select('id, name, number, set_id, raw_data->tcgplayer_id, pokemon_sets(name)')
      .eq('game', ourGame);
    if (setIds) q = q.in('set_id', setIds);
    // Stable ORDER BY so range-paginating a large catalog (>1000 rows, e.g.
    // Lorcana's ~3k) reads every row exactly once. Without it PostgREST's
    // arbitrary order can skip whole sets across page boundaries.
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const c of data) {
      if (c.tcgplayer_id) byTcgId.set(String(c.tcgplayer_id), c.id);
      const nameKey = `${c.set_id}|${norm(c.name)}`;
      if (!byName.has(nameKey)) byName.set(nameKey, c.id);
      if (c.number) {
        const numKey = `${c.set_id}|${normNum(c.number)}`;
        if (!byNumber.has(numKey)) byNumber.set(numKey, c.id);
      }
      const setName = c.pokemon_sets?.name;
      if (setName) ourSets.set(norm(setName), c.set_id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return { byTcgId, byName, byNumber, ourSets };
}

// market_values is unique on (card_id, language, condition) — one current price
// per condition, not per printing. Collapse variants to one row per condition,
// preferring the Normal printing as the canonical price.
function rowsForCard(card, cardId, ourGame) {
  const byCond = new Map();
  for (const v of card.variants || []) {
    if (typeof v.price !== 'number' || v.price <= 0) continue;
    const condition = v.condition || 'Near Mint';
    const prev = byCond.get(condition);
    if (!prev || (v.printing === 'Normal' && prev.printing !== 'Normal')) {
      byCond.set(condition, {
        card_id: cardId,
        language: 'en',
        condition,
        printing: v.printing || null,
        market_avg: v.price,
        currency: 'USD',
        game: ourGame,
        last_updated: new Date().toISOString(),
      });
    }
  }
  return [...byCond.values()];
}

async function pricesForSet(justtcgSetId, ourSetId, slug, ourGame, idx) {
  let offset = 0;
  let matched = 0;
  let rows = [];
  for (;;) {
    const page = await jtcg(`/cards?game=${encodeURIComponent(slug)}&set=${encodeURIComponent(justtcgSetId)}&limit=${PAGE}&offset=${offset}`);
    const cards = page.data || [];
    if (!cards.length) break;
    for (const card of cards) {
      // Prefer exact tcgplayerId join (MTG/Scryfall); fall back to name within
      // the resolved set (Yu-Gi-Oh and any source lacking tcgplayer ids).
      let cardId = card.tcgplayerId ? idx.byTcgId.get(String(card.tcgplayerId)) : undefined;
      if (!cardId) cardId = idx.byName.get(`${ourSetId}|${norm(card.name)}`);
      // promo sets embed the number in the name ("Dragonite GX - SM156"); match
      // by collector number, skipping qualified variants (Prerelease/Staff)
      if (!cardId && card.number && !/[([]/.test(card.name)) {
        cardId = idx.byNumber.get(`${ourSetId}|${normNum(card.number)}`);
      }
      if (!cardId) continue;
      matched++;
      rows.push(...rowsForCard(card, cardId, ourGame));
    }
    offset += cards.length;
    if (cards.length < PAGE) break;
  }

  // Name-matched games (Yu-Gi-Oh, One Piece) collapse multiple JustTCG entries
  // (alt arts, parallels sharing a printed name) onto one of our card rows, so the
  // batch can contain duplicate (card_id, condition) rows. Postgres rejects those
  // in a single ON CONFLICT upsert ("cannot affect row a second time"), so dedupe
  // first, preferring the Normal printing as the canonical price.
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.card_id}|${r.condition}`;
    const prev = byKey.get(key);
    if (!prev || (r.printing === 'Normal' && prev.printing !== 'Normal')) byKey.set(key, r);
  }
  rows = [...byKey.values()];

  // Upsert on the real unique constraint (one current price per card/lang/condition).
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('market_values')
      .upsert(rows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
    if (error) throw error;
  }
  return { matched, priced: rows.length };
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing from .env.local');
  const ourGame = (process.argv[2] || 'mtg').toLowerCase();
  const setFilter = process.argv.find((a) => a.startsWith('--set='))?.split('=')[1];
  const slug = GAME_SLUG[ourGame];
  if (!slug) throw new Error(`No JustTCG slug mapped for game "${ourGame}"`);

  const idx = await loadCatalog(ourGame, setFilter);
  console.log(`[justtcg] ${ourGame} (${slug}): catalog ${idx.byTcgId.size} tcgIds, ${idx.ourSets.size} sets`);

  // Resolve each of our sets to a JustTCG set id by exact normalized name.
  const jtcgSets = ((await jtcg(`/sets?game=${encodeURIComponent(slug)}`)).data || []);
  const jtcgByName = new Map(jtcgSets.map((s) => [norm(s.name), s.id]));

  let totalMatched = 0;
  let totalPriced = 0;
  for (const [normName, ourSetId] of idx.ourSets) {
    const jtcgSetId = SET_ID_OVERRIDES[ourSetId] || jtcgByName.get(normName);
    if (!jtcgSetId) {
      console.warn(`[justtcg] no JustTCG set matched "${ourSetId}" (name "${normName}") — skipping`);
      continue;
    }
    const { matched, priced } = await pricesForSet(jtcgSetId, ourSetId, slug, ourGame, idx);
    console.log(`[justtcg] ${ourSetId} <- ${jtcgSetId}: matched ${matched}, upserted ${priced}`);
    totalMatched += matched;
    totalPriced += priced;
  }
  console.log(`[justtcg] done: matched ${totalMatched} cards, upserted ${totalPriced} price rows`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[justtcg] FAILED:', e.message);
  process.exit(1);
});
