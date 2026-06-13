/**
 * One-time backfill: repoint existing listings' card_data image snapshots at
 * the (now mirrored) catalog images, so marketplace thumbnails — which read
 * listing.card_data.images, not the live catalog — serve self-hosted art.
 *
 * New listings created after the mirror already snapshot the mirrored URL at
 * creation time, so this is only needed for listings that predate the mirror.
 * Run AFTER mirror-card-images.mjs has covered the relevant cards.
 *
 *   node scripts/repoint-listing-images.mjs [--dry]
 *
 * Idempotent: a listing already pointing at card-images is left untouched.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('='); if (i < 0 || line.trim().startsWith('#')) continue;
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[line.slice(0, i).trim()] = v;
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DRY = process.argv.includes('--dry');

const { data: listings, error } = await supabase
  .from('listings')
  .select('id, card_id, card_data, status')
  .eq('status', 'active');
if (error) throw error;
console.log(`active listings: ${listings.length}`);

// Look up current catalog images for the referenced cards (dedup by card_id).
const cardIds = [...new Set(listings.map((l) => l.card_id))];
const catalog = {};
for (let i = 0; i < cardIds.length; i += 200) {
  const slice = cardIds.slice(i, i + 200);
  const { data } = await supabase
    .from('pokemon_cards')
    .select('id, image_small, image_large')
    .in('id', slice);
  for (const c of data || []) catalog[c.id] = c;
}

let updated = 0, skipped = 0, noCatalog = 0, notMirrored = 0;
for (const l of listings) {
  const cat = catalog[l.card_id];
  if (!cat) { noCatalog++; continue; }
  // Only repoint once the catalog image is actually self-hosted; otherwise
  // we'd just copy another third-party URL into the snapshot.
  if (!cat.image_small?.includes('/card-images/')) { notMirrored++; continue; }

  const cd = l.card_data || {};
  const imgs = cd.images || {};
  if (imgs.small === cat.image_small && imgs.large === cat.image_large) { skipped++; continue; }

  const newCardData = {
    ...cd,
    imageUrl: cat.image_large,
    images: { ...imgs, small: cat.image_small, large: cat.image_large },
  };
  if (DRY) { updated++; continue; }
  const { error: ue } = await supabase.from('listings').update({ card_data: newCardData }).eq('id', l.id);
  if (ue) { console.warn(`  fail ${l.id}: ${ue.message}`); continue; }
  updated++;
}

console.log(`done: updated=${updated} skipped(already)=${skipped} not-yet-mirrored=${notMirrored} no-catalog-row=${noCatalog}${DRY ? ' (dry)' : ''}`);
process.exit(0);
