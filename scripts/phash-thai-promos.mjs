// pHash (dHash) the Thai promo rows (M-P, S-P) so the scanner can match them.
// Their images are real Thai promo scans from the official site, so hashing them
// is correct (unlike EN-counterpart stand-ins, which must NOT be hashed). dHash
// algorithm copied from scripts/backfill-phashes.mjs (9x8 greyscale, 64 bits).
//
//   node scripts/phash-thai-promos.mjs

import sharp from 'sharp';
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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function computeDHash(buf) {
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const hash = Buffer.alloc(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) if (px[row * 9 + col] > px[row * 9 + col + 1]) byte |= 1 << (7 - col);
    hash[row] = byte;
  }
  return '\\x' + hash.toString('hex');
}

async function fetchImage(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'cardstreet-phash/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (attempt < 2) { await new Promise((r) => setTimeout(r, 250 * (attempt + 1))); return fetchImage(url, attempt + 1); }
    throw e;
  }
}

const { data: rows } = await supabase
  .from('pokemon_cards')
  .select('id, image_small, image_large')
  .in('set_id', ['M-P', 'S-P'])
  .is('phash', null);

console.log(`pHashing ${rows?.length ?? 0} Thai promo rows...`);
let ok = 0, fail = 0;
const CONC = 8;
for (let i = 0; i < (rows?.length ?? 0); i += CONC) {
  await Promise.all(rows.slice(i, i + CONC).map(async (r) => {
    const url = r.image_large || r.image_small;
    if (!url) { fail++; return; }
    try {
      const hex = await computeDHash(await fetchImage(url));
      const { error } = await supabase.from('pokemon_cards').update({ phash: hex }).eq('id', r.id);
      if (error) throw error;
      ok++;
    } catch (e) { fail++; console.warn(`  fail ${r.id}: ${e.message}`); }
  }));
}
console.log(`Done. ok=${ok} fail=${fail}`);
process.exit(0);
