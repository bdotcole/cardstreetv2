// Raw (ungraded) prices for the cards JustTCG cannot reach, from PriceCharting's
// bulk price-guide CSV. Yu-Gi-Oh by default; Magic and Lorcana via --game (the file
// keeps its original name because Yu-Gi-Oh is the bulk of the work and the gap it
// was written for).
//
//   node scripts/ingest/pricecharting-raw-yugioh.mjs                    # dry run, yugioh
//   node scripts/ingest/pricecharting-raw-yugioh.mjs --commit
//   node scripts/ingest/pricecharting-raw-yugioh.mjs --sets=ygo-lob,ygo-mp25
//   node scripts/ingest/pricecharting-raw-yugioh.mjs --all              # not just unpriced sets
//   node scripts/ingest/pricecharting-raw-yugioh.mjs --game=mtg --all --only-missing
//
// --only-missing writes ONLY for cards that have no Raw_NM row yet. Use it whenever
// the target sets are already partly priced, or the upsert will put PriceCharting's
// weekly snapshot over fresher nightly JustTCG data.
//
// WHY
// ---
// `batch-price-games` resolves a JustTCG set by exact normalized NAME. 340 of our
// 636 Yu-Gi-Oh sets match no JustTCG set at all, so they were never priceable there
// (measured 2026-08-13; see the set-starvation note). Their cards fell back to the
// legacy, unmaintained 'Near Mint' tier. PriceCharting carries 59 of those sets —
// 4,254 cards, including Legend of Blue Eyes, the Mega Packs and the Legendary
// Collections. The remaining 281 (collab cards, "(POR)" Portuguese OTS packs, prize
// cards) exist on neither vendor and stay unpriced.
//
// Sibling of scripts/ingest/pricecharting-raw-exera.mjs, which did the same for the
// EX-era Pokemon gap. Like that script it reads `loose-price` (ungraded) and writes
// condition 'Raw_NM' — the row pickDisplayMarketValue actually shows — which is
// deliberately different from scripts/ingest/pricecharting.mjs (GRADED columns only).
//
// Costs exactly ONE HTTP request (the bulk CSV) no matter how many cards, so it
// sidesteps the ~1 req/s token bucket that throttles the per-product API.
//
// YU-GI-OH NUMBERING TRAPS (these differ from the Pokemon script)
// --------------------------------------------------------------
// PriceCharting names Yu-Gi-Oh cards with a TRAILING set code, not a "#123":
//     "Aqua Madoor LOB-027"                 <- North American print, our numbering
//     "Aqua Madoor LOB-E021"                <- EUROPEAN print of the SAME card
//     "Aqua Madoor [1st Edition] LOB-027"   <- variant of the NA print
// The European code carries a different number for the same card, so parsing digits
// out of "LOB-E021" would file Aqua Madoor under our #021 — a different card. Only
// codes whose number part is PURELY numeric are accepted; anything with a letter
// prefix on the number (E021, EN001, JP016) is skipped. Bracketed variants
// ([1st Edition], [Limited Edition]) lose to the base print at the same number.

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
const TOKEN = (env.PRICECHARTING_TOKEN || '').trim();
if (!TOKEN) { console.error('PRICECHARTING_TOKEN missing from .env.local'); process.exit(1); }
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BASE = 'https://www.pricecharting.com';
const COMMIT = process.argv.includes('--commit');
const ALL_SETS = process.argv.includes('--all');
// Write only for cards that currently have NO Raw_NM row. Without this a run over a
// set the nightly JustTCG cron already covers would upsert PriceCharting's weekly
// snapshot over fresher data — use it whenever the target sets are partly priced.
const ONLY_MISSING = process.argv.includes('--only-missing');
// Run the promo pass (see the bottom of the file). Off by default: it matches on
// NAME rather than number, so it is a deliberately separate, narrower path.
const PROMOS = process.argv.includes('--promos');
const setsArg = (process.argv.find((a) => a.startsWith('--sets=')) || '').replace('--sets=', '');
const CSV_CACHE = (process.argv.find((a) => a.startsWith('--csv=')) || '').replace('--csv=', '');
const GAME = (process.argv.find((a) => a.startsWith('--game=')) || '--game=yugioh').replace('--game=', '');

// Per-game CSV category + how PriceCharting writes the collector number in a product
// name. Yu-Gi-Oh uses a trailing set code ("Aqua Madoor LOB-027"); Magic and Lorcana
// use "#123" (the same split lib/pricecharting.ts documents for the graded ingest).
const GAME_CONFIG = {
  yugioh: { category: 'yugioh-cards', consolePrefix: /^yugioh\s*/i, consoleWord: 'yugioh', style: 'setcode' },
  mtg: { category: 'magic-cards', consolePrefix: /^magic\s*/i, consoleWord: 'magic', style: 'hash' },
  // One Piece codes carry the card's ORIGINAL set ("Ain OP07-002"), and a booster
  // reprints SP/alt-art cards from older sets, so one set holds several cards at the
  // same number — our op-op-16-jp-op10-045 (Cavendish, from OP10) sits beside
  // op-op-16-jp-op16-045 (Crocodile). Our card ids embed that origin code too, so
  // matching on code+number instead of number alone separates them exactly.
  onepiece: { category: 'one-piece-cards', consolePrefix: /^one piece\s*/i, consoleWord: 'one piece', style: 'setcode', matchByOriginCode: true },
  'onepiece-jp': {
    category: 'one-piece-cards', consolePrefix: /^one piece japanese\s*/i, consoleWord: 'one piece japanese',
    style: 'setcode', matchByOriginCode: true, game: 'onepiece', cardLang: 'ja', storeLang: 'jp',
    // Japanese consoles must be matched ONLY against Japanese consoles, or the
    // English print of the same set silently supplies the price.
    consoleFilter: /^one piece japanese /i,
  },
  // English Pokemon. Japanese Pokemon is deliberately ABSENT: PriceCharting's
  // "Pokemon Japanese <set>" products carry NO collector number at all ("Alto Mare's
  // Latias [Holo]"), so they can only be matched by name — and 1,427 of our 1,485
  // unpriced JA cards have english_name = null, while our JA set names are Japanese
  // and do not match the English console names. Measured 2026-08-14: exactly 6 of
  // the 1,485 are reachable. Fix english_name upstream before revisiting this.
  pokemon: { category: 'pokemon-cards', consolePrefix: /^pokemon\s*/i, consoleWord: 'pokemon', style: 'hash' },
  // Lorcana promos live in their own console with their own 1..N numbering, which
  // collides with every set's base numbering — see the --promos pass at the end.
  lorcana: { category: 'lorcana-cards', consolePrefix: /^(disney\s*)?lorcana\s*/i, consoleWord: 'lorcana', style: 'hash', promoConsole: 'Lorcana Promo', promoRarities: ['Special', 'Promo'] },
};
const CFG = GAME_CONFIG[GAME];
// A --game key may address a language variant of a game (onepiece-jp), so the DB
// game id, our card language and the market_values language are all configurable.
// market_values stores Japanese under 'jp' while pokemon_cards uses 'ja'.
const DB_GAME = CFG?.game ?? GAME;
const CARD_LANG = CFG?.cardLang ?? 'en';
const STORE_LANG = CFG?.storeLang ?? 'en';
if (!CFG) { console.error(`--game must be one of ${Object.keys(GAME_CONFIG).join(', ')}`); process.exit(1); }
// A set whose numbering disagrees with PriceCharting's is skipped wholesale rather
// than paired at random — the documented vintage mis-pairing hazard.
const NAME_AGREEMENT_MIN = 0.9;

// Diacritics must go before comparing: our catalog and PriceCharting disagree on
// accents, and without NFD the agreement gate false-negatives on every accented card.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripNum = (s) => String(s ?? '').replace(/^0+(?=\d)/, '').trim();
const usd = (s) => {
  const n = parseFloat(String(s ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
}

async function loadProducts() {
  if (CSV_CACHE && fs.existsSync(CSV_CACHE)) {
    console.log(`reading cached CSV ${CSV_CACHE}`);
    return parseCsv(fs.readFileSync(CSV_CACHE, 'utf8'));
  }
  const res = await fetch(`${BASE}/price-guide/download-custom?t=${encodeURIComponent(TOKEN)}&category=${CFG.category}`);
  if (!res.ok) throw new Error(`CSV download ${res.status}`);
  const text = await res.text();
  if (CSV_CACHE) fs.writeFileSync(CSV_CACHE, text);
  const products = parseCsv(text);
  // An invalid category silently returns the 121k all-products video-game catalog
  // (first console "3DO"). Abort rather than ingest garbage.
  if (products[0]?.['console-name'] === '3DO') throw new Error(`got the all-products fallback, not ${CFG.category}`);
  return products;
}

// Region prefixes seen in the codes, by frequency across the 77k-row CSV:
//   EN 47,625 · JP 14,713 · (none) 5,572 · E 1,232 · ENA 521 · ENB 455 · ENC 394 · ...
// Three of them line up with our catalog, and our own card IDS say which is which:
//   ygo-lob-027    -> bare  "LOB-027"    North American
//   ygo-lob-en027  -> EN    "LOB-EN027"  English
//   ygo-lob-e021   -> E     "LOB-E021"   European
// 20 vintage Yu-Gi-Oh sets carry two or three of these schemes side by side (lob,
// lon, mrd, mrl, dcr, lod, ...). They are NOT duplicate rows: they are separate
// printings that trade at different prices — Aqua Madoor is $0.96 as LOB-027 and
// $2.35 as LOB-E021 — so each row is matched to its OWN region.
// "JP" is a different catalog and ENA/ENB/... are sub-series whose letters our
// `number` column does not carry; both are skipped rather than guessed across.
const ACCEPTED_PREFIXES = new Set(['', 'EN', 'E']);

/** "Aqua Madoor [1st Edition] LOB-027" -> { num:'27', prefix:'', isVariant:true }. */
function parseProduct(name) {
  if (CFG.style === 'hash') {
    // Magic / Lorcana: "Sire of Seven Deaths #1" — no region concept, so prefix ''.
    const m = String(name).match(/#\s*([A-Za-z]{0,4}\d{1,4})\b/);
    if (!m) return null;
    return { num: stripNum(m[1]), prefix: '', isVariant: /\[|\(/.test(name) };
  }
  const m = String(name).match(/\b([A-Z0-9]{2,6})-([A-Za-z]*)(\d{1,4})\s*$/);
  if (!m) return null;
  const prefix = (m[2] || '').toUpperCase();
  if (!ACCEPTED_PREFIXES.has(prefix)) return null;
  return { code: (m[1] || '').toLowerCase(), num: stripNum(m[3]), prefix, isVariant: /\[|\(/.test(name) };
}
/** Strip the trailing code / "#123" so only the card name is compared. */
function nameOfProduct(name) {
  const stripped = CFG.style === 'hash'
    ? String(name).replace(/#.*$/, '')
    : String(name).replace(/\b[A-Z0-9]{2,6}-[A-Za-z]*\d{1,4}\s*$/, '');
  return norm(stripped.replace(/\[[^\]]*\]/g, ''));
}

/** Region implied by our own card id: ygo-lob-en027 -> 'EN', -e021 -> 'E', -027 -> ''. */
function regionOfCardId(id, setId) {
  const tail = String(id).startsWith(`${setId}-`) ? String(id).slice(setId.length + 1) : String(id);
  if (/^en\d/i.test(tail)) return 'EN';
  if (/^e\d/i.test(tail)) return 'E';
  if (/^\d/.test(tail)) return '';
  return null; // unknown shape — fall back to the set-wide preference
}

(async () => {
  console.log(COMMIT ? '== COMMIT run ==' : '== DRY RUN (pass --commit to write) ==');
  const products = await loadProducts();
  console.log(`CSV rows: ${products.length}`);

  const byConsole = new Map();
  for (const p of products) {
    const c = p['console-name']; if (!c) continue;
    if (!byConsole.has(c)) byConsole.set(c, []);
    byConsole.get(c).push(p);
  }
  const consoleByNorm = new Map();
  for (const c of byConsole.keys()) {
    // A language variant must see ONLY its own consoles. Japanese sets live in the
    // same CSV as English ones ("One Piece Japanese 500 Years in the Future" beside
    // "One Piece 500 Years in the Future"), and without this filter the English
    // print silently supplies the price for every Japanese card.
    if (CFG.consoleFilter && !CFG.consoleFilter.test(c)) continue;
    // Conversely, a run WITHOUT a filter must not pick up the language consoles.
    if (!CFG.consoleFilter && /\b(japanese|chinese|korean)\b/i.test(c)) continue;
    consoleByNorm.set(norm(c), c);
    // Consoles are prefixed with the game ("YuGiOh Metal Raiders", "Magic
    // Foundations", "Lorcana Azurite Sea") while our set names are bare, so index
    // both forms.
    consoleByNorm.set(norm(c.replace(CFG.consolePrefix, '')), c);
  }

  const { data: allSets, error: setErr } = await supabase
    .from('pokemon_sets').select('id, name').eq('game', DB_GAME).eq('language', CARD_LANG);
  if (setErr) throw new Error(`sets: ${setErr.message}`);

  let targets = allSets ?? [];
  if (setsArg) {
    const want = new Set(setsArg.split(',').map((s) => s.trim()));
    targets = targets.filter((s) => want.has(s.id));
  } else if (!ALL_SETS) {
    // Default to the sets that have NO raw price at all — the gap this exists for.
    // Paged: PostgREST caps every response at 1000 rows regardless of .limit().
    const priced = new Set();
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('market_values').select('card_id, pokemon_cards!inner(set_id)')
        .eq('game', DB_GAME).eq('language', STORE_LANG).eq('condition', 'Raw_NM')
        .order('card_id', { ascending: true }).range(p * 1000, p * 1000 + 999);
      if (error) throw new Error(`coverage: ${error.message}`);
      for (const r of data ?? []) if (r.pokemon_cards?.set_id) priced.add(r.pokemon_cards.set_id);
      if (!data || data.length < 1000) break;
    }
    targets = targets.filter((s) => !priced.has(s.id));
    console.log(`targeting ${targets.length} sets with no Raw_NM row (${priced.size} already priced)`);
  }

  const allRows = [];
  const now = new Date().toISOString();
  let noConsole = 0, skippedSets = [], totalMatched = 0, totalCards = 0, protectedRows = 0, nameVetoed = 0;

  for (const set of targets) {
    // `GAME` is our id ("mtg"), not PriceCharting's word ("Magic"), so use the word.
    const consoleName = consoleByNorm.get(norm(set.name)) ?? consoleByNorm.get(norm(`${CFG.consoleWord} ${set.name}`));
    if (!consoleName) { noConsole++; continue; }
    const pcRows = byConsole.get(consoleName);

    const { data: ours, error } = await supabase
      .from('pokemon_cards').select('id, number, name').eq('set_id', set.id).eq('language', CARD_LANG);
    if (error) throw new Error(`cards ${set.id}: ${error.message}`);
    if (!ours?.length) continue;

    // Deliberate pins must never be overwritten. Under --only-missing, ANY existing
    // Raw_NM row makes the card off-limits — the nightly JustTCG data is fresher
    // than PriceCharting's weekly snapshot, so this fills gaps without regressing.
    const pinned = new Set();
    for (let i = 0; i < ours.length; i += 200) {
      const { data: existing, error: exErr } = await supabase
        .from('market_values').select('card_id, source')
        .eq('language', STORE_LANG).eq('condition', 'Raw_NM')
        .in('card_id', ours.slice(i, i + 200).map((c) => c.id));
      if (exErr) throw new Error(`existing ${set.id}: ${exErr.message}`);
      for (const m of existing ?? []) {
        if (ONLY_MISSING || ['admin', 'cardstreet'].includes(m.source)) pinned.add(m.card_id);
      }
    }

    // Index by REGION+number, not number alone. Matching on number alone made the
    // European rows collide with North American ones — our ygo-lob-e021 (Aqua
    // Madoor) was being paired against PriceCharting's LOB-021, a different card,
    // which is what dragged the set's name agreement down to 72% and got it skipped.
    const setPrefix = ours.some((c) => /-en\d/i.test(c.id)) ? 'EN' : '';
    const pcByKey = new Map();
    for (const p of pcRows) {
      const parsed = parseProduct(p['product-name']);
      if (!parsed) continue;
      const key = CFG.matchByOriginCode ? `${parsed.code}|${parsed.num}` : `${parsed.prefix}|${parsed.num}`;
      const prev = pcByKey.get(key);
      if (!prev || (prev.isVariant && !parsed.isVariant)) pcByKey.set(key, { p, ...parsed });
    }
    const lookup = (c) => {
      if (CFG.matchByOriginCode) {
        // Our id embeds the origin code: op-op-16-jp-op10-045 -> "op10|45".
        const tail = c.id.startsWith(`${set.id}-`) ? c.id.slice(set.id.length + 1) : '';
        const m = tail.match(/^([a-z0-9]+)-(\d{1,4})$/i);
        return m ? pcByKey.get(`${m[1].toLowerCase()}|${stripNum(m[2])}`) : undefined;
      }
      const region = CFG.style === 'setcode' ? (regionOfCardId(c.id, set.id) ?? setPrefix) : '';
      return pcByKey.get(`${region}|${stripNum(c.number)}`)
        // A set with only one scheme upstream still resolves when our id shape says
        // otherwise (most modern sets are EN-only).
        ?? pcByKey.get(`${setPrefix}|${stripNum(c.number)}`);
    };

    const candidates = [];
    let nameAgree = 0, matched = 0;
    for (const c of ours) {
      const hit = lookup(c);
      if (!hit) continue;
      matched++;
      const pcName = nameOfProduct(hit.p['product-name']);
      const ourName = norm(c.name);
      const agrees = pcName === ourName || pcName.includes(ourName) || ourName.includes(pcName);
      if (agrees) nameAgree++;
      // Per-card veto on top of the per-set gate. A set can sit at 99.8% agreement
      // and still hold one poisoned pair: PriceCharting lists token products in the
      // same console under their own 1..N numbering, and mtg-fdn #1 "Sire of Seven
      // Deaths" matched exactly that ("Cat // Cat #1", $0.40). One bad row never
      // moves the per-set ratio enough to trip the gate.
      if (!agrees) { nameVetoed++; continue; }

      const price = usd(hit.p['loose-price']);
      if (!price) continue;
      if (pinned.has(c.id)) { protectedRows++; continue; }
      candidates.push({
        card_id: c.id,
        language: STORE_LANG,
        condition: 'Raw_NM',
        market_avg: price,
        // The column defaults to THB — without this every USD price renders ~36x low.
        currency: 'USD',
        game: DB_GAME,
        printing: null,
        source_links: [`${BASE}/game/${encodeURIComponent(consoleName.toLowerCase().replace(/\s+/g, '-'))}/${String(hit.p.id)}`],
        source_prices: { market_price: price, source: 'pricecharting', pricecharting_id: String(hit.p.id), console: consoleName, method: 'pc_loose' },
        last_updated: now,
        last_priced_at: now,
      });
    }

    const agree = matched ? nameAgree / matched : 0;
    totalMatched += matched; totalCards += ours.length;

    let rows = candidates, method = 'number';
    if (matched && agree < NAME_AGREEMENT_MIN) {
      // The set's numbering does not line up with PriceCharting's — for ygo-lob our
      // #003 is "Dark Magician" where theirs is "Flame Swordsman". Pairing by number
      // here would be random, so fall back to matching on NAME, and only where the
      // name identifies exactly one card on BOTH sides. Ambiguous names are dropped
      // rather than guessed, which is why this cannot reintroduce the mis-pairing.
      const pcByName = new Map();
      for (const p of pcRows) {
        const parsed = parseProduct(p['product-name']);
        if (!parsed) continue;
        const key = norm(String(p['product-name']).replace(/\b[A-Z0-9]{2,6}-[A-Za-z]*\d{1,4}\s*$/, '').replace(/\[[^\]]*\]/g, ''));
        if (!key) continue;
        const prev = pcByName.get(key);
        // Ambiguity is recorded, not resolved: a name held by two different prints
        // is dropped unless one is the plain base print.
        if (!prev) pcByName.set(key, { p, isVariant: parsed.isVariant, dupe: false });
        else if (prev.isVariant && !parsed.isVariant) pcByName.set(key, { p, isVariant: parsed.isVariant, dupe: false });
        else if (!prev.isVariant && !parsed.isVariant) prev.dupe = true;
      }
      const ourNameCounts = new Map();
      for (const c of ours) ourNameCounts.set(norm(c.name), (ourNameCounts.get(norm(c.name)) ?? 0) + 1);

      rows = []; method = 'name';
      for (const c of ours) {
        const key = norm(c.name);
        if (ourNameCounts.get(key) !== 1) continue;
        const hit = pcByName.get(key);
        if (!hit || hit.dupe) continue;
        const price = usd(hit.p['loose-price']);
        if (!price) continue;
        if (pinned.has(c.id)) { protectedRows++; continue; }
        rows.push({
          card_id: c.id, language: STORE_LANG, condition: 'Raw_NM', market_avg: price,
          currency: 'USD', game: DB_GAME, printing: null,
          source_links: [`${BASE}/game/${encodeURIComponent(consoleName.toLowerCase().replace(/\s+/g, '-'))}/${String(hit.p.id)}`],
          source_prices: { market_price: price, source: 'pricecharting', pricecharting_id: String(hit.p.id), console: consoleName, method: 'pc_loose_byname' },
          last_updated: now, last_priced_at: now,
        });
      }
      if (!rows.length) {
        console.warn(`  ${set.id.padEnd(14)} SKIPPED — number agreement ${Math.round(agree * 100)}% and no unambiguous name matches`);
        skippedSets.push(set.id);
        continue;
      }
      console.log(`  ${set.id.padEnd(14)} ${consoleName.slice(0, 44).padEnd(45)} number agreement ${Math.round(agree * 100)}% -> matched BY NAME: ${rows.length}/${ours.length}`);
      allRows.push(...rows);
      continue;
    }
    if (!rows.length) continue;
    console.log(`  ${set.id.padEnd(14)} ${consoleName.slice(0, 44).padEnd(45)} matched ${String(matched).padStart(4)}/${String(ours.length).padEnd(4)} names ${String(Math.round(agree * 100)).padStart(3)}%  -> ${rows.length} priced (${method})`);
    allRows.push(...rows);
  }

  // ── Promo pass ────────────────────────────────────────────────────────────
  // Lorcana prints promos with their OWN 1..N numbering in a separate console
  // ("Lorcana Promo", 164 products), so a promo's number collides with an unrelated
  // base card in its set — our lorcana-5 #2 is the promo "Kristoff - Reindeer
  // Keeper" while the set's real #2 is someone else. The number path therefore
  // cannot reach them and the per-card veto correctly refuses; they are matched on
  // NAME instead, and only when the name resolves 1:1 on BOTH sides. Promo numbers
  // do not agree with ours either (our Cinderella - Stouthearted is #3, PriceCharting
  // has #2), so the number is deliberately ignored here rather than used as a check.
  if (PROMOS && CFG.promoConsole) {
    const promoRows = byConsole.get(CFG.promoConsole) ?? [];
    const promoByName = new Map();
    for (const p of promoRows) {
      // Bracketed prints are REJECTED outright, not merely deprioritised. Our promo
      // rows carry no variant marker, so only a plain print can stand in for them —
      // and these variants are wildly more valuable: "Invited To The Ball
      // [Challenge]" is $3,000 and "Elsa's Ice Palace [Challenge]" $6,250 against
      // ordinary promos worth a few dollars. An earlier draft only demoted a variant
      // when a plain print also existed, so names that exist ONLY as a variant took
      // the variant's price — the parallel-underpricing bug inverted.
      if (/\[|\(/.test(p['product-name'])) continue;
      const key = nameOfProduct(p['product-name']);
      if (!key) continue;
      const prev = promoByName.get(key);
      if (!prev) promoByName.set(key, { p, dupe: false });
      else prev.dupe = true; // two plain prints of one name — ambiguous, dropped
    }

    const { data: promoCards, error: pcErr } = await supabase
      .from('pokemon_cards').select('id, name, number, set_id, rarity')
      .eq('game', DB_GAME).eq('language', CARD_LANG).in('rarity', CFG.promoRarities);
    if (pcErr) throw new Error(`promo cards: ${pcErr.message}`);

    const already = new Set();
    for (let i = 0; i < (promoCards ?? []).length; i += 200) {
      const { data } = await supabase.from('market_values').select('card_id, source')
        .eq('language', STORE_LANG).eq('condition', 'Raw_NM')
        .in('card_id', promoCards.slice(i, i + 200).map((c) => c.id));
      for (const m of data ?? []) if (ONLY_MISSING || ['admin', 'cardstreet'].includes(m.source)) already.add(m.card_id);
    }

    const ourNameCounts = new Map();
    for (const c of promoCards ?? []) ourNameCounts.set(norm(c.name), (ourNameCounts.get(norm(c.name)) ?? 0) + 1);

    let promoWrote = 0, promoAmbiguous = 0, promoMissing = 0;
    for (const c of promoCards ?? []) {
      if (already.has(c.id)) continue;
      const key = norm(c.name);
      if (ourNameCounts.get(key) !== 1) { promoAmbiguous++; continue; }
      const hit = promoByName.get(key);
      if (!hit) { promoMissing++; continue; }
      if (hit.dupe) { promoAmbiguous++; continue; }
      const price = usd(hit.p['loose-price']);
      if (!price) { promoMissing++; continue; }
      allRows.push({
        card_id: c.id, language: STORE_LANG, condition: 'Raw_NM', market_avg: price,
        currency: 'USD', game: DB_GAME, printing: null,
        source_links: [`${BASE}/game/${encodeURIComponent(CFG.promoConsole.toLowerCase().replace(/\s+/g, '-'))}/${String(hit.p.id)}`],
        source_prices: { market_price: price, source: 'pricecharting', pricecharting_id: String(hit.p.id), console: CFG.promoConsole, method: 'pc_loose_promo' },
        last_updated: now, last_priced_at: now,
      });
      promoWrote++;
      console.log(`  promo  ${c.set_id.padEnd(12)} #${String(c.number).padEnd(5)} "${String(c.name).slice(0, 38).padEnd(39)}" -> "${String(hit.p['product-name']).slice(0, 40)}" $${price}`);
    }
    console.log(`promo pass: ${promoWrote} matched, ${promoAmbiguous} ambiguous (name not 1:1), ${promoMissing} absent upstream`);
  }

  console.log(`\nprepared ${allRows.length} Raw_NM rows (matched ${totalMatched}/${totalCards} cards in mapped sets)`);
  if (noConsole) console.log(`${noConsole} sets have no PriceCharting console — neither vendor carries them`);
  if (nameVetoed) console.log(`${nameVetoed} number matches vetoed because the names disagree (token/variant collisions)`);
  if (protectedRows) console.log(`skipped ${protectedRows} cards that already have a Raw_NM row${ONLY_MISSING ? '' : ' pinned to admin/cardstreet'}`);
  if (skippedSets.length) console.log(`skipped on name disagreement: ${skippedSets.join(', ')}`);
  if (allRows.length) {
    const prices = allRows.map((r) => r.market_avg).sort((a, b) => a - b);
    console.log(`price range: $${prices[0]} .. $${prices[prices.length - 1]}, median $${prices[Math.floor(prices.length / 2)]}`);
  }
  if (!COMMIT) { console.log('\nDRY RUN — nothing written.'); return; }

  for (let i = 0; i < allRows.length; i += 500) {
    const { error } = await supabase.from('market_values')
      .upsert(allRows.slice(i, i + 500), { onConflict: 'card_id,language,condition' });
    if (error) throw new Error(`upsert: ${error.message}`);
  }
  console.log(`wrote ${allRows.length} market_values rows`);
})().catch((e) => { console.error('\nFailed:', e.message); process.exit(1); });
