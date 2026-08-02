// Japanese (OCG) Yu-Gi-Oh! catalog ingestion.
//
//   node scripts/ingest/yugioh-jp.mjs                        # dry run, every JP set
//   node scripts/ingest/yugioh-jp.mjs --commit               # write catalog
//   node scripts/ingest/yugioh-jp.mjs --commit CORI BLZD     # only these JP set codes
//   node scripts/ingest/yugioh-jp.mjs --commit --since=2024-01-01
//   node scripts/ingest/yugioh-jp.mjs --commit --prices      # also write ungraded prices
//
// Two upstreams, because neither alone is sufficient:
//
//   * PriceCharting is the CATALOG SPINE. It is the only source we have that
//     enumerates OCG printings at all — 180 sets / ~15.7k printings, each named
//     "<English name> [Variant] <SETCODE-JPnnn>". YGOPRODeck (our English YGO
//     source) has ZERO Japanese data: no JP set codes, no Japanese names, and
//     `cardsets.php` lists exactly one set with "Japan" in its name (a prize-card
//     set). So JP sets cannot be walked from YGOPRODeck the way EN sets are.
//   * YGOPRODeck supplies the ARTWORK + card metadata, bridged by English card
//     name. PriceCharting ships no card images at all, and OCG rows carry no
//     `tcg-id` (1 of 18,088 — TCGplayer does not sell OCG), so the TCGplayer
//     image tier used by pricecharting-images.mjs is a dead end here. Measured
//     match rate: 95.2%, and 100% of matches have art. The ~5% misses are
//     genuinely OCG-exclusive cards that have not been printed in the TCG yet.
//
// NAMES ARE ENGLISH. Neither upstream carries Japanese card names, and Yugipedia
// has no Cargo API to bulk-export them, so `name` holds the English name — which
// is what our English YGO rows already do (they leave `english_name` null). If a
// Japanese-name source is added later, backfill `name` and move English into
// `english_name`, matching the JP Pokemon convention.
//
// IDs mirror the English scheme (`ygo-<setcode>` -> ygo-blzd-en077) so the two
// languages read the same: `ygo-blzd-jp069`, set row `ygo-blzd-jp`. The `-jp`
// set suffix is required — pokemon_sets.id is a single-column PK, so one row per
// id per language (same rule as the Thai `-th` sets in CLAUDE.md).
//
// Rerun is idempotent (upsert on PK). Dry by default.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '..', '.env.local');
// Split on \r?\n and strip surrounding quotes — the project's dotenv convention.
// A quoted token passed through verbatim reaches the upstream as a literal `"..."`.
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k] = v;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PC_TOKEN = process.env.PRICECHARTING_TOKEN;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!PC_TOKEN) {
  console.error('Missing PRICECHARTING_TOKEN in .env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const PRICES = args.includes('--prices');
const SINCE = args.find((a) => a.startsWith('--since='))?.split('=')[1] ?? null;
const ONLY = new Set(args.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase()));

const CACHE_DIR = path.join(__dirname, '..', '.cache');
const PC_CSV = path.join(CACHE_DIR, 'pc-yugioh-cards.csv');
const YGO_JSON = path.join(CACHE_DIR, 'ygoprodeck-all.json');

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PriceCharting quotes any field containing a comma; card names frequently do.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// "$1,234.50" -> 1234.5. The bulk CSV ships dollar strings; the JSON product API
// ships integer cents. Do not reuse centsToUsd here.
const usd = (s) => {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function loadPriceChartingCsv() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(PC_CSV)) {
    const url = `https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(PC_TOKEN)}&category=yugioh-cards`;
    console.log('[ygo-jp] downloading PriceCharting yugioh-cards CSV...');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`PriceCharting ${res.status}`);
    const text = await res.text();
    // An unrecognised `category=` returns HTTP 200 with a valid CSV header and
    // then the entire 122k-row video-game catalog (first console "3DO"). Abort
    // on that signature rather than ingesting garbage.
    if (/^\s*<!DOCTYPE/i.test(text)) throw new Error('PriceCharting returned an HTML challenge page, not CSV — retry later');
    if (text.includes(',3DO,')) throw new Error('PriceCharting returned the all-products fallback — bad category slug');
    fs.writeFileSync(PC_CSV, text);
  }
  return fs.readFileSync(PC_CSV, 'utf8');
}

async function loadYgoprodeck() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(YGO_JSON)) {
    console.log('[ygo-jp] downloading YGOPRODeck card database...');
    const res = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php', {
      headers: { 'User-Agent': 'CardStreetTCG/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`YGOPRODeck ${res.status}`);
    fs.writeFileSync(YGO_JSON, JSON.stringify((await res.json()).data));
    await sleep(200);
  }
  return JSON.parse(fs.readFileSync(YGO_JSON, 'utf8'));
}

// "Apex Polymerization BLZD-JP069"        -> BLZD / 069 / no variant
// "Archfiend Matriarch [Secret Rare] BLZD-JP030" -> BLZD / 030 / Secret Rare
// Trailing code only: a leading match would eat cards whose NAME contains a code.
const CODE_RE = /\s([A-Z0-9]{2,6}-(?:JP|JA)[A-Z0-9]{2,4})$/i;

function parseProduct(product) {
  const m = product.match(CODE_RE);
  if (!m) return null;
  const code = m[1].toUpperCase();
  let name = product.slice(0, m.index).trim();
  const vm = name.match(/\s*\[([^\]]+)\]\s*$/);
  const variant = vm ? vm[1].trim() : null;
  if (vm) name = name.slice(0, vm.index).trim();
  if (!name) return null;
  const [setCode, suffix] = code.split('-');
  // Keep the printed suffix minus its region tag: JP069 -> 069, JPS01 -> S01.
  // The column is TEXT and OCG special numbering (S01, EN-style letters) is real.
  return { setCode, number: suffix.replace(/^(JP|JA)/i, ''), name, variant, code };
}

async function main() {
  const [csv, ygoCards] = await Promise.all([loadPriceChartingCsv(), loadYgoprodeck()]);

  const lines = csv.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((h, i) => [h, i]));

  // Index YGOPRODeck by normalised English name. `treated_as` catches the handful
  // of cards PriceCharting names by their alternate//errata title.
  const byName = new Map();
  for (const c of ygoCards) {
    byName.set(norm(c.name), c);
    const treated = c.misc_info?.[0]?.treated_as;
    if (treated) byName.set(norm(treated), c);
  }

  // Group PriceCharting rows by set code, then by printing.
  const sets = new Map();
  let jpRows = 0;
  let unparsed = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = parseCsvLine(lines[i]);
    const consoleName = r[col['console-name']] || '';
    if (!/^yugioh japanese /i.test(consoleName)) continue;
    if ((r[col['genre']] || '') !== 'YuGiOh Card') continue;
    jpRows++;
    const p = parseProduct((r[col['product-name']] || '').trim());
    if (!p) { unparsed++; continue; }
    if (ONLY.size && !ONLY.has(p.setCode)) continue;

    const release = r[col['release-date']] || null;
    if (SINCE && (!release || release < SINCE)) continue;

    if (!sets.has(p.setCode)) {
      sets.set(p.setCode, {
        setCode: p.setCode,
        // "YuGiOh Japanese Blazing Dominion" -> "Blazing Dominion"
        name: consoleName.replace(/^yugioh japanese\s+/i, '').trim(),
        release,
        printings: new Map(),
      });
    }
    const set = sets.get(p.setCode);
    if (release && (!set.release || release < set.release)) set.release = release;

    // One row per (printed code + rarity treatment), NOT per code. OCG reprints a
    // single code at several rarities (BLZD-JP030 exists as both a base print and
    // a Secret Rare) and PriceCharting lists each as its own product with its own
    // price. Collapsing them onto one row would put the base price on the chase
    // print — the exact failure that mis-priced 472 parallels in the JustTCG feed.
    // The base print keeps the clean id so it stays symmetric with the English
    // scheme; treatments get a slugged suffix.
    const base = `ygo-${p.setCode.toLowerCase()}-jp${p.number.toLowerCase()}`;
    const variantSlug = p.variant ? `-${p.variant.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '';
    const cardId = `${base}${variantSlug}`;
    if (set.printings.has(cardId)) {
      // Same code + same treatment listed twice (PriceCharting carries occasional
      // duplicate products). Keep whichever actually has a price.
      const dup = set.printings.get(cardId);
      if (dup.loose == null) dup.loose = usd(r[col['loose-price']]);
      continue;
    }
    set.printings.set(cardId, {
      cardId,
      baseId: base,
      pcId: r[col['id']],
      name: p.name,
      number: p.number,
      variant: p.variant,
      setCode2: p.code,
      loose: usd(r[col['loose-price']]),
    });
  }

  console.log(`[ygo-jp] PriceCharting JP card rows: ${jpRows} (${unparsed} without a parseable set code)`);
  console.log(`[ygo-jp] sets in scope: ${sets.size}`);

  const setRows = [];
  const cardRows = [];
  const mapRows = [];
  const priceRows = [];
  let imaged = 0;
  let noArt = 0;
  const now = new Date().toISOString();

  for (const set of sets.values()) {
    const setRowId = `ygo-${set.setCode.toLowerCase()}-jp`;
    const printings = [...set.printings.values()];

    // printed_total counts distinct printed codes (what the set says on the box);
    // total counts every row incl. rarity treatments — same split the Thai sets
    // use, where MA3 is printed_total 193 / total 486.
    const distinctCodes = new Set(printings.map((p) => p.baseId)).size;

    // Reuse the English twin's set logo when we already carry that set.
    setRows.push({
      id: setRowId,
      name: set.name,
      series: 'Yu-Gi-Oh!',
      printed_total: distinctCodes,
      total: printings.length,
      release_date: set.release || null,
      symbol_url: `https://images.ygoprodeck.com/images/sets/${set.setCode}.jpg`,
      logo_url: `https://images.ygoprodeck.com/images/sets/${set.setCode}.jpg`,
      language: 'ja',
      game: 'yugioh',
    });

    for (const p of printings) {
      const art = byName.get(norm(p.name));
      const img = art?.card_images?.[0] || {};
      if (img.image_url) imaged++; else noArt++;

      cardRows.push({
        id: p.cardId,
        name: p.name,
        set_id: setRowId,
        number: p.number,
        rarity: p.variant || null,
        image_small: img.image_url_small || '',
        image_large: img.image_url || '',
        language: 'ja',
        game: 'yugioh',
        raw_data: {
          ygo_id: art?.id ?? null,
          set_code: p.setCode2,
          type: art?.type ?? null,
          attribute: art?.attribute ?? null,
          race: art?.race ?? null,
          pricecharting_id: p.pcId,
          // The base print of this code, so a variant row can be traced back to
          // the standard printing without re-deriving the id.
          base_id: p.cardId === p.baseId ? undefined : p.baseId,
          source: 'pricecharting+ygoprodeck',
        },
      });

      mapRows.push({
        card_id: p.cardId,
        pricecharting_id: p.pcId,
        game: 'yugioh',
        console_name: `YuGiOh Japanese ${set.name}`,
        matched_at: now,
      });

      // PriceCharting's `loose-price` is the UNGRADED market price. It is the only
      // raw price source available for OCG — JustTCG has no Japanese Yu-Gi-Oh game
      // (its catalog has `pokemon-japan` but no `yugioh-japan`), so the nightly
      // batch-price-games job can never cover these rows.
      if (PRICES && p.loose != null) {
        priceRows.push({
          card_id: p.cardId,
          language: 'jp',
          condition: 'Raw_NM',
          market_avg: p.loose,
          currency: 'USD',
          game: 'yugioh',
          source_prices: { market_price: p.loose, source: 'pricecharting_loose' },
          last_updated: now,
          last_priced_at: now,
        });
      }
    }
  }

  const withRarity = cardRows.filter((c) => c.rarity).length;
  console.log(`[ygo-jp] sets=${setRows.length} cards=${cardRows.length} imaged=${imaged} (${(imaged / cardRows.length * 100).toFixed(1)}%) noArt=${noArt}`);
  console.log(`[ygo-jp] rarity known: ${withRarity} (${(withRarity / cardRows.length * 100).toFixed(1)}%) — base prints carry none, PriceCharting only labels the treatment`);
  if (PRICES) console.log(`[ygo-jp] ungraded price rows: ${priceRows.length}`);

  if (!COMMIT) {
    console.log('\n[ygo-jp] DRY RUN — nothing written. Re-run with --commit.');
    console.log('sample sets:');
    for (const s of setRows.slice(0, 5)) console.log('  ', JSON.stringify({ id: s.id, name: s.name, total: s.total, release: s.release_date }));
    console.log('sample cards:');
    for (const c of cardRows.slice(0, 5)) console.log('  ', JSON.stringify({ id: c.id, name: c.name, set: c.set_id, num: c.number, rarity: c.rarity, img: !!c.image_large }));
    return;
  }

  const chunk = async (table, rows, onConflict) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict });
      if (error) throw new Error(`${table}: ${error.message}`);
      process.stdout.write(`\r  ${table}: ${Math.min(i + 500, rows.length)}/${rows.length}`);
    }
    process.stdout.write('\n');
  };

  // Sets before cards — a card row with no set row renders unlabelled.
  await chunk('pokemon_sets', setRows, 'id');
  await chunk('pokemon_cards', cardRows, 'id');
  await chunk('pricecharting_map', mapRows, 'card_id,pricecharting_id');
  if (priceRows.length) await chunk('market_values', priceRows, 'card_id,language,condition');

  console.log('\n[ygo-jp] done.');
  console.log('Next: node scripts/ingest/mirror-card-images.mjs --game=yugioh --language=ja');
}

main().catch((e) => { console.error('[ygo-jp]', e.message); process.exit(1); });
