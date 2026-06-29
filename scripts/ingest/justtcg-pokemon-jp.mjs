// JustTCG pokemon-japan -> english_name + market_values for Japanese Pokemon.
//
// Our ja rows have Japanese names and no prices. JustTCG's pokemon-japan game
// carries English card names ("Reshiram ex - 174/086") plus prices, so this one
// pass fills BOTH english_name and market_values for the JP sets it covers
// (modern SV sets; older JP-exclusive sets mostly aren't in JustTCG).
//
//   node scripts/ingest/justtcg-pokemon-jp.mjs
//
// Set match: our set id (e.g. SV11W) -> JustTCG set whose slug starts with
// "<lowerid>-" (e.g. sv11w-white-flare-pokemon-japan). Card match: number within
// set (parse leading digits; JustTCG "174/086" -> 174, our "001" -> 1).

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
const PAGE = 100;
const RATE_MS = 1300;
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Vintage + deck-set ids whose JustTCG slug is an English name, not "<id>-...",
// so the id-prefix match below can't find them. Only sets that carry collector
// numbers in JustTCG belong here — the number-within-set match is reliable for
// them (verified 28-30/30 on samples). The pre-e-Card sets (neo1-4, PMCG1-6)
// have number:N/A in JustTCG and need name-bridge matching, so they are NOT
// listed here (a separate pass handles them).
const JP_SET_SLUG_OVERRIDES = {
  web1: 'pokemon-web-pokemon-japan',
  VS1: 'pokemon-vs-pokemon-japan',
  E1: 'base-expansion-pack-pokemon-japan',
  E2: 'the-town-on-no-map-pokemon-japan',
  E3: 'wind-from-the-sea-pokemon-japan',
  E4: 'split-earth-pokemon-japan',
  E5: 'mysterious-mountains-pokemon-japan',
  PCG1: 'flight-of-legends-pokemon-japan',
  PCG2: 'clash-of-the-blue-sky-pokemon-japan',
  PCG3: 'rocket-gang-strikes-back-pokemon-japan',
  PCG4: 'golden-sky-silvery-ocean-pokemon-japan',
  PCG5: 'mirage-forest-pokemon-japan',
  PCG6: 'holon-research-tower-pokemon-japan',
  PCG7: 'holon-phantom-pokemon-japan',
  PCG8: 'miracle-crystal-pokemon-japan',
  PCG9: 'offense-and-defense-of-the-furthest-ends-pokemon-japan',
  SVK: 'sv-stellar-miracle-deck-build-box-pokemon-japan',
  SVLN: 'sv-sylveon-ex-stellar-tera-type-starter-set-pokemon-japan',
  SVLS: 'sv-ceruledge-ex-stellar-tera-type-starter-set-pokemon-japan',
};

// CLI: --sets=E1,PCG7 scopes the run to those set ids; --dry previews without writing.
const ONLY_SETS = (process.argv.find((a) => a.startsWith('--sets=')) || '').replace('--sets=', '').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes('--dry');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const numOf = (s) => {
  const m = String(s || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
};
// "Reshiram ex - 174/086" -> "Reshiram ex"; "Ho-Oh - 50/086" -> "Ho-Oh"
const englishName = (n) => String(n || '').replace(/\s*-\s*\d.*$/, '').trim();

async function jtcg(path) {
  await sleep(RATE_MS);
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': API_KEY } });
  if (res.status === 429) { await sleep(5000); return jtcg(path); }
  if (!res.ok) throw new Error(`JustTCG ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing');

  // Our JP cards, indexed per set by numeric card number. Paginate — PostgREST
  // caps a single select at 1000 rows and there are ~5.5k ja cards.
  const byKey = new Map(); // `${set_id}|${num}` -> card id
  const ourSetIds = new Set();
  for (let from = 0; ; from += 1000) {
    const { data: cards, error } = await supabase
      .from('pokemon_cards')
      .select('id, number, set_id')
      .eq('game', 'pokemon')
      .eq('language', 'ja')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!cards.length) break;
    for (const c of cards) {
      ourSetIds.add(c.set_id);
      const n = numOf(c.number);
      if (n != null) byKey.set(`${c.set_id}|${n}`, c.id);
    }
    if (cards.length < 1000) break;
  }

  const jtcgSets = (await jtcg('/sets?game=pokemon-japan')).data || [];

  let totalNames = 0;
  let totalPrices = 0;
  for (const ourSetId of ourSetIds) {
    if (ONLY_SETS.length && !ONLY_SETS.includes(ourSetId)) continue;
    const prefix = ourSetId.toLowerCase() + '-';
    const overrideSlug = JP_SET_SLUG_OVERRIDES[ourSetId];
    const match = (overrideSlug && jtcgSets.find((s) => s.id === overrideSlug)) || jtcgSets.find((s) => s.id.toLowerCase().startsWith(prefix));
    if (!match) continue;

    const nameUpdates = [];
    const priceRows = [];
    let offset = 0;
    for (;;) {
      const page = await jtcg(`/cards?game=pokemon-japan&set=${encodeURIComponent(match.id)}&limit=${PAGE}&offset=${offset}`);
      const list = page.data || [];
      if (!list.length) break;
      for (const card of list) {
        const n = numOf(card.number);
        if (n == null) continue;
        const cardId = byKey.get(`${ourSetId}|${n}`);
        if (!cardId) continue;
        const en = englishName(card.name);
        if (en) nameUpdates.push({ id: cardId, english_name: en });
        // one price row per condition (prefer Normal printing)
        const byCond = new Map();
        for (const v of card.variants || []) {
          if (typeof v.price !== 'number' || v.price <= 0) continue;
          const cond = v.condition || 'Near Mint';
          const prev = byCond.get(cond);
          if (!prev || (v.printing === 'Normal' && prev.printing !== 'Normal')) {
            // market_values.language CHECK allows 'jp' (not 'ja').
            byCond.set(cond, { card_id: cardId, language: 'jp', condition: cond, printing: v.printing || null, market_avg: v.price, currency: 'USD', game: 'pokemon', last_updated: new Date().toISOString() });
          }
        }
        priceRows.push(...byCond.values());
      }
      offset += list.length;
      if (list.length < PAGE) break;
    }

    // english_name: update per row (dedupe by id, last wins)
    const seen = new Set();
    for (const u of nameUpdates) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      if (DRY) continue;
      const { error: e } = await supabase.from('pokemon_cards').update({ english_name: u.english_name }).eq('id', u.id);
      if (e) throw e;
    }
    // Parallels share a card number -> same card_id, so dedupe per
    // (card_id, condition) or the upsert hits the same row twice in one batch.
    const dedup = new Map();
    for (const r of priceRows) {
      const k = `${r.card_id}|${r.condition}`;
      const prev = dedup.get(k);
      if (!prev || (r.printing === 'Normal' && prev.printing !== 'Normal')) dedup.set(k, r);
    }
    const finalRows = [...dedup.values()];
    if (!DRY) {
      for (let i = 0; i < finalRows.length; i += 500) {
        const { error: e } = await supabase.from('market_values').upsert(finalRows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
        if (e) throw e;
      }
    }
    console.log(`[jp]${DRY ? ' DRY' : ''} ${ourSetId} <- ${match.id}: names ${seen.size}, price-rows ${finalRows.length}`);
    totalNames += seen.size;
    totalPrices += finalRows.length;
  }
  console.log(`[jp] done: english names ${totalNames}, price rows ${totalPrices}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[jp] FAILED:', e.message); process.exit(1); });
