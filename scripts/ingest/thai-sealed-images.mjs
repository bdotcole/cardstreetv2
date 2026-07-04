// Images for Thai sealed products (sealed_products language='th').
//
// v2 (2026-07-04): Thai boxes/packs now use REAL Thai packaging photos from the
// official Thai site (asia.pokemon-card.com/th), not the JP twin's photo — the JP
// box art carries Japanese wordmarks and was being mistaken for the wrong product.
// The map below was assembled from the live /th/products/ page plus Wayback
// snapshots of it (2022-2026); every URL was HEAD-verified live and the ambiguous
// filenames (62/63, 66/67, 70/71, AS-era hashes) were verified by eye against the
// pack wordmarks. S9 has no standalone packshot anywhere on the site, so its pack
// is cropped out of the Star Birth special-page hero banner.
//
// Images are MIRRORED into our own storage (card-images/sealed-th/<setId>.webp)
// rather than hotlinked — same policy as card art (upstream hosts go down; June
// 2026 TCGdex outage). lib/imageUtils passes /card-images/ URLs through directly,
// so no next.config or render-endpoint changes are needed. One image per set,
// shared by the box and pack rows (the official packaging shot covers both).
//
// Fallback for any th set missing from the map: the Thai set logo
// (pokemon_sets.logo_url) — never the JP twin.
//
//   node scripts/ingest/thai-sealed-images.mjs           # DRY: source report
//   node scripts/ingest/thai-sealed-images.mjs --commit  # mirror + write image_url
//
// Idempotent: storage upload is upsert, row update is per-row UPDATE. Also
// re-snapshots card_data.images on any active listings of these products.

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
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

const UP = 'https://asia.pokemon-card.com/th/wp-content/uploads/sites/4';
const BUCKET = 'card-images';
const PREFIX = 'sealed-th';

// set_id -> official Thai product image. `crop` (sharp extract) is applied first
// when present. Numbered 2021 filenames are pack photos on the old products page;
// which number is which set was confirmed visually (62=Rapid Strike blue, 63=
// Single Strike red, 66=Jet-Black, 67=Silver Lance, 70=Blue Sky, 71=Skyscraping).
const THAI_PRODUCT_IMAGES = {
  // Sun & Moon (AS) era — pack shots from the sun_moon archive pages.
  AS1a: { url: `${UP}/2021/09/BoosterPackA-thumb-240x240-13061.png` },
  AS1b: { url: `${UP}/2021/09/BoosterPackB-thumb-240x240-13060.png` },
  AS2a: { url: `${UP}/2021/09/Booster20pack2028SET20A29-thumb-240x240-13416.png` },
  AS2b: { url: `${UP}/2021/09/Booster20pack2028SET20B29-thumb-240x240-13417.png` },
  AS3a: { url: `${UP}/2021/09/bbebae61f99a8a4e75f4a99f2f36611109db549a-thumb-240x240-13568.png` },
  AS3b: { url: `${UP}/2021/09/60ebfdbb9d91545fa5ebf3f090d5f72ab95c165b-thumb-240x240-13562.png` },
  AS4a: { url: `${UP}/2021/09/main_setA-thumb-650x488-13959.png` },
  AS4b: { url: `${UP}/2021/09/main_setB-thumb-240x240-13953.png` },
  AS5a: { url: `${UP}/2021/09/main_a-thumb-240x240-14228.png` },
  AS5b: { url: `${UP}/2021/09/main_b-thumb-240x240-14222.png` },
  AS6a: { url: `${UP}/2021/09/2359f7a4d09c487f10996346db4473dbcec1018e-thumb-240x240-14487.png` },
  AS6b: { url: `${UP}/2021/09/755e52d1f5dcdb3d22dc751d24fe3c5cfbce2b21-thumb-240x240-14481.png` },
  // Sword & Shield era.
  SC1a: { url: `${UP}/2021/09/thumb_setA-thumb-240x240-15062.png` },
  SC1b: { url: `${UP}/2021/09/thumb_setB-thumb-240x240-15051.png` },
  S5I:  { url: `${UP}/2021/09/63-thumb-240x240-16019.jpg` },
  S5R:  { url: `${UP}/2021/09/62-thumb-240x240-16019.jpg` },
  S5a:  { url: `${UP}/2021/09/65-thumb-240x240-16019.jpg` },
  S6h:  { url: `${UP}/2021/09/67-thumb-240x240-16019.jpg` },
  s6k:  { url: `${UP}/2021/09/66-thumb-240x240-16019.jpg` },
  S6a:  { url: `${UP}/2021/09/68-thumb-240x240-16019.jpg` },
  S7R:  { url: `${UP}/2021/09/70-thumb-240x240-16019.jpg` },
  S7D:  { url: `${UP}/2021/09/71-thumb-240x240-16019.jpg` },
  S8:   { url: `${UP}/2022/03/ths8-thumb-240x240-17051.png` },
  S8a:  { url: `${UP}/2022/03/S8a-thumb-240x240-17225.png` },
  S8b:  { url: `${UP}/2022/03/S8b-thumb-240x240-17122.png` },
  // S9 Star Birth: no standalone packshot on the site — crop the Thai pack out of
  // the special-page hero banner (980x351, pack at the left edge).
  S9:   { url: 'https://asia.pokemon-card.com/th/archive/special/card/s9/img/hero-image.png', crop: { left: 60, top: 10, width: 142, height: 268 } },
  S9a:  { url: `${UP}/2022/04/tw_product_thumbnail_S9a.png` },
  S10D: { url: `${UP}/2022/05/th_product_thumbnail_S10D.png` },
  S10P: { url: `${UP}/2022/05/th_product_thumbnail_S10P.png` },
  S10a: { url: `${UP}/2022/07/th_product_thumbnail_S10a.png` },
  S10b: { url: `${UP}/2022/04/th_product_thumbnail.png` },
  S11:  { url: `${UP}/2022/08/th_product_thumbnail_S11.png` },
  S11a: { url: `${UP}/2022/09/th_product_thumbanail_s11a.png` }, // (sic) upstream typo
  S12:  { url: `${UP}/2022/10/th_product_thumbnail_s12.png` },
  S12a: { url: `${UP}/2022/11/TH_PRODUCT_THUMBNAIL_S12a.png` },
  // Scarlet & Violet era.
  SV1S: { url: `${UP}/2023/02/SV1S_TH_PRODUCT_THUMBNAIL.png` },
  SV1V: { url: `${UP}/2023/02/SV1V_TH_PRODUCT_THUMBNAIL.png` },
  SV1a: { url: `${UP}/2023/03/TH_PRODUCT_THUMBNAIL_SV1a.png` },
  SV2D: { url: `${UP}/2023/05/TH_product_thumbnail_SV2D.png` },
  SV2P: { url: `${UP}/2023/05/TH_product_thumbnail_SV2P.png` },
  SV2a: { url: `${UP}/2023/06/TH_product_thumbnail_SV2a.png` },
  SV3:  { url: `${UP}/2023/08/TH_product_thumbnail_SV3.png` },
  SV3a: { url: `${UP}/2023/09/TH_product_thumbnail_SV3a.png` },
  SV4K: { url: `${UP}/2023/11/th_product_thumbnail_SV4K.png` },
  SV4M: { url: `${UP}/2023/11/th_product_thumbnail_SV4M.png` },
  SV4a: { url: `${UP}/2023/12/th_product_thumbnail_sv4a-1.png` },
  SV5K: { url: `${UP}/2024/01/th_product_thumbnail_sv5k.png` },
  SV5M: { url: `${UP}/2024/01/th_product_thumbnail_sv5m.png` },
  SV5a: { url: `${UP}/2024/03/th_product_thumbnail_sv5a.png` },
  SV6:  { url: `${UP}/2024/04/th_product_thumbnail_SV6.png` },
  SV7s: { url: `${UP}/2024/07/th_product_thumbnail_SV7s.png` },
  SV8s: { url: `${UP}/2024/10/th_product_thumbnail_sv8s.png` },
  SV8a: { url: `${UP}/2024/12/th_product_thumbnail_sv8a.png` },
  SV9s: { url: `${UP}/2025/03/th_product_thumbnail_SV9s_pillow_.png` },
  SV10s: { url: `${UP}/2025/05/th_product_thumbnail_SV10s.png` },
  SV11s: { url: `${UP}/2025/06/th_product_thumbnail_SV11s_pillow.png` },
  // Mega era.
  MA1:  { url: `${UP}/2025/08/th_product_thumbnail_MA1_pillow.png` },
  MA2:  { url: `${UP}/2025/09/th_product_thumbnail_MA2_pkg.png` },
  MA3:  { url: `${UP}/2025/12/th_product_thumbnail_MA3_pkg.png` },
  MA4:  { url: `${UP}/2026/02/th_product_thumbnail_MA4_pkg.png` },
  MA5:  { url: `${UP}/2026/04/th_product_thumbnail_MA5_pkg.png` },
  MA6:  { url: `${UP}/2026/05/th_product_thumbnail_m6a_pkg.png` }, // no sealed rows yet; ready for the next ingest
};

const publicUrl = (path) =>
  `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

async function mirrorSet(setId, spec) {
  const res = await fetch(spec.url);
  if (!res.ok) throw new Error(`${setId}: source fetch ${res.status}`);
  let img = sharp(Buffer.from(await res.arrayBuffer()));
  if (spec.crop) img = img.extract(spec.crop);
  // Cap at 480 (the largest the source era offers); never upscale.
  const buf = await img.resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  const path = `${PREFIX}/${setId}.webp`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: true,
  });
  if (error) throw new Error(`${setId}: storage upload — ${error.message}`);
  return { url: publicUrl(path), bytes: buf.length };
}

async function main() {
  const commit = process.argv.includes('--commit');

  const [{ data: sealed, error: e1 }, { data: sets, error: e2 }] = await Promise.all([
    supabase.from('sealed_products').select('id, set_id, image_url').eq('language', 'th').order('id'),
    supabase.from('pokemon_sets').select('id, logo_url').eq('game', 'pokemon').eq('language', 'th'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const logoBySet = new Map((sets || []).map((s) => [s.id, s.logo_url]));

  const setIds = [...new Set((sealed || []).map((r) => r.set_id).filter(Boolean))];
  const mapped = setIds.filter((s) => THAI_PRODUCT_IMAGES[s]);
  const unmapped = setIds.filter((s) => !THAI_PRODUCT_IMAGES[s]);
  console.log(`[thai-img] th sealed rows=${(sealed || []).length} sets=${setIds.length} mapped=${mapped.length} logo-fallback=${unmapped.length}${commit ? '' : '  [DRY]'}`);
  if (unmapped.length) console.log(`[thai-img] no official image (using Thai set logo): ${unmapped.join(', ')}`);
  if (!commit) { console.log('[thai-img] DRY — nothing written. Re-run with --commit.'); return; }

  const urlBySet = new Map();
  for (const setId of mapped) {
    const { url, bytes } = await mirrorSet(setId, THAI_PRODUCT_IMAGES[setId]);
    urlBySet.set(setId, url);
    console.log(`   ${setId.padEnd(6)} mirrored ${(bytes / 1024).toFixed(0)}kB`);
  }
  for (const setId of unmapped) {
    const logo = logoBySet.get(setId);
    if (logo) urlBySet.set(setId, logo);
  }

  let written = 0;
  for (const r of sealed || []) {
    const url = urlBySet.get(r.set_id);
    if (!url || r.image_url === url) continue;
    const { error } = await supabase.from('sealed_products').update({ image_url: url }).eq('id', r.id);
    if (error) throw error;
    written++;
  }
  console.log(`[thai-img] DONE — updated image_url on ${written} Thai sealed rows`);

  // Active listings snapshot card_data at creation; re-point their images so
  // marketplace tiles don't keep showing the old JP art.
  const ids = (sealed || []).map((r) => r.id);
  const { data: listings } = await supabase
    .from('listings')
    .select('id, card_id, card_data')
    .in('card_id', ids)
    .eq('status', 'active');
  let synced = 0;
  for (const l of listings || []) {
    const setId = (sealed || []).find((r) => r.id === l.card_id)?.set_id;
    const url = setId && urlBySet.get(setId);
    if (!url || !l.card_data || l.card_data.imageUrl === url) continue;
    const card_data = { ...l.card_data, imageUrl: url, images: { small: url, large: url } };
    const { error } = await supabase.from('listings').update({ card_data }).eq('id', l.id);
    if (error) throw error;
    synced++;
  }
  console.log(`[thai-img] listing snapshots re-pointed: ${synced}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[thai-img] FAILED:', e.message); process.exit(1); });
