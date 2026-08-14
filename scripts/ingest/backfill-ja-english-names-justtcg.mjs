// Fill `english_name` for Japanese Pokemon cards from JustTCG, which labels JP cards
// in ENGLISH and carries their collector number — so the match is number-keyed, not
// a fuzzy name guess.
//
//   node scripts/ingest/backfill-ja-english-names-justtcg.mjs            # dry run
//   node scripts/ingest/backfill-ja-english-names-justtcg.mjs --sql      # emit SQL
//   node scripts/ingest/backfill-ja-english-names-justtcg.mjs --commit
//   node scripts/ingest/backfill-ja-english-names-justtcg.mjs --sets=M5,M4
//
// WHY IT MATTERS
// --------------
// A JA row whose `name` is katakana and whose `english_name` is null cannot be found
// by an English search, cannot be matched by the scanner's name tiers (which read
// name OR english_name), and cannot be paired to a PriceCharting "Pokemon Japanese"
// product (those carry NO collector number, so only a name can match them).
// Measured 2026-08-14: 2,374 ja Pokemon rows are in that state; 1,382 of them sit in
// sets JustTCG carries. The rest — MC (649), and the PMCG/PCG/neo/E/web vintage —
// have no JustTCG set and need a different source.
//
// THE SAFETY GATE — a wrong english_name is worse than none
// --------------------------------------------------------
// english_name feeds search, the scanner and twin-based pricing, so a mislabelled row
// mis-prices a card. Two earlier attempts at this class of problem were rejected for
// exactly that reason (pHash th->EN at 84-86%, Thai->romaji at 88-90%).
//
// This one is verifiable because we can check its work: within each set, some rows
// ALREADY have english_name. Those form a CONTROL GROUP — match them by number and
// see whether JustTCG's English name agrees with the one we already hold. If the set
// agrees below AGREEMENT_MIN, its numbering does not line up and the whole set is
// skipped rather than filled at random. A set with no control rows is also skipped:
// unverifiable is not the same as correct.

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
const API_KEY = env.JUSTTCG_API_KEY;
if (!API_KEY) { console.error('JUSTTCG_API_KEY missing from .env.local'); process.exit(1); }
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const COMMIT = process.argv.includes('--commit');
const EMIT_SQL = process.argv.includes('--sql');
const setsArg = (process.argv.find((a) => a.startsWith('--sets=')) || '').replace('--sets=', '');
const RATE_MS = 1300;                 // Professional plan heads off 429s at ~50/min
const AGREEMENT_MIN = 0.9;            // control-group agreement required to trust a set
const MIN_CONTROL = 3;                // and at least this many control rows

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// For comparing ENGLISH names: ASCII-folding is what we want here.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// For keying JAPANESE names: must be Unicode-aware. An `[^a-z0-9]` fold erases every
// kana and kanji, so every JP key collapses to the empty string — that turned a
// 5,709-name dictionary into 13 entries on the first run here, and is the same trap
// that broke JP matching in _shared/cardMatch.ts.
const normJa = (s) => String(s ?? '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '').trim();
const numKey = (s) => String(s ?? '').trim().toLowerCase().split('/')[0].replace(/^0+(?=\d)/, '');
const hasLatin = (s) => /[A-Za-z]/.test(String(s ?? ''));

async function jt(path) {
  await sleep(RATE_MS);
  const r = await fetch(`https://api.justtcg.com/v1${path}`, { headers: { 'x-api-key': API_KEY } });
  if (r.status === 429) { await sleep(5000); return jt(path); }
  if (!r.ok) throw new Error(`JustTCG ${r.status} for ${path}`);
  return r.json();
}

/**
 * JustTCG decorates JP names: "Mew - 002/028 (Mirror Holofoil)". Strip the number
 * tail and any parenthetical so what remains is the plain English card name.
 */
function cleanName(raw) {
  return String(raw ?? '')
    .replace(/\s-\s*[\w]+\/[\w]+.*$/, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
}

(async () => {
  console.log(COMMIT ? '== COMMIT run ==' : EMIT_SQL ? '== SQL emit ==' : '== DRY RUN (--commit to write, --sql for SQL) ==');

  // PAGED. PostgREST caps every response at 1000 rows regardless of any .limit(),
  // and an unpaged read here silently returned the first 1000 of 9,755 ja rows —
  // which looked like "only 10 sets have a gap" instead of the real 40+.
  const cards = [];
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('pokemon_cards').select('id, name, english_name, number, set_id')
      .eq('game', 'pokemon').eq('language', 'ja')
      .order('id', { ascending: true }).range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(`cards: ${error.message}`);
    cards.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  console.log(`ja pokemon rows: ${cards.length}`);

  const bySet = new Map();
  for (const c of cards) {
    if (!bySet.has(c.set_id)) bySet.set(c.set_id, []);
    bySet.get(c.set_id).push(c);
  }
  // Only sets that actually hold a gap are worth an API call.
  let targets = [...bySet.entries()].filter(([, list]) => list.some((c) => !c.english_name && !hasLatin(c.name)));
  if (setsArg) {
    const want = new Set(setsArg.split(',').map((s) => s.trim()));
    targets = targets.filter(([setId]) => want.has(setId));
  }
  targets.sort((a, b) => b[1].filter((c) => !c.english_name).length - a[1].filter((c) => !c.english_name).length);
  console.log(`${targets.length} ja sets hold rows with no english_name\n`);

  // Japanese name -> English name, learned from the rows that already carry both.
  // A name mapping to more than one English value is AMBIGUOUS and dropped rather
  // than resolved — that ambiguity is what makes a dictionary dangerous.
  const jpToEn = new Map();
  const jpConflict = new Set();
  for (const c of cards) {
    if (!c.english_name || hasLatin(c.name)) continue;
    const k = normJa(c.name);
    if (!k) continue;
    const prev = jpToEn.get(k);
    if (prev && norm(prev) !== norm(c.english_name)) jpConflict.add(k);
    else jpToEn.set(k, c.english_name);
  }
  for (const k of jpConflict) jpToEn.delete(k);
  console.log(`JP->EN dictionary from our own catalog: ${jpToEn.size} names (${jpConflict.size} dropped as ambiguous)\n`);

  const jtSets = (await jt('/sets?game=pokemon-japan')).data ?? [];
  const updates = [];
  let noSet = 0, skippedLowAgreement = [], skippedNoControl = [], conflicts = 0;

  for (const [setId, list] of targets) {
    const slug = jtSets.find((s) => s.id.toLowerCase().startsWith(`${setId.toLowerCase()}-`))?.id;
    if (!slug) { noSet++; continue; }

    let jcards = [], offset = 0;
    try {
      while (true) {
        const page = await jt(`/cards?game=pokemon-japan&set=${encodeURIComponent(slug)}&limit=100&offset=${offset}`);
        const d = page.data ?? [];
        jcards.push(...d);
        if (d.length < 100 || offset > 500) break;
        offset += d.length;
      }
    } catch (e) { console.warn(`  ${setId}: fetch failed (${e.message})`); continue; }

    // Index upstream by collector number, preferring an undecorated print.
    const byNum = new Map();
    for (const jc of jcards) {
      if (!jc.number || jc.number === 'N/A') continue;
      const k = numKey(jc.number);
      const decorated = /\(/.test(jc.name ?? '');
      const prev = byNum.get(k);
      if (!prev || (prev.decorated && !decorated)) byNum.set(k, { name: cleanName(jc.name), decorated });
    }

    // CONTROL GROUP. Two independent sources of "we already know the answer":
    //   1. the row's own english_name, where it has one;
    //   2. the catalog-wide Japanese->English dictionary — Pokemon names repeat
    //      across sets, so a card new to THIS set usually appeared in another.
    // (2) matters because the sets holding the gap are precisely the ones with
    // almost no english_name of their own; without it the gate can only clear sets
    // that need no filling.
    let control = 0, agree = 0;
    for (const c of list) {
      const known = c.english_name || jpToEn.get(normJa(c.name));
      if (!known) continue;
      const hit = byNum.get(numKey(c.number));
      if (!hit) continue;
      control++;
      if (norm(hit.name) === norm(known)) agree++;
    }
    const ratio = control ? agree / control : 0;
    if (control < MIN_CONTROL) { skippedNoControl.push(setId); continue; }
    if (ratio < AGREEMENT_MIN) { skippedLowAgreement.push(`${setId} (${Math.round(ratio * 100)}%)`); continue; }

    let filled = 0;
    for (const c of list) {
      if (c.english_name) continue;          // never overwrite an existing value
      if (hasLatin(c.name)) continue;        // already searchable in English
      const hit = byNum.get(numKey(c.number));
      const fromDict = jpToEn.get(normJa(c.name));
      // Per-card cross-check on top of the set-level gate. Where both sources have
      // an opinion they must agree; a set can clear 95% and still hold a wrong row.
      if (hit?.name && fromDict && norm(hit.name) !== norm(fromDict)) { conflicts++; continue; }
      // The dictionary is the card's own printed pairing from another set, so it
      // outranks a number match when both are available.
      const chosen = fromDict || hit?.name;
      if (!chosen) continue;
      updates.push({ id: c.id, english_name: chosen, jp: c.name, set: setId, number: c.number, via: fromDict ? 'dict' : 'justtcg' });
      filled++;
    }
    console.log(`  ${setId.padEnd(10)} ${slug.slice(0, 40).padEnd(41)} control ${String(agree).padStart(3)}/${String(control).padEnd(3)} ${String(Math.round(ratio * 100)).padStart(3)}%  -> fills ${filled}`);
  }

  console.log(`\nprepared ${updates.length} english_name fills (${updates.filter((u) => u.via === 'dict').length} from our own catalog pairing, ${updates.filter((u) => u.via === 'justtcg').length} from JustTCG's number match)`);
  if (conflicts) console.log(`${conflicts} skipped because the two sources disagreed on the name`);
  if (noSet) console.log(`${noSet} sets have no JustTCG set (MC and the PMCG/PCG/neo/E/web vintage) — different source needed`);
  if (skippedNoControl.length) console.log(`skipped, too few already-known rows to verify against: ${skippedNoControl.join(', ')}`);
  if (skippedLowAgreement.length) console.log(`skipped on control-group disagreement: ${skippedLowAgreement.join(', ')}`);
  console.log('\nsample:');
  for (const u of updates.slice(0, 12)) console.log(`   ${u.set.padEnd(8)} #${String(u.number).padEnd(6)} ${String(u.jp).padEnd(18)} -> ${u.english_name}`);

  if (EMIT_SQL && updates.length) {
    // Bulk VALUES chunks: one UPDATE per row produced a 2.25MB file that the SQL
    // Editor could not run (see the ja-names backfill note).
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const out = ['-- Fill english_name for Japanese Pokemon cards from JustTCG (number-keyed,',
      '-- per-set control-group verified). Safe to re-run: only fills NULLs.', ''];
    for (let i = 0; i < updates.length; i += 500) {
      const chunk = updates.slice(i, i + 500);
      out.push('UPDATE public.pokemon_cards AS c SET english_name = v.en',
        'FROM (VALUES', chunk.map((u) => `  (${q(u.id)}, ${q(u.english_name)})`).join(',\n'),
        ') AS v(id, en) WHERE c.id = v.id AND c.english_name IS NULL;', '');
    }
    const file = 'scripts/out/ja-english-names.sql';
    fs.mkdirSync('scripts/out', { recursive: true });
    fs.writeFileSync(file, out.join('\n'));
    console.log(`\nSQL written to ${file} (${Math.ceil(updates.length / 500)} chunked statements)`);
  }

  if (!COMMIT) { console.log('\nDRY RUN — nothing written.'); return; }
  for (let i = 0; i < updates.length; i += 200) {
    for (const u of updates.slice(i, i + 200)) {
      const { error: upErr } = await supabase.from('pokemon_cards')
        .update({ english_name: u.english_name }).eq('id', u.id).is('english_name', null);
      if (upErr) throw new Error(`update ${u.id}: ${upErr.message}`);
    }
    console.log(`  wrote ${Math.min(i + 200, updates.length)}/${updates.length}`);
  }
  console.log(`wrote ${updates.length} english_name values`);
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
