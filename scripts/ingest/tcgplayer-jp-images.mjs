// Real Japanese card images for vintage ja rows, via TCGPlayer's CDN.
//
// JustTCG carries no image, but it returns each card's tcgplayerId, and
// TCGPlayer's image CDN serves the actual JAPANESE scan by product id:
//   large: https://tcgplayer-cdn.tcgplayer.com/product/<id>_in_1000x1000.jpg
//   small: https://product-images.tcgplayer.com/fit-in/437x437/<id>.jpg
//
// We match our image-less ja card to its JustTCG card (by collector number for
// the numbered sets, by name-bridge for the pre-e-Card sets that have no upstream
// number), pull tcgplayerId, validate the URL exists, and fill image_small /
// image_large. Only touches rows that are currently image-less.
//
//   node scripts/ingest/tcgplayer-jp-images.mjs --dry [--sets=E1,PCG7]
//   node scripts/ingest/tcgplayer-jp-images.mjs --commit
//
// Idempotent. After committing, run the standard mirror step to self-host into
// the card-images bucket (scripts/ingest/mirror-card-images.mjs) per CLAUDE.md.

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

const DRY = !process.argv.includes('--commit');
const ONLY_SETS = (process.argv.find((a) => a.startsWith('--sets=')) || '').replace('--sets=', '').split(',').map((s) => s.trim()).filter(Boolean);

// Numbered sets (reliable collector-number match).
const NUMBERED_SLUGS = {
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
};
// Pre-e-Card sets (no upstream number -> name-bridge).
const NAMEBRIDGE_SLUGS = {
  neo1: 'gold-silver-to-a-new-world-pokemon-japan',
  neo2: 'crossing-the-ruins-pokemon-japan',
  neo3: 'awakening-legends-pokemon-japan',
  neo4: 'darkness-and-to-light-pokemon-japan',
  PMCG1: 'expansion-pack-pokemon-japan',
  PMCG2: 'pokemon-jungle-pokemon-japan',
  PMCG3: 'mystery-of-the-fossils-pokemon-japan',
  PMCG4: 'rocket-gang-pokemon-japan',
  PMCG5: 'leaders-stadium-pokemon-japan',
  PMCG6: 'challenge-from-the-darkness-pokemon-japan',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const numOf = (s) => { const m = String(s || '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
const norm = (s) => String(s || '').toLowerCase().replace(/[\s　]/g, '').replace(/[^a-z0-9぀-ヿ一-鿿]/g, '');
const enName = (n) => String(n || '').replace(/\s*-\s*\d.*$/, '').trim();
const imgLarge = (id) => `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_1000x1000.jpg`;
const imgSmall = (id) => `https://product-images.tcgplayer.com/fit-in/437x437/${id}.jpg`;

async function jtcg(path) {
  await sleep(RATE_MS);
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': API_KEY } });
  if (res.status === 429) { await sleep(5000); return jtcg(path); }
  if (!res.ok) throw new Error(`JustTCG ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function urlOk(url) {
  try { const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } }); return r.status === 200; }
  catch { return false; }
}

async function fetchJtcgCards(slug) {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await jtcg(`/cards?game=pokemon-japan&set=${encodeURIComponent(slug)}&limit=${PAGE}&offset=${offset}`);
    const list = page.data || [];
    if (!list.length) break;
    out.push(...list);
    offset += list.length;
    if (list.length < PAGE) break;
  }
  return out;
}

async function imagelessCards(setId) {
  const { data, error } = await supabase
    .from('pokemon_cards').select('id, number, name, english_name')
    .eq('game', 'pokemon').eq('language', 'ja').eq('set_id', setId)
    .or('image_small.is.null,image_small.eq.');
  if (error) throw error;
  return data;
}

// returns Map(ourCardId -> tcgplayerId)
function matchNumbered(ours, jt) {
  const jtByNum = new Map();
  for (const c of jt) { const n = numOf(c.number); if (n != null && c.tcgplayerId) jtByNum.set(n, c.tcgplayerId); }
  const out = new Map();
  for (const c of ours) { const n = numOf(c.number); const tid = n != null ? jtByNum.get(n) : null; if (tid) out.set(c.id, tid); }
  return out;
}

// No-number sets: match on the english_name already filled by the name-bridge
// pricing pass (authoritative), 1:1-guarded against JustTCG's English name.
function matchNamebridge(ours, jt) {
  const jtByEn = new Map();
  for (const c of jt) { const k = norm(enName(c.name)); if (!k || !c.tcgplayerId) continue; if (!jtByEn.has(k)) jtByEn.set(k, []); jtByEn.get(k).push(c.tcgplayerId); }
  const ourByEn = new Map();
  for (const c of ours) { if (!c.english_name) continue; const k = norm(c.english_name); if (!ourByEn.has(k)) ourByEn.set(k, []); ourByEn.get(k).push(c.id); }
  const out = new Map();
  for (const [k, ids] of ourByEn) { const tids = jtByEn.get(k); if (!tids) continue; if (ids.length === 1 && tids.length === 1) out.set(ids[0], tids[0]); }
  return out;
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing');
  const allSets = { ...NUMBERED_SLUGS, ...NAMEBRIDGE_SLUGS };
  let gFilled = 0, gNoMatch = 0, gNoImg = 0;
  console.log(`mode: ${DRY ? 'DRY' : 'COMMIT'}\n`);

  for (const setId of Object.keys(allSets)) {
    if (ONLY_SETS.length && !ONLY_SETS.includes(setId)) continue;
    const ours = await imagelessCards(setId);
    if (!ours.length) { console.log(`${setId}: 0 image-less cards (skip)`); continue; }
    const jt = await fetchJtcgCards(allSets[setId]);
    const matches = NAMEBRIDGE_SLUGS[setId] ? matchNamebridge(ours, jt) : matchNumbered(ours, jt);

    let filled = 0, noImg = 0;
    for (const [cardId, tid] of matches) {
      if (!(await urlOk(imgLarge(tid)))) { noImg++; continue; }
      if (!DRY) {
        const { error } = await supabase.from('pokemon_cards').update({ image_small: imgSmall(tid), image_large: imgLarge(tid) }).eq('id', cardId);
        if (error) throw error;
      }
      filled++;
    }
    const noMatch = ours.length - matches.size;
    console.log(`${DRY ? 'DRY ' : ''}${setId.padEnd(6)} <- ${allSets[setId]}: imageless ${String(ours.length).padStart(3)} | matched ${String(matches.size).padStart(3)} | filled ${String(filled).padStart(3)} | noImage ${noImg} | noMatch ${noMatch}`);
    gFilled += filled; gNoMatch += noMatch; gNoImg += noImg;
  }
  console.log(`\n${DRY ? 'DRY ' : ''}TOTAL filled ${gFilled} | noImage ${gNoImg} | noMatch ${gNoMatch}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
