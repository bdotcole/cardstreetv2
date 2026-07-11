// One Piece set metadata backfill: release_date + logo_url (EN + JA).
//
// optcgapi / the PriceCharting CSV carry neither, so set browsers ordered One
// Piece arbitrarily and tiles fell back to the set-id text.
//
//   node scripts/ingest/onepiece-set-meta.mjs           # DRY: report
//   node scripts/ingest/onepiece-set-meta.mjs --commit  # write
//
// Release dates
//   EN: TCGplayer group publishedOn via tcgcsv.com (category 68), matched by
//       normalized group name with an abbreviation fallback.
//   JA: curated map below. Bandai removed pre-renewal product pages, and
//       PriceCharting's release-date stamps US availability (JP Romance Dawn
//       says 2022-12-01), so JP dates were compiled 2026-07-11 from
//       onepicard.online (ST-01..20 paired per entry), 攻略大百科/gamepedia
//       (boosters, EB, PRB, ST-23..30), and one-piece.com news posts
//       (ST-21 2024-12-21, ST-22 2025-04-26, EB-02 2025-01-25).
//   Promo sets have no meaningful date and stay null (they sort last).
//
// Logos
//   One Piece has no wordmark asset source (Limitless/optcgapi serve only card
//   scans), so tiles use the set's sealed packshot — booster box preferred,
//   then pack/collection/deck — from sealed_products.image_url, following the
//   Riftbound precedent of a product shot in the 64x40 object-contain slot.
//   Sets with no imaged sealed product fall back to the set's first card image
//   (the leader card on starter decks — the Lorcana/Riftbound convention).
//
// Idempotent; only fills what it can resolve, never overwrites a non-null
// value with null.

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

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Japanese release dates, keyed by the set-code segment of our op-<code>-jp ids.
const JP_DATES = {
  'op-01': '2022-07-22', 'op-02': '2022-11-04', 'op-03': '2023-02-11',
  'op-04': '2023-05-27', 'op-05': '2023-08-26', 'op-06': '2023-11-25',
  'op-07': '2024-02-24', 'op-08': '2024-05-25', 'op-09': '2024-08-31',
  'op-10': '2024-11-30', 'op-11': '2025-03-01', 'op-12': '2025-05-31',
  'op-13': '2025-08-23', 'op-14': '2025-11-22', 'op-15': '2026-02-28',
  'op-16': '2026-05-30',
  'eb-01': '2024-01-27', 'eb-02': '2025-01-25', 'eb-03': '2025-10-25',
  'eb-04': '2026-01-31',
  'prb-01': '2024-07-27', 'prb-02': '2025-07-26',
  'st-01': '2022-07-08', 'st-02': '2022-07-08', 'st-03': '2022-07-08',
  'st-04': '2022-07-08', 'st-05': '2022-08-06', 'st-06': '2022-08-06',
  'st-07': '2023-01-21', 'st-08': '2023-03-25', 'st-09': '2023-03-25',
  'st-10': '2023-07-29', 'st-11': '2023-10-07', 'st-12': '2023-10-28',
  'st-13': '2023-12-23', 'st-14': '2024-04-27', 'st-15': '2024-07-13',
  'st-16': '2024-07-13', 'st-17': '2024-07-13', 'st-18': '2024-07-13',
  'st-19': '2024-07-13', 'st-20': '2024-07-13', 'st-21': '2024-12-21',
  'st-22': '2025-04-26', 'st-23': '2025-06-28', 'st-24': '2025-06-28',
  'st-25': '2025-06-28', 'st-26': '2025-06-28', 'st-27': '2025-06-28',
  'st-28': '2025-06-28', 'st-29': '2025-12-20', 'st-30': '2026-04-11',
};

// Sealed packshot preference for the logo slot.
const LOGO_TYPE_RANK = { booster_box: 0, booster_pack: 1, collection: 2, etb: 3, bundle: 4, other: 5 };

async function main() {
  const commit = process.argv.includes('--commit');

  const { data: sets, error } = await supabase
    .from('pokemon_sets')
    .select('id, name, language, release_date, logo_url')
    .eq('game', 'onepiece')
    .order('id');
  if (error) throw error;

  // EN dates from TCGplayer groups (publishedOn), by normalized name + abbreviation.
  // tcgcsv 401s the default node-fetch UA; any browser-ish UA passes.
  const res = await fetch('https://tcgcsv.com/tcgplayer/68/groups', { headers: { 'User-Agent': 'CardStreetTCG/1.0' } });
  if (!res.ok) throw new Error(`tcgcsv ${res.status}`);
  const groups = (await res.json()).results || [];
  const enByName = new Map();
  const enByAbbr = new Map();
  for (const g of groups) {
    const date = (g.publishedOn || '').slice(0, 10);
    if (!date) continue;
    if (!enByName.has(norm(g.name))) enByName.set(norm(g.name), date);
    if (g.abbreviation) enByAbbr.set(norm(g.abbreviation), date);
  }

  // Sealed packshots per set.
  const { data: sealed, error: sErr } = await supabase
    .from('sealed_products')
    .select('set_id, language, product_type, image_url')
    .eq('game', 'onepiece')
    .not('image_url', 'is', null)
    .not('set_id', 'is', null);
  if (sErr) throw sErr;
  const logoBySet = new Map();
  for (const p of sealed) {
    const rank = LOGO_TYPE_RANK[p.product_type] ?? 9;
    const prev = logoBySet.get(p.set_id);
    if (!prev || rank < prev.rank) logoBySet.set(p.set_id, { rank, url: p.image_url });
  }

  let dated = 0, logoed = 0;
  const misses = [];
  for (const s of sets) {
    const patch = {};
    if (!s.release_date) {
      let date = null;
      if (s.language === 'ja') {
        const code = s.id.replace(/^op-/, '').replace(/-jp$/, ''); // op-st-01-jp -> st-01
        date = JP_DATES[code] || null;
      } else {
        date = enByName.get(norm(s.name)) || enByAbbr.get(norm(s.id.replace(/^op-/, ''))) || null;
      }
      if (date) { patch.release_date = date; dated++; }
      else misses.push(`date  ${s.id} (${s.language}) "${s.name}"`);
    }
    if (!s.logo_url) {
      let logo = logoBySet.get(s.id)?.url || null;
      if (!logo) {
        // No imaged sealed product — use the set's first card (starter-deck
        // leaders sit at number 001), same stand-in Lorcana/Riftbound use.
        const { data: firstCard } = await supabase
          .from('pokemon_cards')
          .select('image_small')
          .eq('set_id', s.id)
          .not('image_small', 'eq', '')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();
        logo = firstCard?.image_small || null;
      }
      if (logo) { patch.logo_url = logo; logoed++; }
      else misses.push(`logo  ${s.id} (${s.language})`);
    }
    if (Object.keys(patch).length) {
      console.log(`${s.id}  ${patch.release_date || '(keep)'}  ${patch.logo_url ? patch.logo_url.slice(0, 60) : '(no logo)'}`);
      if (commit) {
        const { error: uErr } = await supabase.from('pokemon_sets').update(patch).eq('id', s.id);
        if (uErr) throw uErr;
      }
    }
  }
  console.log(`\n[opmeta] sets: ${sets.length}, dates filled: ${dated}, logos filled: ${logoed}${commit ? '' : '  [DRY]'}`);
  if (misses.length) console.log(`[opmeta] unresolved:\n  ${misses.join('\n  ')}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('[opmeta] FAILED:', e.message); process.exit(1); });
