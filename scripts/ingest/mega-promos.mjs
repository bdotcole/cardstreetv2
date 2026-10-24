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
 *     cards -- a missing field is not a missing asset. The remaining 20 used to
 *     resolve via TCGplayer product images keyed off the `tcgplayerId` JustTCG
 *     returned; that subscription ended in 2026-10, so a card without TCGdex art
 *     is reported as a failure until another product-id source is wired in (the
 *     PriceCharting CSV `tcg-id` column carries it).
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

const SET_ID = 'mep';
const TCGDEX_API = 'https://api.tcgdex.net/v2/en';
const TCGDEX_ASSET = 'https://assets.tcgdex.net/en/me/mep';
const BUCKET = 'card-images';
const SMALL_W = 245, SMALL_Q = 78;
const LARGE_W = 734, LARGE_Q = 82;

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

  const rows = [], phashes = [];
  const failures = [];

  for (const stub of missing) {
    const c = await tcgdex(`/cards/${stub.id}`).catch(() => null);
    if (!c) { failures.push({ id: stub.id, why: 'tcgdex card fetch failed' }); continue; }

    // No TCGplayer product id without JustTCG, so only the TCGdex asset path is tried.
    const tcgplayerId = null;

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

    process.stdout.write(art.source === 'tcgdex-asset-path' ? '.' : '+');
  }
  console.log('');
  console.log(`prepared ${rows.length} rows (art: ${rows.filter(r => r.raw_data.image_origin === 'tcgdex-asset-path').length} tcgdex / ${rows.filter(r => r.raw_data.image_origin === 'tcgplayer-product-image').length} tcgplayer)`);
  if (failures.length) console.log(`failures: ${failures.length}`, failures);

  if (!COMMIT) {
    console.log('\nDRY RUN -- sample row:');
    const s = rows[0];
    console.log({ id: s.id, name: s.name, number: s.number, rarity: s.rarity, art: s.raw_data.image_origin });
    console.log(`\nre-run with --commit to write ${rows.length} cards`);
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

  // Prices arrive from the PriceCharting cron once the bridge maps the new ids.

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
