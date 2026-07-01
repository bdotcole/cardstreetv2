// One-off cleanup: remove single CARDS that were mis-filed into sealed_products.
//
// The original sealed ingest classified any product-name containing a sealed-sounding
// word ("tin", "pack", "collection", "gift", "box") as sealed, so thousands of single
// cards leaked in — Tin Toppers ("Bulbasaur [Tin Topper] #3"), Prize Pack energy cards,
// Yu-Gi-Oh/One Piece set-code cards ("Tin Goldfish CPZ1-JP016"), MTG foils
// ("Teferi's Puzzle Box [Foil]"), etc. They pollute the app's Sealed browse tab.
//
// This deletes every sealed_products row whose name is a CARD per the fixed
// classifySealed() in lib/pricecharting.ts (returns null). The classifier is the single
// source of truth, mirrored here (mjs can't import the TS module). Re-running the fixed
// ingest will NOT re-add these rows. Deletion is reversible via re-ingest.
//
//   node scripts/ingest/pricecharting-cleanup-cards.mjs           # DRY: counts + samples
//   node scripts/ingest/pricecharting-cleanup-cards.mjs --commit  # delete card rows

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

// ── classifySealed — MUST stay in sync with lib/pricecharting.ts ──────────────────
const CARD_NUMBER_RE = /#\s*[A-Za-z]{0,5}\d{1,4}\b/;
const CARD_SETCODE_RE = /\b[A-Z]{1,5}\d{0,2}-[A-Z]{0,4}\d{1,4}[a-z]?\b\s*$/;
const CONTAINER_HEAD_RE = /^\s*(sealed\s+|factory\s+sealed\s+)?(booster box|booster pack|booster bundle|elite trainer box|\betb\b|double pack|triple pack|build\s*&?\s*battle|starter deck|structure deck|prerelease|bundle box|display box|booster case)\b/i;
const CARD_VARIANT_RE = /\[(foil|non-?foil[^\]]*|etched[^\]]*|extended art|borderless|showcase|retro frame|full art|alt(?:ernate)? art|[^\]]*\bfoil\b|serial(?:ized)?|prize pack[^\]]*|tin topper|box topper|storage box set[^\]]*|illustration box[^\]]*|dash pack|welcome pack[^\]]*|master ball|poke ball|reverse holo)\]/i;
const SEALED_KEYWORDS = [
  [/elite trainer box|\betb\b/i, 'etb'],
  [/booster box|booster case|display box/i, 'booster_box'],
  [/booster bundle|booster pack|sleeved booster|\bblister\b|fat pack|\bpack\b/i, 'booster_pack'],
  [/\bbundle\b|build\s*&?\s*battle|prerelease|\bjumpstart\b|toolkit/i, 'bundle'],
  [/starter deck|structure deck|commander deck|theme deck|planeswalker deck|challenger deck|battle deck|deck box|deckbuilder|\bdeck\b/i, 'other'],
  [/\bcollection\b|\btin\b|premium|box set|\bgift\b|\btrove\b|portfolio|\bbinder\b|\bcalendar\b|advent|checklane|storage box|\bbox\b/i, 'collection'],
];
function looksLikeCardProductName(name) {
  const n = name || '';
  if (CARD_VARIANT_RE.test(n)) return true;
  return (CARD_NUMBER_RE.test(n) || CARD_SETCODE_RE.test(n)) && !CONTAINER_HEAD_RE.test(n);
}
function classifySealed(name) {
  const n = name || '';
  if (looksLikeCardProductName(n)) return null;
  for (const [re, type] of SEALED_KEYWORDS) if (re.test(n)) return type;
  return null;
}

async function main() {
  const commit = process.argv.includes('--commit');

  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from('sealed_products')
      .select('id, name, game').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const toDelete = rows.filter((r) => classifySealed(r.name || '') === null);
  const keep = rows.length - toDelete.length;
  const byGame = {};
  for (const r of toDelete) byGame[r.game] = (byGame[r.game] || 0) + 1;

  console.log(`[cleanup] sealed_products: ${rows.length}  ->  cards to DELETE: ${toDelete.length}  keep (sealed): ${keep}`);
  console.log(`[cleanup] delete by game: ${JSON.stringify(byGame)}`);
  const sample = (a, n) => a.slice().sort(() => Math.random() - 0.5).slice(0, n);
  console.log('[cleanup] delete sample:');
  sample(toDelete, 12).forEach((r) => console.log(`     x ${r.game} | ${r.name}`));

  if (!commit) { console.log('[cleanup] DRY — nothing deleted. Re-run with --commit.'); return; }

  const ids = toDelete.map((r) => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { error } = await supabase.from('sealed_products').delete().in('id', batch);
    if (error) throw error;
    done += batch.length;
    if (done % 1000 === 0 || done === ids.length) console.log(`[cleanup] deleted ${done}/${ids.length}`);
  }
  console.log(`[cleanup] DONE — deleted ${ids.length} card rows; ${keep} sealed products remain`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[cleanup] FAILED:', e.message); process.exit(1); });
