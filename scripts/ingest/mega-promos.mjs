/**
 * Ingest the missing English Mega Evolution promo cards (set `mep`).
 *
 *   node scripts/ingest/mega-promos.mjs           # dry run (default)
 *   node scripts/ingest/mega-promos.mjs --commit  # write
 *
 * Why this exists instead of `mega-evolution-sets.mjs mep`:
 *
 *  1. TCGdex serves NO `image` field for any mep card, so the generic ingest
 *     would write null images. The art DOES exist at the conventional asset
 *     path (assets.tcgdex.net/en/me/mep/<localId>/high.webp) for 40 of the 60
 *     cards -- a missing field is not a missing asset. The remaining 20 resolve
 *     via TCGplayer product images, keyed off the `tcgplayerId` JustTCG returns.
 *  2. The generic ingest UPSERTS image_small/image_large as raw upstream URLs,
 *     which would clobber the mirrored Supabase URLs on rows already mirrored
 *     (the documented me05 gap-fill trap). This script only INSERTS ids that are
 *     absent, and mirrors art into our own storage before writing the row.
 *
 * Images are mirrored to card-images/<id>/{small,large}.webp exactly like the
 * rest of the catalog (245w q78 / 734w q82), then dHashed (9x8) so the scanner
 * matches them. Idempotent: re-running skips ids that already exist.
 */
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import fs from 'fs';

const COMMIT = process.argv.includes('--commit');

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
const JUSTTCG_KEY = (env.JUSTTCG_API_KEY || '').trim();

const SET_ID = 'mep';
const TCGDEX_API = 'https://api.tcgdex.net/v2/en';
const TCGDEX_ASSET = 'https://assets.tcgdex.net/en/me/mep';
const BUCKET = 'card-images';
const SMALL_W = 245, SMALL_Q = 78;
const LARGE_W = 734, LARGE_Q = 82;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tcgdex(path) {
  const res = await fetch(`${TCGDEX_API}${path}`);
  if (!res.ok) throw new Error(`TCGdex ${res.status} for ${path}`);
  return res.json();
}

/** dHash: 9x8 greyscale, compare adjacent pixels per row -> 64 bits. */
async function dhash(buf) {
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const hash = Buffer.alloc(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      if (px[row * 9 + col] > px[row * 9 + col + 1]) byte |= 1 << (7 - col);
    }
    hash[row] = byte;
  }
  return '\\x' + hash.toString('hex');
}

async function uploadWebp(objectPath, buf) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, buf, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
  if (error) throw new Error(`upload ${objectPath}: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

/** Resolve JustTCG's ME-promo products so we can borrow tcgplayerId + price. */
async function loadJustTcgPromos() {
  const byNum = new Map();
  if (!JUSTTCG_KEY) return byNum;
  let all = [];
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(
      `https://api.justtcg.com/v1/cards?game=pokemon&set=me-mega-evolution-promo-pokemon&conditions=NM&include_price_history=false&limit=100&offset=${offset}`,
      { headers: { 'x-api-key': JUSTTCG_KEY } },
    );
    if (!r.ok) { console.warn(`  JustTCG ${r.status}; continuing without prices`); break; }
    const j = await r.json();
    all = all.concat(j.data || []);
    if (!j.meta?.hasMore || (j.data || []).length < 100) break;
    await sleep(1300);
  }
  for (const c of all) {
    const n = String(c.number || '').split('/')[0].replace(/^0+/, '');
    if (!n) continue;
    // Prefer the plain print over [Staff]/(Cosmos Holo)/(Prerelease) variants:
    // those are separate collectibles and carry wildly different prices, so a
    // variant must never become the base card's price or image.
    const isVariant = /\(|\[/.test(c.name || '');
    const prev = byNum.get(n);
    if (!prev || (prev.isVariant && !isVariant)) byNum.set(n, { card: c, isVariant });
  }
  return byNum;
}

/** Fetch the best available art: TCGdex asset path first, then TCGplayer. */
async function fetchArt(localId, tcgplayerId) {
  const attempts = [`${TCGDEX_ASSET}/${localId}/high.webp`];
  if (tcgplayerId) attempts.push(`https://product-images.tcgplayer.com/fit-in/437x437/${tcgplayerId}.jpg`);
  for (const url of attempts) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const md = await sharp(buf).metadata();
      if (!md.width || !md.height) continue;
      return { buf, url, source: url.includes('tcgdex') ? 'tcgdex-asset-path' : 'tcgplayer-product-image' };
    } catch { /* try next */ }
  }
  return null;
}

(async () => {
  console.log(`mega-promos ingest ${COMMIT ? '(COMMIT)' : '(dry run -- pass --commit to write)'}`);

  const set = await tcgdex(`/sets/${SET_ID}`);
  const upstream = set.cards || [];
  console.log(`TCGdex ${SET_ID}: ${upstream.length} cards upstream`);

  const { data: existing, error: exErr } = await supabase
    .from('pokemon_cards').select('id').eq('set_id', SET_ID);
  if (exErr) throw new Error(`existing query: ${exErr.message}`);
  const have = new Set((existing || []).map((r) => r.id));
  const missing = upstream.filter((c) => !have.has(c.id));
  console.log(`already in DB: ${have.size}; to ingest: ${missing.length}`);
  if (!missing.length) { console.log('nothing to do'); return; }

  const jt = await loadJustTcgPromos();
  console.log(`JustTCG promo products indexed by number: ${jt.size}`);

  const rows = [], prices = [], phashes = [];
  const failures = [];

  for (const stub of missing) {
    const c = await tcgdex(`/cards/${stub.id}`).catch(() => null);
    if (!c) { failures.push({ id: stub.id, why: 'tcgdex card fetch failed' }); continue; }

    const numKey = String(c.localId).replace(/^0+/, '');
    const hit = jt.get(numKey);
    const tcgplayerId = hit?.card?.tcgplayerId || null;

    const art = await fetchArt(c.localId, tcgplayerId);
    if (!art) { failures.push({ id: c.id, why: 'no art on tcgdex asset path or tcgplayer' }); continue; }

    let smallUrl = null, largeUrl = null, phash = null;
    if (COMMIT) {
      const [largeBuf, smallBuf] = await Promise.all([
        sharp(art.buf).resize({ width: LARGE_W, withoutEnlargement: true }).webp({ quality: LARGE_Q }).toBuffer(),
        sharp(art.buf).resize({ width: SMALL_W, withoutEnlargement: true }).webp({ quality: SMALL_Q }).toBuffer(),
      ]);
      largeUrl = await uploadWebp(`${c.id}/large.webp`, largeBuf);
      smallUrl = await uploadWebp(`${c.id}/small.webp`, smallBuf);
      phash = await dhash(art.buf);
    }

    rows.push({
      id: c.id,
      name: c.name,
      english_name: c.name,
      language: 'en',
      game: 'pokemon',
      set_id: SET_ID,
      number: c.localId,
      supertype: c.category === 'Pokemon' ? 'Pokémon' : c.category,
      subtypes: c.subtypes || [],
      rarity: c.rarity || 'Promo',
      hp: c.hp || null,
      types: c.types || [],
      attacks: c.attacks || null,
      weaknesses: c.weaknesses || null,
      resistances: c.resistances || null,
      retreat_cost: c.retreat ? Array(c.retreat).fill('Colorless') : [],
      abilities: c.abilities || null,
      rules: c.rules || [],
      regulation_mark: c.regulationMark || null,
      image_small: smallUrl,
      image_large: largeUrl,
      tcgplayer_url: null,
      cardmarket_url: null,
      raw_data: {
        ...c,
        tcgplayer: c.pricing?.tcgplayer || null,
        image_origin: art.source,
        image_source_url: art.url,
        tcgplayer_product_id: tcgplayerId,
        set: { id: SET_ID, name: set.name, printedTotal: set.cardCount?.official },
      },
    });
    if (phash) phashes.push({ id: c.id, phash });

    // Price from the JustTCG NM variant, matching batch-price-english's shape.
    const variant = (hit?.card?.variants || [])
      .filter((v) => v.language === 'English' || !v.language)
      .sort((a, b) => {
        const score = (v) => (v.avgPrice > 0 ? 1000 : 0) + (v.condition === 'Near Mint' || v.condition === 'NM' ? 500 : 0);
        return score(b) - score(a);
      })[0];
    const price = variant?.avgPrice || variant?.price || 0;
    if (price > 0) {
      prices.push({
        card_id: c.id, language: 'en', condition: 'Raw_NM', market_avg: price,
        currency: 'USD',
        source_links: [`https://justtcg.com/card/${hit.card.id}`],
        source_prices: { market_price: price, low_price: variant?.minPrice30d ?? 0, high_price: variant?.maxPrice30d ?? 0, source: 'justtcg' },
        last_updated: new Date().toISOString(), last_priced_at: new Date().toISOString(),
      });
    }
    process.stdout.write(art.source === 'tcgdex-asset-path' ? '.' : '+');
  }
  console.log('');
  console.log(`prepared ${rows.length} rows (art: ${rows.filter(r => r.raw_data.image_origin === 'tcgdex-asset-path').length} tcgdex / ${rows.filter(r => r.raw_data.image_origin === 'tcgplayer-product-image').length} tcgplayer), ${prices.length} priced`);
  if (failures.length) console.log(`failures: ${failures.length}`, failures);

  if (!COMMIT) {
    console.log('\nDRY RUN -- sample row:');
    const s = rows[0];
    console.log({ id: s.id, name: s.name, number: s.number, rarity: s.rarity, art: s.raw_data.image_origin });
    console.log(`\nre-run with --commit to write ${rows.length} cards + ${prices.length} prices`);
    return;
  }

  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('pokemon_cards').upsert(rows.slice(i, i + 50), { onConflict: 'id' });
    if (error) throw new Error(`card upsert: ${error.message}`);
  }
  console.log(`cards: ${rows.length} upserted`);

  for (const p of phashes) {
    const { error } = await supabase.from('pokemon_cards').update({ phash: p.phash }).eq('id', p.id);
    if (error) console.warn(`  phash ${p.id}: ${error.message}`);
  }
  console.log(`phashes: ${phashes.length} written`);

  if (prices.length) {
    const { error } = await supabase.from('market_values').upsert(prices, { onConflict: 'card_id,language,condition' });
    if (error) console.warn(`price upsert: ${error.message}`);
    else console.log(`prices: ${prices.length} upserted`);
  }

  // Keep the set row's totals honest now that the lineup grew.
  const { count } = await supabase.from('pokemon_cards').select('id', { count: 'exact', head: true }).eq('set_id', SET_ID);
  await supabase.from('pokemon_sets').update({
    total: count ?? rows.length + have.size,
    printed_total: set.cardCount?.official || 0,
    name: set.name,
    series: set.serie?.name || 'Mega Evolution',
  }).eq('id', SET_ID);
  console.log(`set row updated: total=${count}`);
  console.log('\nDone.');
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
