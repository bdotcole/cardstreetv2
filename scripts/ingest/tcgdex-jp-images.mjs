// Backfill missing Japanese Pokemon card images from TCGdex.
//
// Many ja rows were ingested when TCGdex had no scan for the card (raw_data has
// no `image`). This re-checks every image-less ja card against the TCGdex API and
// fills any image that now exists, mirroring the URL shape of already-imaged rows
// (`<base>/low`, `<base>/high`). Idempotent, resumable, concurrency-limited.
//
//   node scripts/ingest/tcgdex-jp-images.mjs
//
// Reports the residual gap — cards TCGdex still has no scan for (an upstream data
// limitation, not fixable here).

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

const CONCURRENCY = 8;

async function tcgdexImage(id) {
  try {
    const r = await fetch(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.image || null; // base URL, e.g. https://assets.tcgdex.net/ja/S/S12/005
  } catch {
    return null;
  }
}

async function main() {
  // Pull all image-less ja cards (cursor by id so updates drop out of the filter).
  const missing = [];
  let cursor = '';
  for (;;) {
    const { data, error } = await supabase
      .from('pokemon_cards')
      .select('id, raw_data')
      .eq('game', 'pokemon')
      .eq('language', 'ja')
      .or('image_small.is.null,image_small.eq.')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw error;
    if (!data?.length) break;
    missing.push(...data);
    cursor = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  console.log(`[jp-images] image-less ja cards: ${missing.length}`);

  let recovered = 0;
  let stillMissing = 0;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (card) => {
        const base = await tcgdexImage(card.id);
        if (!base) {
          stillMissing++;
          return;
        }
        const raw = { ...(card.raw_data || {}), image: base };
        const { error } = await supabase
          .from('pokemon_cards')
          .update({ image_small: `${base}/low`, image_large: `${base}/high`, raw_data: raw })
          .eq('id', card.id);
        if (error) {
          console.error(`[jp-images] update failed ${card.id}:`, error.message);
          stillMissing++;
        } else {
          recovered++;
        }
      }),
    );
    if ((i / CONCURRENCY) % 25 === 0) console.log(`[jp-images] progress ${i}/${missing.length} (recovered ${recovered})`);
  }
  console.log(`[jp-images] done: recovered ${recovered}, still missing upstream ${stillMissing}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[jp-images] FAILED:', e.message);
  process.exit(1);
});
