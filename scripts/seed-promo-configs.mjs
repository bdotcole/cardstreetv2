// Seed marketplace_configs with the Pokemon promo sets.
//
// The daily English pricing cron (`batch-price-english` Edge Function) only
// prices a set if it has a marketplace_configs row mapping our set_id to the
// JustTCG set slug. Every promo set was missing from that table, so the cron
// skipped them and their prices sat at 0%. This registers them so the cron
// keeps promo prices fresh going forward.
//
// Slugs verified against GET /v1/sets?game=pokemon and dry-run number/name
// matching (see scripts/diag-promo5.mjs). Idempotent (upsert on set_id).
//
//   node scripts/seed-promo-configs.mjs

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

// our set_id -> JustTCG set slug (game=pokemon)
const PROMO_CONFIGS = {
  smp:   'sm-promos-pokemon',
  svp:   'sv-scarlet-violet-promo-cards-pokemon',
  swshp: 'swsh-sword-shield-promo-cards-pokemon',
  xyp:   'xy-promos-pokemon',
  dpp:   'diamond-and-pearl-promos-pokemon',
  bwp:   'black-and-white-promos-pokemon',
  hgssp: 'hgss-promos-pokemon',
  basep: 'wotc-promo-pokemon',
  np:    'nintendo-promos-pokemon',
  mep:   'me-mega-evolution-promo-pokemon',
};

const rows = Object.entries(PROMO_CONFIGS).map(([set_id, justtcg_slug]) => ({
  set_id,
  justtcg_slug,
  active: true,
  updated_at: new Date().toISOString(),
}));

const { error } = await supabase
  .from('marketplace_configs')
  .upsert(rows, { onConflict: 'set_id' });

if (error) {
  console.error('upsert failed:', error.message);
  process.exit(1);
}
console.log(`Seeded ${rows.length} promo marketplace_configs rows.`);

const { data } = await supabase
  .from('marketplace_configs')
  .select('set_id, justtcg_slug, active')
  .in('set_id', Object.keys(PROMO_CONFIGS));
for (const r of (data || []).sort((a, b) => a.set_id.localeCompare(b.set_id)))
  console.log(`  ${r.set_id} -> ${r.justtcg_slug} (active=${r.active})`);
