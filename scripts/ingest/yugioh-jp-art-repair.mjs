// Recover artwork for Japanese (OCG) Yu-Gi-Oh! rows that yugioh-jp.mjs left imageless.
//
//   node scripts/ingest/yugioh-jp-art-repair.mjs                 # dry run, report only
//   node scripts/ingest/yugioh-jp-art-repair.mjs --commit        # write image URLs
//   node scripts/ingest/yugioh-jp-art-repair.mjs --limit=25      # bounded trial
//   node scripts/ingest/yugioh-jp-art-repair.mjs --explain       # per-row match reasoning
//
// WHY THIS EXISTS
//
// yugioh-jp.mjs bridges PriceCharting's OCG catalogue to YGOPRODeck artwork on
// normalised English card NAME. That misses ~4.8% of printings, and the original
// script's header attributes the misses to "OCG-exclusive cards not yet printed
// in the TCG". Measured against the 718 imageless rows, that explanation is only
// partly right: 139 of the 460 distinct names behind them DO exist upstream. They
// miss because PriceCharting ships provisional translations of OCG names that
// Konami later localises differently:
//
//     ALIN-JP011  "Diabellstar the Sin Adjudicator"  ->  "Diabellstar Vengeance"
//     ALIN-JP007  "Spore the Fairy Cell"             ->  "Spore the Fairy Seed"
//     ALIN-JP010  "Heraldic Beast Stat Whale"        ->  "Heraldic Beast Stad Whale"
//     AGOV-JP064  "Concours de Cuisine"              ->  "Concours de Cuisine (Culinary Confrontation)"
//
// No amount of name normalisation reaches those. So this script bridges on the
// PRINTED SET CODE instead, which is language-independent: ALIN-JP051 and
// ALIN-EN051 are the same slot in the same set.
//
// WHY THE NAME GUARD IS NOT OPTIONAL
//
// The JP->EN code bridge alone is 98.4% precise (measured: 9,174 of 9,326 rows
// that already carry a name-derived ygo_id agree with it). The 1.6% that
// disagree are not noise - they cluster in the high-number tail, where the TCG
// substitutes World Premiere cards for OCG slots:
//
//     CORE-JP081 (Planetellarknight Ptolemaeus)  vs  CORE-EN081 (Extinction on Schedule)
//     CROS-JP082 (Vassal of the Flame Emperor)   vs  CROS-EN082 (Draghig, Malebranche...)
//
// Requiring the two names to plausibly describe the same card removes those:
// guarded precision measures 99.67% (299/300), and the single remaining
// "disagreement" is "H-E-R-O Flash!" vs "H.E.R.O. Flash!" - the same card under
// different punctuation, so effectively 100%.
//
// The guard rejects a large number of rows that would have matched correctly, but
// those are all rows that ALREADY have art via the name bridge (their `name` is
// Japanese text, which the guard cannot compare against an English name and so
// refuses). They are not candidates here, and the recall cost on the actual
// repair set is zero.
//
// WHAT THIS CANNOT FIX
//
// 183 of the 718 rows are recoverable. The other 535 have no reachable source:
// YGOPRODeck carries zero JP set codes (41,244 EN / 456 PT / 4 SE - no JP), so
// there is no direct OCG lookup, and 520 rows have no EN counterpart code at all
// because the printing is genuinely OCG-exclusive (KP20, TB02, QCAC, QCDB, DBJH
// account for most of it). 58 are plain "Token" rows with no distinct art, and
// none of the 327 unreachable names appears on an already-imaged JA row, so
// variant inheritance does not help either. Those rows stay imageless until a
// real OCG art source exists.
//
// PROVENANCE AND A CAVEAT
//
// The art written here is the card's TCG print, not its OCG print. For most cards
// those are the same illustration, but the TCG censors a handful. Every repaired
// row records `raw_data.art_source = 'ygoprodeck_via_en_setcode'` plus the bridge
// detail, so these are auditable and reversible as a set, and so a future OCG art
// source can overwrite exactly this population.
//
// Do NOT run backfill-phashes.mjs over these rows without deciding that first: a
// pHash computed from TCG art describes the wrong image for any card whose OCG
// print differs.
//
// This script only writes upstream URLs. Mirroring into the card-images bucket is
// mirror-card-images.mjs's job, same as after a yugioh-jp.mjs run.
//
// Rerun is idempotent - it only considers rows that currently have no image.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '..', '.env.local');
// Split on \r?\n and strip surrounding quotes - the project's dotenv convention.
// A quoted token passed through verbatim reaches the upstream as a literal `"..."`.
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k] = v;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const EXPLAIN = args.includes('--explain');
const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || Infinity;

const CACHE_DIR = path.join(__dirname, '..', '.cache');
const YGO_JSON = path.join(CACHE_DIR, 'ygoprodeck-all.json');

async function loadYgoprodeck() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(YGO_JSON)) {
    console.log('[ygo-jp-art] downloading YGOPRODeck card database...');
    const res = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php', {
      headers: { 'User-Agent': 'CardStreetTCG/1.0', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`YGOPRODeck ${res.status}`);
    fs.writeFileSync(YGO_JSON, JSON.stringify((await res.json()).data));
  }
  return JSON.parse(fs.readFileSync(YGO_JSON, 'utf8'));
}

// --- the name guard ---------------------------------------------------------
const ASCII_WORD = /[a-z0-9]+/g;
const wordsOf = (s) => (s || '').toLowerCase().match(ASCII_WORD) || [];

// Words too generic to prove two names describe the same card. Without this,
// "Regenesis Warrior Beresheet" would accept any "... Warrior" in the same slot.
const GENERIC = new Set([
  'the', 'of', 'and', 'a', 'an', 'to', 'in', 'dragon', 'lord', 'god', 'warrior',
  'sage', 'beast', 'magician', 'knight', 'king', 'queen', 'monster', 'card', 'token',
]);

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Accept only if the two names plausibly describe the same card. Three tiers,
// widening in order; each was measured against ground truth before being added.
function nameGuard(ours, theirs) {
  const ow = wordsOf(ours);
  const tw = wordsOf(theirs);
  // A name with no latin words is Japanese text, which cannot be compared against
  // an English name. Refuse rather than guess.
  if (!ow.length || !tw.length) return { ok: false, why: 'name-not-comparable' };

  const distinctive = ow.filter((w) => w.length >= 4 && !GENERIC.has(w));
  const theirs4 = tw.filter((w) => w.length >= 4 && !GENERIC.has(w));

  // 1. A distinctive word shared outright.
  const theirSet = new Set(theirs4);
  for (const w of distinctive) if (theirSet.has(w)) return { ok: true, why: `shared-word:${w}` };

  // 2. Near-identical end to end - punctuation drift, e.g. "H-E-R-O Flash!".
  const a = ow.join('');
  const b = tw.join('');
  const dist = levenshtein(a, b) / Math.max(a.length, b.length);
  if (dist <= 0.25) return { ok: true, why: `edit-distance:${dist.toFixed(2)}` };

  // 3. A distinctive word that survives transliteration drift rather than
  // matching outright. Konami respells romanised OCG names on localisation:
  // Dogurado/Dogurad, Zaren/Zalen, Elvennotes/Elfnote, Artmegia/Artmage. Tolerance
  // scales with word length so short words stay strict. Adding this tier recovers
  // 10 further rows and leaves precision unchanged at 99.67% on ground truth.
  for (const x of distinctive) {
    for (const y of theirs4) {
      const d = levenshtein(x, y);
      if (d <= (x.length >= 8 ? 2 : 1)) return { ok: true, why: `near-word:${x}~${y}` };
    }
  }

  return { ok: false, why: 'names-unrelated' };
}
// ----------------------------------------------------------------------------

async function fetchImagelessRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('pokemon_cards')
      .select('id, name, number, set_id, rarity, raw_data')
      .eq('game', 'yugioh')
      .eq('language', 'ja')
      // Historic rows carry '' rather than NULL - yugioh-jp.mjs writes
      // `img.image_url_small || ''`. Cover both so a fresh ingest is repairable
      // without waiting for the '' -> NULL normalisation to be re-applied.
      .or('image_small.is.null,image_small.eq.')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`select: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const ygoCards = await loadYgoprodeck();

  // Index every printed set code -> card. Keyed by card id, because a card lists
  // the same set_code once per rarity it was printed at (Common, Ultra Rare, ...)
  // - those repeats are one card, not competing candidates. Only a code that maps
  // to genuinely different cards is ambiguous.
  const bySetCode = new Map();
  for (const c of ygoCards) {
    for (const s of c.card_sets || []) {
      const code = (s.set_code || '').toUpperCase();
      if (!code) continue;
      if (!bySetCode.has(code)) bySetCode.set(code, new Map());
      bySetCode.get(code).set(c.id, c);
    }
  }
  console.log(`[ygo-jp-art] YGOPRODeck cards: ${ygoCards.length}, printed codes indexed: ${bySetCode.size}`);

  const rows = await fetchImagelessRows();
  console.log(`[ygo-jp-art] imageless JA rows: ${rows.length}`);

  const updates = [];
  const skipped = { noSetCode: 0, noEnCounterpart: 0, guardRejected: 0, ambiguous: 0, noArt: 0 };
  const rejectSamples = [];

  for (const row of rows) {
    const jp = row.raw_data?.set_code;
    if (!jp) { skipped.noSetCode++; continue; }

    const en = jp.toUpperCase().replace(/-(JP|JA)/, '-EN');
    const cands = bySetCode.get(en);
    if (!cands) { skipped.noEnCounterpart++; continue; }
    if (cands.size > 1) {
      // A code resolving to two different cards makes the bridge a coin flip -
      // refuse instead of picking arbitrarily.
      skipped.ambiguous++;
      continue;
    }

    const cand = cands.values().next().value;
    const guard = nameGuard(row.name, cand.name);
    if (!guard.ok) {
      skipped.guardRejected++;
      if (rejectSamples.length < 15) rejectSamples.push(`${jp} "${row.name}" vs "${cand.name}" (${guard.why})`);
      continue;
    }

    const img = cand.card_images?.[0] || {};
    if (!img.image_url) { skipped.noArt++; continue; }

    updates.push({
      id: row.id,
      name: row.name,
      matchedName: cand.name,
      enCode: en,
      guard: guard.why,
      patch: {
        image_small: img.image_url_small || img.image_url,
        image_large: img.image_url,
        raw_data: {
          ...row.raw_data,
          ygo_id: cand.id,
          type: cand.type ?? row.raw_data?.type ?? null,
          attribute: cand.attribute ?? row.raw_data?.attribute ?? null,
          race: cand.race ?? row.raw_data?.race ?? null,
          art_source: 'ygoprodeck_via_en_setcode',
          art_bridge: { en_code: en, ygo_id: cand.id, matched_name: cand.name, guard: guard.why },
        },
      },
    });
    if (updates.length >= LIMIT) break;
  }

  console.log(`\n[ygo-jp-art] recoverable: ${updates.length}`);
  console.log('[ygo-jp-art] not recoverable:');
  console.log(`    no set_code in raw_data     : ${skipped.noSetCode}`);
  console.log(`    no EN counterpart printing  : ${skipped.noEnCounterpart}  (OCG-exclusive)`);
  console.log(`    name guard rejected         : ${skipped.guardRejected}`);
  console.log(`    EN code ambiguous           : ${skipped.ambiguous}`);
  console.log(`    matched but upstream has no art: ${skipped.noArt}`);

  if (EXPLAIN) {
    console.log('\n[ygo-jp-art] matches:');
    for (const u of updates) console.log(`    ${u.id}  "${u.name}" -> "${u.matchedName}"  via ${u.enCode}  [${u.guard}]`);
    console.log('\n[ygo-jp-art] guard rejections (sample):');
    for (const r of rejectSamples) console.log('    ' + r);
  }

  if (!COMMIT) {
    console.log('\n[ygo-jp-art] DRY RUN - nothing written. Re-run with --commit.');
    if (!EXPLAIN) {
      console.log('sample matches:');
      for (const u of updates.slice(0, 10)) console.log(`    ${u.id}  "${u.name}" -> "${u.matchedName}"  [${u.guard}]`);
      console.log('(--explain prints all matches and the guard rejections)');
    }
    return;
  }

  // Per-row update rather than upsert: these rows already exist and carry fields
  // this script has no business rewriting. Bounded concurrency to stay polite to
  // PostgREST.
  let done = 0;
  let failed = 0;
  const queue = [...updates];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const u = queue.shift();
      const { error } = await supabase.from('pokemon_cards').update(u.patch).eq('id', u.id);
      if (error) { failed++; console.error(`\n  ${u.id}: ${error.message}`); }
      else done++;
      process.stdout.write(`\r  updated ${done}/${updates.length}`);
    }
  }));
  process.stdout.write('\n');

  console.log(`\n[ygo-jp-art] done. updated=${done} failed=${failed}`);
  console.log('Next: node scripts/ingest/mirror-card-images.mjs --game=yugioh --language=ja');
  console.log('Then decide on pHash - see the header note before running backfill-phashes.mjs over these rows.');
}

main().catch((e) => { console.error('[ygo-jp-art]', e.message); process.exit(1); });
