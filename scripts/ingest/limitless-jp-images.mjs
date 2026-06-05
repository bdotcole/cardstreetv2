// Backfill Japanese Pokemon card images from Limitless TCG for sets TCGdex lacks.
//
// TCGdex (our primary ja source) has no scans for some modern sets — notably
// SV11W (White Flare). Limitless serves those at a clean, constructible CDN URL:
//   https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/<SET>/<SET>_<N>_R_JP_LG.png
// (LG = large, SM = small; <N> is the card number with leading zeros stripped).
// No scraping needed. We HEAD-check each URL and only store ones that exist.
//
//   node scripts/ingest/limitless-jp-images.mjs SV11W
//
// Idempotent: only touches ja cards in the set that are still image-less.

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

const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const CONCURRENCY = 8;

const lgUrl = (set, n) => `${CDN}/${set}/${set}_${n}_R_JP_LG.png`;
const smUrl = (set, n) => `${CDN}/${set}/${set}_${n}_R_JP_SM.png`;

async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function main() {
  const set = (process.argv[2] || 'SV11W').toUpperCase();
  const { data, error } = await supabase
    .from('pokemon_cards')
    .select('id, number')
    .eq('game', 'pokemon')
    .eq('language', 'ja')
    .eq('set_id', set)
    .or('image_small.is.null,image_small.eq.');
  if (error) throw error;
  console.log(`[limitless-jp] ${set}: ${data.length} image-less cards`);

  let filled = 0;
  let missing = 0;
  for (let i = 0; i < data.length; i += CONCURRENCY) {
    const batch = data.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (card) => {
        const n = String(card.number || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
        if (!n) {
          missing++;
          return;
        }
        const lg = lgUrl(set, n);
        if (!(await exists(lg))) {
          missing++;
          return;
        }
        const { error: upErr } = await supabase
          .from('pokemon_cards')
          .update({ image_small: smUrl(set, n), image_large: lg })
          .eq('id', card.id);
        if (upErr) {
          console.error(`[limitless-jp] update failed ${card.id}:`, upErr.message);
          missing++;
        } else {
          filled++;
        }
      }),
    );
  }
  console.log(`[limitless-jp] done: filled ${filled}, still missing ${missing}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[limitless-jp] FAILED:', e.message);
  process.exit(1);
});
