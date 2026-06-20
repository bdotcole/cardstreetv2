// JustTCG pricing + english_name for the pre-e-Card JP sets (neo1-4, PMCG1-6)
// that JustTCG stores WITHOUT collector numbers (number: "N/A"), so the
// number-based match in justtcg-pokemon-jp.mjs can't reach them.
//
// Bridge: our vintage rows carry (corrupted) Japanese names; we translate each
// to English via a jpName->english dictionary built from every OTHER ja row that
// already has an english_name, then match to the JustTCG card by English name
// WITHIN the set. To stay safe (the Thai-promo lesson: same name -> wrong
// chase price), we only write a card when the English name resolves 1:1 on BOTH
// sides (exactly one of our cards and exactly one JustTCG card). Everything
// ambiguous or untranslatable is left untouched.
//
//   node scripts/ingest/justtcg-pokemon-jp-namebridge.mjs --dry
//   node scripts/ingest/justtcg-pokemon-jp-namebridge.mjs --commit [--sets=neo1,PMCG2]
//
// Writes english_name (the proper English, from JustTCG) + market_values
// (USD, language='jp') for matched cards. Idempotent.

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

// Pre-e-Card JP sets -> JustTCG slug (these have no collector numbers upstream).
const SLUGS = {
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
// Normalize for matching: lowercase, drop whitespace + punctuation, keep
// latin + kana/kanji so a Japanese key and an English key each collapse cleanly.
const norm = (s) => String(s || '').toLowerCase().replace(/[\s　]/g, '').replace(/[^a-z0-9぀-ヿ一-鿿]/g, '');
const enName = (n) => String(n || '').replace(/\s*-\s*\d.*$/, '').trim();

// The pre-e-Card Gym/Rocket (PMCG5/6) and Neo Destiny (neo4) sets name cards as
// "<owner>の<Pokemon>" or "<modifier><Pokemon>". The owner/modifier never carries
// an english_name on its own, so a whole-name dict lookup misses them. Translate
// the parts: strip the owner/modifier, translate the Pokemon via the dict, and
// recompose the English form JustTCG uses ("Koga's Weedle", "Dark Crobat").
const MODIFIERS = [['輝く', 'Shining'], ['ダーク', 'Dark'], ['暗い', 'Dark'], ['軽い', 'Light'], ['ライト', 'Light'], ['軽', 'Light']];
const TRAINERS = [
  ['ブロック', 'Brock'], ['カスミ', 'Misty'], ['マチス', 'Lt. Surge'], ['エリカ', 'Erika'], ['キョウ', 'Koga'], ['コガ', 'Koga'],
  ['サブリナ', 'Sabrina'], ['ナツメ', 'Sabrina'], ['サカキ', 'Giovanni'], ['ジョバンニ', 'Giovanni'], ['ロケット団', 'Rocket'], ['ロケット', 'Rocket'],
  ['ハヤト', 'Falkner'], ['ツクシ', 'Bugsy'], ['アカネ', 'Whitney'], ['マツバ', 'Morty'], ['シジマ', 'Chuck'], ['ミカン', 'Jasmine'],
  ['ヤナギ', 'Pryce'], ['イブキ', 'Clair'], ['カリン', 'Karen'], ['ワタル', 'Lance'],
];

// Japanese name (possibly corrupted/compound) -> English, via the dict plus
// owner/modifier decomposition. Returns null when no path resolves.
function translate(name, dict) {
  const base = String(name || '').replace(/[（(][^）)]*[)）]/g, '').trim(); // strip "(lv.15)" etc.
  const direct = dict.get(norm(base));
  if (direct) return direct;
  const ownerIx = base.indexOf('の');
  if (ownerIx > 0) {
    const owner = base.slice(0, ownerIx);
    const rest = base.slice(ownerIx + 1);
    const tr = TRAINERS.find(([jp]) => owner === jp || owner.startsWith(jp));
    const poke = dict.get(norm(rest));
    if (tr && poke) return `${tr[1]}'s ${poke}`;
  }
  for (const [jp, en] of MODIFIERS) {
    if (base.startsWith(jp)) {
      const poke = dict.get(norm(base.slice(jp.length)));
      if (poke) return `${en} ${poke}`;
    }
  }
  return null;
}

async function jtcg(path) {
  await sleep(RATE_MS);
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': API_KEY } });
  if (res.status === 429) { await sleep(5000); return jtcg(path); }
  if (!res.ok) throw new Error(`JustTCG ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

async function buildDict() {
  const dict = new Map(); // norm(jpName) -> english
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('pokemon_cards')
      .select('name, english_name')
      .eq('game', 'pokemon').eq('language', 'ja')
      .not('english_name', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const r of data) {
      if (!r.name || !r.english_name) continue;
      const k = norm(r.name);
      if (k && !dict.has(k)) dict.set(k, r.english_name);
    }
    if (data.length < 1000) break;
  }
  return dict;
}

async function fetchOurCards(setId) {
  const { data, error } = await supabase
    .from('pokemon_cards')
    .select('id, number, name')
    .eq('game', 'pokemon').eq('language', 'ja').eq('set_id', setId);
  if (error) throw error;
  return data;
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

function priceRowsFor(cardId, jtCard) {
  const byCond = new Map();
  for (const v of jtCard.variants || []) {
    if (typeof v.price !== 'number' || v.price <= 0) continue;
    const cond = v.condition || 'Near Mint';
    const prev = byCond.get(cond);
    if (!prev || (v.printing === 'Normal' && prev.printing !== 'Normal')) {
      byCond.set(cond, { card_id: cardId, language: 'jp', condition: cond, printing: v.printing || null, market_avg: v.price, currency: 'USD', game: 'pokemon', last_updated: new Date().toISOString() });
    }
  }
  return [...byCond.values()];
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing');
  const dict = await buildDict();
  console.log(`dict: ${dict.size} jp->en entries | mode: ${DRY ? 'DRY' : 'COMMIT'}\n`);

  let gNames = 0, gPriceRows = 0, gAmbig = 0, gNoTrans = 0, gNoJt = 0;
  for (const setId of Object.keys(SLUGS)) {
    if (ONLY_SETS.length && !ONLY_SETS.includes(setId)) continue;
    const slug = SLUGS[setId];
    const ours = await fetchOurCards(setId);
    const jt = await fetchJtcgCards(slug);

    // JustTCG side: englishNorm -> [card]
    const jtByEn = new Map();
    for (const c of jt) {
      const k = norm(enName(c.name));
      if (!k) continue;
      if (!jtByEn.has(k)) jtByEn.set(k, []);
      jtByEn.get(k).push(c);
    }
    // Our side: englishNorm(via dict) -> [ourCard]
    const ourByEn = new Map();
    let noTrans = 0;
    for (const c of ours) {
      const en = translate(c.name, dict);
      if (!en) { noTrans++; continue; }
      const k = norm(en);
      if (!ourByEn.has(k)) ourByEn.set(k, []);
      ourByEn.get(k).push({ ...c, en });
    }

    let names = 0, ambig = 0, noJt = 0;
    const priceRows = [];
    const nameUpdates = [];
    for (const [k, ourList] of ourByEn) {
      const jtList = jtByEn.get(k);
      if (!jtList) { noJt++; continue; }
      if (ourList.length !== 1 || jtList.length !== 1) { ambig += ourList.length; continue; }
      const our = ourList[0];
      const jtCard = jtList[0];
      nameUpdates.push({ id: our.id, english_name: enName(jtCard.name) });
      priceRows.push(...priceRowsFor(our.id, jtCard));
      names++;
    }

    if (!DRY) {
      for (const u of nameUpdates) {
        const { error } = await supabase.from('pokemon_cards').update({ english_name: u.english_name }).eq('id', u.id);
        if (error) throw error;
      }
      for (let i = 0; i < priceRows.length; i += 500) {
        const { error } = await supabase.from('market_values').upsert(priceRows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
        if (error) throw error;
      }
    }
    console.log(`${DRY ? 'DRY ' : ''}${setId.padEnd(6)} <- ${slug}: our ${String(ours.length).padStart(3)} | jt ${String(jt.length).padStart(3)} | MATCHED ${String(names).padStart(3)} | price-rows ${String(priceRows.length).padStart(4)} | skipped: noTranslate ${noTrans}, ambiguous ${ambig}, noJtName ${noJt}`);
    gNames += names; gPriceRows += priceRows.length; gAmbig += ambig; gNoTrans += noTrans; gNoJt += noJt;
  }
  console.log(`\n${DRY ? 'DRY ' : ''}TOTAL matched ${gNames} cards, ${gPriceRows} price rows | skipped: noTranslate ${gNoTrans}, ambiguous ${gAmbig}, noJtName ${gNoJt}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
