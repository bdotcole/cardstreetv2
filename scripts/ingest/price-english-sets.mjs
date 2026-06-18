// Immediate English-set price backfill — local twin of the batch-price-english
// Edge Function (supabase/functions/batch-price-english).
//
// The daily cron prices English sets registered in marketplace_configs, but it
// runs once a night and is rate-budgeted. This runs the identical matching and
// variant-scoring logic on demand so a freshly-registered set (e.g. the promo
// sets) gets prices now instead of waiting for the cron.
//
//   node scripts/ingest/price-english-sets.mjs                 # every active set in marketplace_configs
//   node scripts/ingest/price-english-sets.mjs --set=svp,xyp   # only these set_ids
//
// Writes market_values rows: language 'en', condition 'Raw_NM', currency 'USD'
// (cardMapper converts to THB). Idempotent upsert on (card_id,language,condition).

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
const DELAY_MS = 1300; // safe under the 50 req/min floor; Professional allows more
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function jtcg(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': API_KEY } });
  if (r.status === 429) { await sleep(5000); return jtcg(path); }
  if (!r.ok) throw new Error(`JustTCG ${r.status}: ${await r.text()}`);
  return r.json();
}

// Faithful copy of the Edge Function's variant scorer: prefer variants with
// real market adoption (avgPrice > 0), then NM condition, then holo printings,
// and break ties between zero-sale listings by lowest price to dodge troll outliers.
function pickPrice(jCard) {
  const variants = (jCard.variants ?? []).filter((v) => v.language === 'English' || !v.language);
  const sorted = variants.sort((a, b) => {
    let sa = 0, sb = 0;
    if (a.avgPrice > 0) sa += 1000;
    if (b.avgPrice > 0) sb += 1000;
    if (a.condition === 'Near Mint' || a.condition === 'NM') sa += 500;
    else if (a.condition === 'Lightly Played' || a.condition === 'LP') sa += 200;
    if (b.condition === 'Near Mint' || b.condition === 'NM') sb += 500;
    else if (b.condition === 'Lightly Played' || b.condition === 'LP') sb += 200;
    if (a.printing === 'Holofoil') sa += 100; else if (a.printing === 'Reverse Holofoil') sa += 50;
    if (b.printing === 'Holofoil') sb += 100; else if (b.printing === 'Reverse Holofoil') sb += 50;
    if (sa === sb && a.avgPrice === 0 && b.avgPrice === 0) return (a.price || 99999) - (b.price || 99999);
    return sb - sa;
  });
  const best = sorted[0] ?? (jCard.variants ?? [])[0];
  return { price: best?.avgPrice || best?.price || 0, best };
}

async function priceSet(setId, slug) {
  // pull every JustTCG card for the set (sealed products lead and have number N/A)
  let all = [], offset = 0;
  for (;;) {
    const resp = await jtcg(`/cards?game=pokemon&set=${encodeURIComponent(slug)}&conditions=NM&include_price_history=false&limit=100&offset=${offset}`);
    const page = resp.data ?? [];
    all = all.concat(page);
    if (!resp.meta?.hasMore || page.length < 100) break;
    offset += 100;
    await sleep(DELAY_MS);
  }
  const jcards = all.filter((c) => c.number && c.number !== 'N/A');

  const { data: dbCards } = await supabase
    .from('pokemon_cards')
    .select('id, name, number')
    .eq('set_id', setId)
    .eq('language', 'en');
  const byNumber = new Map((dbCards ?? []).map((c) => [String(c.number), c]));
  const byName = new Map((dbCards ?? []).map((c) => [norm(c.name), c]));

  const rows = [];
  for (const j of jcards) {
    const raw = (j.number ?? '').toString();
    const stripped = raw.includes('/') ? raw.split('/')[0] : raw;
    const noZeros = stripped.replace(/^0+/, '');
    const dbCard = byNumber.get(stripped) ?? byNumber.get(noZeros) ?? byName.get(norm(j.name ?? ''));
    if (!dbCard) continue;
    const { price, best } = pickPrice(j);
    if (price <= 0) continue;
    rows.push({
      card_id: dbCard.id,
      language: 'en',
      condition: 'Raw_NM',
      market_avg: price,
      source_links: [`https://justtcg.com/card/${j.id}`],
      source_prices: { market_price: price, low_price: best?.minPrice30d ?? 0, high_price: best?.maxPrice30d ?? 0, source: 'justtcg' },
      currency: 'USD',
      last_updated: new Date().toISOString(),
      last_priced_at: new Date().toISOString(),
    });
  }

  // dedupe to one row per card (number+name can both resolve onto the same card)
  const deduped = Array.from(new Map(rows.map((r) => [r.card_id, r])).values());
  for (let i = 0; i < deduped.length; i += 500) {
    const { error } = await supabase
      .from('market_values')
      .upsert(deduped.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
    if (error) throw error;
  }
  return { ourCards: dbCards?.length ?? 0, jtcgSingles: jcards.length, priced: deduped.length };
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing from .env.local');
  const setFilter = process.argv.find((a) => a.startsWith('--set='))?.split('=')[1];

  let q = supabase.from('marketplace_configs').select('set_id, justtcg_slug, active').eq('active', true);
  if (setFilter) q = q.in('set_id', setFilter.split(',').map((s) => s.trim()));
  const { data: configs, error } = await q;
  if (error) throw error;
  if (!configs?.length) { console.log('No matching marketplace_configs rows.'); return; }

  let totalPriced = 0;
  for (const cfg of configs.sort((a, b) => a.set_id.localeCompare(b.set_id))) {
    try {
      const { ourCards, jtcgSingles, priced } = await priceSet(cfg.set_id, cfg.justtcg_slug);
      console.log(`${cfg.set_id} <- ${cfg.justtcg_slug}: ${priced}/${ourCards} priced (jtcg singles ${jtcgSingles})`);
      totalPriced += priced;
    } catch (e) {
      console.error(`${cfg.set_id} FAILED: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`\nDone: upserted ${totalPriced} price rows.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
