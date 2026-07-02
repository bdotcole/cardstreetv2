// Images for Thai sealed products (sealed_products language='th').
//
// Thai boxes/packs share their box design with the JP twin (same set, Thai wordmark),
// and estimate rows already store the JP BOX product id (pricecharting_id) + the JP
// console name (console_name). Sources, in order:
//   1. JP twin product photo — the console's Booster Box (for box rows) or Booster
//      Pack (for pack rows, box as fallback): TCGplayer photo via the CSV tcg-id,
//      else the PriceCharting page cover (storage.googleapis.com — both hosts already
//      whitelisted in next.config).
//   2. Thai set logo (pokemon_sets.logo_url, our own Supabase storage) — the fallback
//      for SRP-only rows (no JP twin) and any JP product without a photo.
//
//   node scripts/ingest/thai-sealed-images.mjs           # DRY: source report
//   node scripts/ingest/thai-sealed-images.mjs --commit  # write image_url
//
// Idempotent; per-row UPDATE (partial-column upsert would null NOT-NULL columns).

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
const TOKEN = env.PRICECHARTING_TOKEN;
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = 'https://www.pricecharting.com';

const tcgImageUrl = (tcgId) => `https://product-images.tcgplayer.com/fit-in/437x437/${tcgId}.jpg`;
const pcImageUrl = (hash) => `https://storage.googleapis.com/images.pricecharting.com/${hash}/1600.jpg`;

function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// console-name -> { box: {id, tcgId}, pack: {id, tcgId} } for JP consoles.
async function loadJpProducts() {
  const res = await fetch(`${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=pokemon-cards`);
  if (!res.ok) throw new Error(`CSV download ${res.status}`);
  const rows = parseCsv(await res.text());
  const header = rows[0].map((h) => h.trim());
  const products = rows.slice(1).filter((r) => r.length >= header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  if (products[0]?.['console-name'] === '3DO') throw new Error('all-products fallback — wrong slug');

  const byConsole = new Map();
  for (const p of products) {
    const consoleName = p['console-name'] || '';
    if (!/^pokemon japanese/i.test(consoleName)) continue;
    const name = (p['product-name'] || '').trim();
    const slot = /^booster box\b/i.test(name) ? 'box' : /^booster pack\b/i.test(name) ? 'pack' : null;
    if (!slot) continue;
    const entry = byConsole.get(consoleName) || {};
    // Prefer the base print (no [..] qualifier) for the representative photo.
    const isBase = !/[\[(]/.test(name);
    if (!entry[slot] || (isBase && !entry[slot].isBase)) {
      entry[slot] = { id: String(p.id), tcgId: (p['tcg-id'] || '').trim() || null, isBase };
    }
    byConsole.set(consoleName, entry);
  }
  return byConsole;
}

async function scrapePcImage(pcId) {
  try {
    const res = await fetch(`${BASE}/offers?product=${encodeURIComponent(pcId)}`);
    if (!res.ok) return null;
    const html = await res.text();
    const m = /images\.pricecharting\.com\/([a-f0-9]{16,})\//i.exec(html);
    return m ? pcImageUrl(m[1]) : null;
  } catch { return null; }
}

async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

async function main() {
  if (!TOKEN) throw new Error('PRICECHARTING_TOKEN missing from .env.local');
  const commit = process.argv.includes('--commit');

  const [{ data: sealed, error: e1 }, { data: sets, error: e2 }, jpProducts] = await Promise.all([
    supabase.from('sealed_products').select('id, set_id, product_type, pricecharting_id, console_name, image_url').eq('language', 'th').order('id'),
    supabase.from('pokemon_sets').select('id, logo_url').eq('game', 'pokemon').eq('language', 'th'),
    loadJpProducts(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const logoBySet = new Map((sets || []).map((s) => [s.id, s.logo_url]));

  // Resolve each row's image source. Scrapes are collected and run concurrently after.
  const plan = []; // { row, url } or { row, scrapeId } pending
  let viaTcg = 0, needScrape = [];
  for (const r of sealed || []) {
    const jp = r.console_name && jpProducts.get(r.console_name);
    const product = jp ? (r.product_type === 'booster_pack' ? (jp.pack || jp.box) : (jp.box || jp.pack)) : null;
    if (product?.tcgId) { viaTcg++; plan.push({ row: r, url: tcgImageUrl(product.tcgId) }); }
    else if (product) needScrape.push({ row: r, pcId: product.id });
    else plan.push({ row: r, url: logoBySet.get(r.set_id) || null });
  }
  const scraped = await pool(needScrape, 8, (t) => scrapePcImage(t.pcId));
  let viaScrape = 0;
  needScrape.forEach((t, i) => {
    if (scraped[i]) { viaScrape++; plan.push({ row: t.row, url: scraped[i] }); }
    else plan.push({ row: t.row, url: logoBySet.get(t.row.set_id) || null }); // logo fallback
  });

  const withImg = plan.filter((p) => p.url);
  const viaLogo = withImg.length - viaTcg - viaScrape;
  const none = plan.length - withImg.length;
  console.log(`[thai-img] rows=${plan.length}  tcgplayer=${viaTcg}  pricecharting=${viaScrape}  set-logo=${viaLogo}  no-image=${none}${commit ? '' : '  [DRY]'}`);
  for (const p of plan.slice(0, 8)) console.log(`   ${p.row.id.padEnd(16)} -> ${p.url ? new URL(p.url).host : 'NONE'}`);

  if (!commit) { console.log('[thai-img] DRY — nothing written. Re-run with --commit.'); return; }

  let written = 0;
  await pool(withImg.filter((p) => p.row.image_url !== p.url), 12, async (p) => {
    const { error } = await supabase.from('sealed_products').update({ image_url: p.url }).eq('id', p.row.id);
    if (error) throw error;
    written++;
  });
  console.log(`[thai-img] DONE — updated image_url on ${written} Thai sealed rows`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[thai-img] FAILED:', e.message); process.exit(1); });
