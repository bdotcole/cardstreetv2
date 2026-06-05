// Rebuild the Japanese Pokemon SET catalog from the cards we actually have.
//
// pokemon_cards has ja cards for ~54 sets but pokemon_sets only had rows for 31,
// so modern SV1-SV8 / S9 / S12 / neo sets were hidden. This recreates a set row
// for every ja set that has cards, with:
//   - English name  (JustTCG pokemon-japan, e.g. "SV3: Ruler..." -> "Ruler...")
//   - release_date  (TCGdex)
//   - logo          (Bulbapedia real expansion logo "File:<CODE> Logo JP.png")
// Falls back gracefully when a source lacks an entry.
//
//   node scripts/ingest/jp-sets-backfill.mjs

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
const UA = { 'User-Agent': 'Mozilla/5.0 (CardStreetTCG dev)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(u) {
  try { const r = await fetch(u, { headers: UA }); return r.ok ? await r.json() : null; } catch { return null; }
}

async function bulbaLogo(code) {
  const u = 'https://archives.bulbagarden.net/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=' +
    encodeURIComponent(code + ' logo') + '&gsrlimit=10&prop=imageinfo&iiprop=url';
  const j = await getJson(u);
  const pages = Object.values((j && j.query && j.query.pages) || {});
  const re = new RegExp('\\b' + code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  const cand = pages
    .map((p) => ({ t: p.title, u: p.imageinfo && p.imageinfo[0] && p.imageinfo[0].url }))
    .filter((x) => x.u && re.test(x.t) && /logo/i.test(x.t));
  cand.sort((a, b) => (/jp/i.test(b.t) ? 1 : 0) - (/jp/i.test(a.t) ? 1 : 0));
  return cand[0] ? cand[0].u : null;
}

async function main() {
  // distinct ja set ids + counts
  const counts = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('pokemon_cards')
      .select('set_id')
      .eq('game', 'pokemon').eq('language', 'ja')
      .order('id').range(from, from + 999);
    if (error) throw error;
    if (!data.length) break;
    for (const c of data) counts.set(c.set_id, (counts.get(c.set_id) || 0) + 1);
    if (data.length < 1000) break;
  }

  // JustTCG pokemon-japan set names (for English names) — one call
  const jtRes = await fetch('https://api.justtcg.com/v1/sets?game=pokemon-japan', { headers: { 'x-api-key': env.JUSTTCG_API_KEY } });
  const jtcgSets = jtRes.ok ? ((await jtRes.json()).data || []) : [];

  let created = 0, logos = 0;
  for (const [setId, total] of counts) {
    const prefix = setId.toLowerCase() + '-';
    const jt = (jtcgSets || []).find((s) => s.id.toLowerCase().startsWith(prefix));
    const englishName = jt ? jt.name.replace(/^[^:]*:\s*/, '').trim() : null; // "SV3: Ruler..." -> "Ruler..."

    const tj = await getJson(`https://api.tcgdex.net/v2/ja/sets/${setId}`);
    const releaseDate = tj && tj.releaseDate ? tj.releaseDate : null;
    const jaName = tj && tj.name ? tj.name : null;

    const logo = await bulbaLogo(setId);
    if (logo) logos++;

    const { error } = await supabase.from('pokemon_sets').upsert({
      id: setId,
      name: englishName || jaName || setId,
      series: 'Pokémon (JP)',
      printed_total: total,
      total,
      release_date: releaseDate,
      logo_url: logo || null,
      symbol_url: logo || null,
      language: 'ja',
      game: 'pokemon',
    }, { onConflict: 'id' });
    if (error) throw error;
    created++;
    console.log(`${setId.padEnd(7)} name="${(englishName || jaName || setId).slice(0, 30)}" date=${releaseDate || '-'} logo=${logo ? 'Y' : '-'}`);
    await sleep(60);
  }
  console.log(`[jp-sets] upserted ${created} sets, ${logos} with Bulbapedia logos`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[jp-sets] FAILED:', e.message); process.exit(1); });
