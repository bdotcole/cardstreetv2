// Backfill sealed_products.image_url with sealed-product photos.
//
// PriceCharting carries no image in its CSV or JSON product API, but:
//   Tier 1: the bulk CSV carries a `tcg-id` (TCGplayer product id) and TCGplayer hosts
//     product photos at a derivable, already-whitelisted CDN URL (next.config:
//     product-images.tcgplayer.com). One CSV download per game maps
//     pricecharting_id -> tcg-id -> image URL.
//   Tier 2: scrape the PriceCharting product page, which references the cover at
//     storage.googleapis.com/images.pricecharting.com/<hash>/1600.jpg. Concurrent.
//     Genuinely image-less vintage rows stay null (UI shows a placeholder).
//
// EVERY CANDIDATE IS HEAD-CHECKED, AND A LIVE EXISTING IMAGE ALWAYS WINS. Until
// 2026-08-11 tier 1 was applied unconditionally whenever the CSV had a tcg-id, without
// looking at what the row already held. TCGplayer has since retired most of the product
// ids this table was built from — 24 of 40 sampled tcgplayer URLs 404 — so that
// precedence actively DOWNGRADED rows that already carried a working PriceCharting
// cover. Measured on the full table that run wanted 3,811 writes against ~1,400 genuine
// blanks: ~2,400 of them were rewrites of already-imaged rows. With the checks below the
// same table needs 1,016 writes (995 blanks filled, 21 dead URLs healed, 2,977 live
// images left untouched), and of those only 6 come from tier 1 vs 1,010 from tier 2 —
// tcgplayer is effectively a dead source now, so it is tried first only because it is
// free (no scrape) when it does resolve.
//
//   node scripts/ingest/pricecharting-images.mjs                  # DRY: coverage report
//   node scripts/ingest/pricecharting-images.mjs --commit         # write image_url
//   node scripts/ingest/pricecharting-images.mjs --commit --game=pokemon
//   node scripts/ingest/pricecharting-images.mjs --commit --no-scrape   # tier 1 only (fast)
//
// Idempotent; re-runnable.

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

// game -> PriceCharting price-guide category (keep in sync with lib/pricecharting.ts).
const PC_CATEGORY = {
  pokemon: 'pokemon-cards',
  mtg: 'magic-cards',
  yugioh: 'yugioh-cards',
  onepiece: 'one-piece-cards',
  lorcana: 'lorcana-cards',
};

// TCGplayer product image (fit-in keeps the origin payload small; next/image resizes).
const tcgImageUrl = (tcgId) => `https://product-images.tcgplayer.com/fit-in/437x437/${tcgId}.jpg`;
// PriceCharting cover via Google Cloud Storage (1600 = full; 240 also valid, 400 is not).
const pcImageUrl = (hash) => `https://storage.googleapis.com/images.pricecharting.com/${hash}/1600.jpg`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// pricecharting id -> tcg-id, for one category.
async function loadTcgIdMap(category) {
  const url = `${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=${encodeURIComponent(category)}`;
  let res;
  for (let attempt = 1; attempt <= 5; attempt++) {
    res = await fetch(url);
    if (res.status !== 429) break;
    await sleep(8000);
  }
  if (!res.ok) throw new Error(`CSV download ${res.status} for category "${category}"`);
  const rows = parseCsv(await res.text());
  const header = rows[0].map((h) => h.trim());
  if (rows[1] && rows[1][1] === '3DO') throw new Error(`category "${category}" returned all-products fallback — wrong slug`);
  const idIdx = header.indexOf('id');
  const tcgIdx = header.indexOf('tcg-id');
  if (idIdx < 0 || tcgIdx < 0) throw new Error(`CSV for "${category}" missing id/tcg-id columns`);
  const map = new Map();
  for (const r of rows.slice(1)) {
    const id = r[idIdx]?.trim();
    const tcg = r[tcgIdx]?.trim();
    if (id && tcg) map.set(id, tcg);
  }
  return map;
}

// Tier 2: scrape the PriceCharting product page for its cover-image hash.
// Hashes are base36 alphanumeric on card pages ("qxbh4umdzamyxelr") and hex on
// (most) sealed pages — match both; a hex-only regex silently misses the former.
async function scrapePcImage(pcId) {
  try {
    const res = await fetch(`${BASE}/offers?product=${encodeURIComponent(pcId)}`);
    if (!res.ok) return null;
    const html = await res.text();
    const m = /images\.pricecharting\.com\/([a-z0-9]{12,})\//i.exec(html);
    return m ? pcImageUrl(m[1]) : null;
  } catch { return null; }
}

// Does this URL still serve? Both candidate hosts fail by returning 404/500 rather than
// by erroring, so a HEAD is the only way to tell a good image from a dead one. Treated as
// dead on any transport failure or timeout — writing a URL we could not confirm is the
// exact mistake this guard exists to prevent.
async function imageResolves(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12_000) });
    return res.ok;
  } catch { return false; }
}

// Bounded-concurrency map.
async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

async function loadSealed(gameFilter) {
  const rows = [];
  let from = 0;
  for (;;) {
    // Thai rows are excluded: their pricecharting_id points at the JP TWIN's box,
    // so tier 1 would overwrite their mirrored Thai packaging shots with JP photos.
    // Thai images are owned by thai-sealed-images.mjs.
    let q = supabase.from('sealed_products').select('id, game, pricecharting_id, image_url').neq('language', 'th');
    if (gameFilter) q = q.eq('game', gameFilter);
    const { data, error } = await q.order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function main() {
  if (!TOKEN) throw new Error('PRICECHARTING_TOKEN missing from .env.local');
  const commit = process.argv.includes('--commit');
  const noScrape = process.argv.includes('--no-scrape');
  const gameFilter = process.argv.find((a) => a.startsWith('--game='))?.split('=')[1] || null;

  const sealed = await loadSealed(gameFilter);
  const byGame = new Map();
  for (const r of sealed) {
    if (!byGame.has(r.game)) byGame.set(r.game, []);
    byGame.get(r.game).push(r);
  }
  console.log(`[pc:img] ${sealed.length} sealed rows across: ${[...byGame.keys()].join(', ')}${commit ? '' : '  [DRY]'}${noScrape ? '  [tier1 only]' : ''}`);

  const updates = [];
  let keptTotal = 0, tcgTotal = 0, scrapeTotal = 0, healedTotal = 0, blankTotal = 0;
  for (const [game, rows] of byGame) {
    const category = PC_CATEGORY[game];
    if (!category) { console.log(`[pc:img] ${game}: no PriceCharting category — skip`); continue; }
    const tcgMap = await loadTcgIdMap(category);

    // Pass 1: a row whose current image still resolves is finished — no candidate may
    // replace it. This is what keeps a retired tcgplayer id from clobbering a good cover,
    // and it also makes re-runs cheap, since most rows exit here.
    const stillGood = await pool(rows, 12, (r) => imageResolves(r.image_url));
    const needsImage = rows.filter((_, i) => !stillGood[i]);
    keptTotal += rows.length - needsImage.length;

    // Pass 2: only for blank or broken rows. Tier 1 first because it costs no scrape,
    // but it has to resolve to be used; otherwise fall through to the tier-2 cover.
    const resolved = await pool(needsImage, 8, async (r) => {
      const t = r.pricecharting_id ? tcgMap.get(String(r.pricecharting_id)) : null;
      if (t) {
        const url = tcgImageUrl(t);
        if (await imageResolves(url)) return { url, tier: 1 };
      }
      if (noScrape) return null;
      const scraped = await scrapePcImage(r.pricecharting_id);
      if (scraped && (await imageResolves(scraped))) return { url: scraped, tier: 2 };
      return null;
    });

    let tcg = 0, scraped = 0, healed = 0, blank = 0;
    needsImage.forEach((r, i) => {
      const got = resolved[i];
      if (!got) { blank++; return; }
      if (got.tier === 1) tcg++; else scraped++;
      if (r.image_url) healed++;
      if (r.image_url !== got.url) updates.push({ id: r.id, image_url: got.url });
    });
    tcgTotal += tcg; scrapeTotal += scraped; healedTotal += healed; blankTotal += blank;
    console.log(`[pc:img] ${game.padEnd(9)} rows=${rows.length}  alreadyLive=${rows.length - needsImage.length}  tcgplayer=${tcg}  pricecharting=${scraped}  healed=${healed}  no-image=${blank}`);
  }

  console.log(`[pc:img] TOTAL live=${keptTotal + tcgTotal + scrapeTotal}/${sealed.length} (untouched=${keptTotal} + tcgplayer=${tcgTotal} + pricecharting=${scrapeTotal}; ${healedTotal} of those replaced a dead URL)  no-image=${blankTotal}  to-write=${updates.length}`);
  if (!commit) { console.log('[pc:img] DRY — nothing written. Re-run with --commit.'); return; }

  // Per-row UPDATE (not upsert): every row already exists, and a partial-column
  // upsert would null the NOT-NULL game/name columns via its INSERT path.
  let written = 0;
  await pool(updates, 12, async (u) => {
    const { error } = await supabase.from('sealed_products').update({ image_url: u.image_url }).eq('id', u.id);
    if (error) throw error;
    if (++written % 500 === 0) console.log(`[pc:img] wrote ${written}/${updates.length}`);
  });
  console.log(`[pc:img] DONE — updated image_url on ${updates.length} sealed_products`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[pc:img] FAILED:', e.message); process.exit(1); });
