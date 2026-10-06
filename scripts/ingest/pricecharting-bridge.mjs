#!/usr/bin/env node
/**
 * Link catalog cards to PriceCharting by TCGplayer product id.
 *
 *   node scripts/ingest/pricecharting-bridge.mjs                 # dry run, writes a report
 *   node scripts/ingest/pricecharting-bridge.mjs --commit        # writes to the DB
 *   options: --harvest=<file> --csv-dir=<dir> --game=<pokemon|yugioh|mtg|onepiece|lorcana|riftbound>
 *
 * Why: the original ingest (pricecharting.mjs) matched by set name, and
 * PriceCharting names sets differently ("Pokemon Scarlet & Violet 151" vs our
 * "151"; all English black-star promos in one "Pokemon Promo" console). Whole
 * popular sets went unmatched. JustTCG's card records carry the TCGplayer product
 * id, and PriceCharting's CSV has the same id in its `tcg-id` column, so the id
 * links the two with no name guessing.
 *
 * Input: the JustTCG harvest (scripts/out/justtcg-tcgplayer-ids-2026-10-05.json,
 * one entry per JustTCG card: { tcg, name, number, cards: [our card ids] }),
 * collected before the JustTCG subscription ended.
 *
 * What --commit writes:
 *   - pokemon_cards.tcgplayer_id for every harvested card (via the
 *     set_card_tcgplayer_ids RPC; 20261006_pricecharting_consolidation.sql).
 *   - pricecharting_map rows for cards that had NO mapping, match_method
 *     'tcgplayer_id', last_priced_at NULL so the next cron run prices them first.
 *     Existing mappings are never changed; disagreements go to the report.
 *
 * Guards, because PriceCharting's tcg-id column has errors (np-38 Groudon ex
 * points at "Manectric [Prerelease] #38"):
 *   - the console must be the card's game and language (Japanese consoles for
 *     'ja' cards, never Japanese/Chinese/Korean consoles for 'en' cards);
 *   - when both sides carry a collector number they must agree; when the
 *     PriceCharting name has no number, the names must agree instead;
 *   - a set where more than 30% of tried cards fail those checks is skipped whole
 *     (the vintage mis-pairing hazard: a set whose numbering differs from ours);
 *   - one tcg-id is often shared by several PriceCharting products (reverse holo,
 *     1st Edition, foil, staff). The base product (no [...] in the name) wins
 *     unless a variant matches the number better.
 *
 * PriceCharting answered a Cloudflare challenge after ~5 back-to-back CSV
 * downloads, so downloads are spaced 60s apart and cached for 24h in
 * scripts/out/pricecharting-csv/.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const COMMIT = !!args.commit;
const HARVEST = args.harvest || 'scripts/out/justtcg-tcgplayer-ids-2026-10-05.json';
const CSV_DIR = args['csv-dir'] || 'scripts/out/pricecharting-csv';
const ONLY_GAME = args.game || null;

// Same convention as the other scripts, plus quote stripping (CLAUDE.md).
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const TOKEN = env.PRICECHARTING_TOKEN;

// Our game -> PriceCharting category + console-name prefix. Mirrors PC_CATEGORY
// in lib/pricecharting.ts (an .mjs can't import the TS module).
const GAMES = {
  pokemon: { category: 'pokemon-cards', console: /^Pokemon /i },
  yugioh: { category: 'yugioh-cards', console: /^YuGiOh /i },
  mtg: { category: 'magic-cards', console: /^Magic /i },
  onepiece: { category: 'one-piece-cards', console: /^One Piece /i },
  lorcana: { category: 'lorcana-cards', console: /^Lorcana /i },
  riftbound: { category: 'other-tcg-cards', console: /^Riftbound /i },
};
const ASIAN_CONSOLE = /\b(Japanese|Chinese|Korean)\b/i;
const SET_FAIL_RATIO = 0.3;
const SET_MIN_TRIED = 10;

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastDownload = 0;
async function loadCsv(category) {
  fs.mkdirSync(CSV_DIR, { recursive: true });
  const file = path.join(CSV_DIR, `${category}.csv`);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 24 * 3_600_000) {
    return fs.readFileSync(file, 'utf8');
  }
  const wait = lastDownload + 60_000 - Date.now();
  if (wait > 0) { console.log(`  waiting ${Math.round(wait / 1000)}s before the next download`); await sleep(wait); }
  console.log(`  downloading ${category}`);
  const res = await fetch(`https://www.pricecharting.com/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=${category}`);
  lastDownload = Date.now();
  const text = await res.text();
  if (!res.ok || text.startsWith('<')) throw new Error(`${category}: HTTP ${res.status} (${text.slice(0, 60)})`);
  if (/^[^\n]*\n[^,]*,3DO\b/.test(text)) throw new Error(`${category}: got the all-products fallback`);
  fs.writeFileSync(file, text);
  return text;
}

/**
 * For one category: tcg-id -> products, and "console|number" -> products (to find
 * the plain sibling of a variant). Product: { id, console, name, loose, volume }.
 */
function indexCsv(text) {
  const lines = text.split('\n');
  const head = parseCsvLine(lines[0]);
  const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const byTcg = new Map();
  const byConsoleNum = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = parseCsvLine(lines[i]);
    const p = {
      id: f[col.id],
      console: f[col['console-name']] || '',
      name: f[col['product-name']] || '',
      loose: f[col['loose-price']] || '',
      volume: parseInt(f[col['sales-volume']] || '0', 10) || 0,
    };
    const n = pcNum(p.name);
    if (n) { const k = `${p.console}|${n}`; (byConsoleNum.get(k) ?? byConsoleNum.set(k, []).get(k)).push(p); }
    const tcg = (f[col['tcg-id']] || '').trim();
    if (tcg) (byTcg.get(tcg) ?? byTcg.set(tcg, []).get(tcg)).push(p);
  }
  return { byTcg, byConsoleNum };
}

// Variants priced differently from the plain card. Taking one of these for a plain
// card is the 1st-Edition-over-Unlimited mispricing (fixed in the JustTCG crons in
// 3282255f), so a plain sibling with the same number wins whenever one exists.
const PRICED_VARIANT = /\[(1st edition|reverse holo|foil|extended art|showcase|borderless|staff|prerelease[^\]]*|[^\]]*stamp[^\]]*|shadowless|jumbo|etched[^\]]*|serial[^\]]*)\]/i;

/** "076a/298" -> "76a", "OP02-036" -> "36", "SWSH001" -> "1", "M21" -> "21". */
function normNum(s) {
  if (!s) return null;
  let t = String(s).trim().toLowerCase().split('/')[0];
  if (t.includes('-')) t = t.slice(t.lastIndexOf('-') + 1);
  const m = t.match(/(\d+)([a-z]?)$/);
  return m ? `${parseInt(m[1], 10)}${m[2]}` : null;
}
/** Collector number printed in a PriceCharting product name, if any. */
function pcNum(name) {
  const hash = name.match(/#\s*([A-Za-z]*\d+[a-z]?)\b/);
  if (hash) return normNum(hash[1]);
  const code = name.match(/\b[A-Z0-9]{2,6}-[A-Z]{0,4}\d{1,4}[a-z]?\s*$/);
  return code ? normNum(code[0]) : null;
}
function nameTokens(s) {
  return new Set(String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\[[^\]]*\]|#\S+/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 1));
}
function namesAgree(a, b) {
  const A = nameTokens(a); const B = nameTokens(b);
  if (!A.size || !B.size) return false;
  let both = 0; for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size) >= 0.6;
}

async function fetchAll(table, cols, apply) {
  const out = []; let last = null; const key = cols.split(',')[0].trim();
  for (;;) {
    let q = supabase.from(table).select(cols).order(key).limit(1000);
    if (apply) q = apply(q);
    if (last !== null) q = q.gt(key, last);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
    last = data[data.length - 1][key];
  }
  return out;
}

async function main() {
  console.log(`pricecharting-bridge ${COMMIT ? 'COMMIT' : 'dry run'}${ONLY_GAME ? ` (game=${ONLY_GAME})` : ''}`);
  const harvest = JSON.parse(fs.readFileSync(HARVEST, 'utf8'));
  const tcgByCard = new Map();
  for (const h of Object.values(harvest)) if (h.tcg) for (const c of h.cards || []) tcgByCard.set(c, String(h.tcg));
  console.log(`harvest: ${tcgByCard.size} cards with a TCGplayer id`);

  const games = Object.keys(GAMES).filter((g) => !ONLY_GAME || g === ONLY_GAME);
  const cards = await fetchAll('pokemon_cards', 'id, game, language, set_id, number, name, english_name', (q) => q.in('game', games));
  const mapped = new Map((await fetchAll('pricecharting_map', 'card_id, pricecharting_id')).map((m) => [m.card_id, String(m.pricecharting_id)]));
  console.log(`catalog: ${cards.length} cards, ${mapped.size} already mapped`);

  const index = {};
  for (const g of games) index[g] = indexCsv(await loadCsv(GAMES[g].category));

  const tcgUpdates = [];
  const proposals = []; // { card, pc, set }
  const stats = {};
  const setTally = new Map(); // set -> { tried, failed }
  const samples = { disagree: [], rejected: [] };

  for (const c of cards) {
    const tcg = tcgByCard.get(c.id);
    if (!tcg) continue;
    tcgUpdates.push({ id: c.id, tcgplayer_id: tcg });
    const k = `${c.game}/${c.language}`;
    const s = stats[k] ??= { withTcg: 0, alreadyMapped: 0, agree: 0, disagree: 0, proposed: 0, plainSibling: 0, noCandidate: 0, rejected: 0, setSkipped: 0 };
    s.withTcg++;

    const spec = GAMES[c.game];
    const all = index[c.game]?.byTcg.get(tcg) || [];
    const candidates = all.filter((p) => spec.console.test(p.console)
      && (c.language === 'ja' ? /\bJapanese\b/i.test(p.console) : !ASIAN_CONSOLE.test(p.console)));

    const ourNum = normNum(c.number);
    const ourName = c.english_name || c.name;
    const scored = candidates.map((p) => {
      const n = pcNum(p.name);
      const numberOk = n && ourNum ? n === ourNum : null;
      const nameOk = namesAgree(ourName, p.name);
      const score = (numberOk ? 8 : 0) + (nameOk ? 4 : 0) + (p.name.includes('[') ? 0 : 2) + Math.min(1, p.volume / 1000);
      return { p, numberOk, nameOk, score };
    }).sort((a, b) => b.score - a.score);
    let best = scored[0];
    // A priced variant (1st Edition, reverse holo, foil...) when our card names no
    // variant: switch to the plain product with the same number in the same console.
    if (best && PRICED_VARIANT.test(best.p.name) && !/[[(]/.test(ourName)) {
      const n = pcNum(best.p.name);
      const plain = n ? (index[c.game].byConsoleNum.get(`${best.p.console}|${n}`) || [])
        .filter((p) => !p.name.includes('[') && namesAgree(p.name, best.p.name))
        .sort((a, b) => b.volume - a.volume)[0] : null;
      if (plain) { best = { p: plain, numberOk: ourNum ? n === ourNum : null, nameOk: namesAgree(ourName, plain.name) }; s.plainSibling++; }
    }

    const existing = mapped.get(c.id);
    if (existing) {
      s.alreadyMapped++;
      if (best) {
        if (best.p.id === existing) s.agree++;
        else { s.disagree++; if (samples.disagree.length < 200) samples.disagree.push({ card: c.id, name: ourName, existing, bridge: `${best.p.id} ${best.p.console} / ${best.p.name}` }); }
      }
      continue;
    }
    if (!best) { s.noCandidate++; continue; }

    const tally = setTally.get(c.set_id) ?? setTally.set(c.set_id, { tried: 0, failed: 0 }).get(c.set_id);
    tally.tried++;
    // Number must agree when both sides have one; otherwise the names must.
    const ok = best.numberOk === true || (best.numberOk === null && best.nameOk);
    if (!ok) {
      tally.failed++; s.rejected++;
      if (samples.rejected.length < 300) samples.rejected.push({ card: c.id, number: c.number, name: ourName, pc: `${best.p.console} / ${best.p.name}` });
      continue;
    }
    proposals.push({ c, p: best.p });
  }

  const skippedSets = new Set([...setTally.entries()]
    .filter(([, t]) => t.tried >= SET_MIN_TRIED && t.failed / t.tried > SET_FAIL_RATIO)
    .map(([set]) => set));
  const mapRows = [];
  for (const { c, p } of proposals) {
    const s = stats[`${c.game}/${c.language}`];
    if (skippedSets.has(c.set_id)) { s.setSkipped++; continue; }
    s.proposed++;
    mapRows.push({ card_id: c.id, pricecharting_id: p.id, game: c.game, console_name: p.console, match_method: 'tcgplayer_id', last_priced_at: null });
  }

  console.table(stats);
  console.log(`sets skipped by the ${SET_FAIL_RATIO * 100}% mismatch gate: ${[...skippedSets].join(', ') || 'none'}`);
  console.log(`tcgplayer_id updates: ${tcgUpdates.length}; new map rows: ${mapRows.length}`);

  fs.mkdirSync('scripts/out', { recursive: true });
  const reportFile = `scripts/out/pricecharting-bridge-report-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(reportFile, JSON.stringify({ commit: COMMIT, stats, skippedSets: [...skippedSets], samples, newMapRows: mapRows.slice(0, 500) }, null, 2));
  console.log(`report: ${reportFile}`);

  if (!COMMIT) { console.log('dry run: nothing written. Re-run with --commit.'); return; }

  let updated = 0;
  for (let i = 0; i < tcgUpdates.length; i += 1000) {
    const { data, error } = await supabase.rpc('set_card_tcgplayer_ids', { p_rows: tcgUpdates.slice(i, i + 1000) });
    if (error) throw new Error(`set_card_tcgplayer_ids: ${error.message} (is 20261006_pricecharting_consolidation.sql applied?)`);
    updated += data || 0;
  }
  console.log(`pokemon_cards.tcgplayer_id written: ${updated}`);

  let inserted = 0;
  for (let i = 0; i < mapRows.length; i += 500) {
    // ignoreDuplicates: never overwrite a mapping that already exists.
    const { error } = await supabase.from('pricecharting_map')
      .upsert(mapRows.slice(i, i + 500), { onConflict: 'card_id', ignoreDuplicates: true });
    if (error) throw new Error(`pricecharting_map: ${error.message}`);
    inserted += Math.min(500, mapRows.length - i);
  }
  console.log(`pricecharting_map rows sent: ${inserted}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
