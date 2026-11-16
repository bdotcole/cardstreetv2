// Japanese Sun & Moon era sets (2016-12 to 2019-10) -> pokemon_sets / pokemon_cards.
//
// The Japanese catalog had nothing released between 2007 and 2020, so no
// Japanese Tag Team card existed: "blastoise and piplup" found the English and
// Thai prints and never カメックス&ポッチャマGX (SM11a).
//
//   node scripts/ingest/jp-sun-moon-sets.mjs build SM11a SM9 ...     # no DB writes
//   node scripts/ingest/jp-sun-moon-sets.mjs names                   # english_name for every built set
//   node scripts/ingest/jp-sun-moon-sets.mjs commit SM11a ... --dry-run
//   SUPABASE_SECRET_KEY=sb_secret_... node scripts/ingest/jp-sun-moon-sets.mjs commit SM11a ...
//   SUPABASE_SECRET_KEY=... node scripts/ingest/jp-sun-moon-sets.mjs logos SM11a ...        # set rows without a logo
//   SUPABASE_SECRET_KEY=... node scripts/ingest/jp-sun-moon-sets.mjs fill-names SM11a ...   # after a later `names` run
//
// Three steps on purpose. `build` and `names` only read (TCGdex, Limitless, and
// our catalog through the publishable key) and leave everything in
// scripts/out/jp-sm/, so the result can be inspected before `commit` writes.
// Every step resumes from that cache, so a failed request costs a rerun.
//
// Sources:
//   - Card data: TCGdex ja (api.tcgdex.net/v2/ja). Its card objects carry NO
//     `image` field for this era, which reads as "no art". The art is there:
//     assets.tcgdex.net/ja/SM/<SET>/<localId>/high.webp answers 200. Always
//     probe the asset path before calling a TCGdex set imageless.
//   - Art: the Limitless CDN first (.../tpc/<SET>/<SET>_<n>_R_JP.png, n
//     unpadded, 736px), then that TCGdex path (600px, and slow).
//   - english_name: the "Int. Prints" Limitless lists on each Japanese card
//     page, read against our own English rows (see deriveNames).
//   - Set name in English and the logo: Limitless' set page and Bulbagarden
//     Archives, as scripts/ingest/jp-sets-backfill.mjs did (English set names
//     are the convention on the Japanese shelves either side of this era).
//
// Rules this script keeps (each one is a past incident):
//   - INSERT ONLY. Existing ids are skipped, never upserted: an upsert from
//     here would push mirrored rows back onto a third-party host.
//   - A set id or card id held by another language is refused. pokemon_sets.id
//     is a single-column primary key shared by every language.
//   - Rows land complete: art already mirrored into the card-images bucket
//     (two WebP sizes, as mirror-card-images.mjs writes them) and already
//     hashed, so no second pass is needed and no row ever points at an
//     upstream host.
//   - english_name is never taken from the English release by card number (the
//     English sets renumber). It comes from the species the card names,
//     checked against the English catalog, or from a pHash-verified twin; a
//     card that passes neither keeps it empty.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'scripts', 'out', 'jp-sm');
const IMG = path.join(OUT, 'img');
fs.mkdirSync(IMG, { recursive: true });

// --- env: nearest .env.local upward (a worktree has none of its own). Values
// already in the environment win, quotes and the literal "\r\n" some values
// carry are stripped.
function loadEnv() {
  let dir = ROOT;
  for (;;) {
    const p = path.join(dir, '.env.local');
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m || process.env[m[1]]) continue;
        const v = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\r|\\n/g, '').trim();
        if (v) process.env[m[1]] = v;
      }
      return;
    }
    if (path.dirname(dir) === dir) return;
    dir = path.dirname(dir);
  }
}
loadEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;

const TCGDEX = 'https://api.tcgdex.net/v2/ja';
const TCGDEX_ASSETS = 'https://assets.tcgdex.net/ja';
const LIMITLESS = 'https://limitlesstcg.com';
const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const SERIES = 'Sun & Moon';
const BUCKET = 'card-images';
// Same geometry as scripts/ingest/mirror-card-images.mjs.
const SMALL_W = 245, SMALL_Q = 78, LARGE_W = 734, LARGE_Q = 82;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const builtPath = (id) => path.join(OUT, `${id}.built.json`);
// Limitless sends names HTML-escaped ("Let&#039;s Face New Trials", "Champion&#039;s Path").
const decodeHtml = (s) => String(s || '').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

async function fetchRetry(url, init = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(60000) });
      // 404, and 403 from an object store, both mean "no such file".
      if (res.ok || res.status === 404 || res.status === 403) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) { last = e; }
    await sleep(500 * (i + 1));
  }
  throw new Error(`${url}: ${last?.message}`);
}
const getJson = async (url) => { const r = await fetchRetry(url); return r.ok ? r.json() : null; };
const getText = async (url) => { const r = await fetchRetry(url); return r.ok ? r.text() : null; };

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  }));
  return out;
}

// Identical to scripts/backfill-phashes.mjs and lib/phash.ts.
async function computeDHash(buf) {
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const hash = Buffer.alloc(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) if (px[row * 9 + col] > px[row * 9 + col + 1]) byte |= 1 << (7 - col);
    hash[row] = byte;
  }
  return hash.toString('hex');
}
const POP = new Uint8Array(256);
for (let i = 0; i < 256; i++) POP[i] = (i & 1) + POP[i >> 1];
function hamming(aHex, bHex) {
  if (!aHex || !bHex) return 99;
  const a = Buffer.from(aHex.replace(/^\\x/, ''), 'hex');
  const b = Buffer.from(bHex.replace(/^\\x/, ''), 'hex');
  if (a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[a[i] ^ b[i]];
  return d;
}

// ───────────────────────────────────────────────────────────────── build ───

async function limitlessSet(code) {
  const html = await getText(`${LIMITLESS}/cards/jp/${code}`);
  if (!html) return { name: null, numbers: new Set() };
  const numbers = new Set();
  for (const m of html.matchAll(/\/cards\/jp\/([A-Za-z0-9+-]+)\/(\d+)/g)) {
    if (m[1].toLowerCase() === code.toLowerCase()) numbers.add(Number(m[2]));
  }
  const heading = html.match(/<img class="set"[^>]*>\s*([^<]+)/)?.[1]?.trim() || '';
  // "Remix Bout (SM11a)" -> "Remix Bout"
  const name = decodeHtml(heading).replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
  return { name, numbers };
}

/**
 * Download the card's art once and cache it. Limitless first: its full-size
 * file is 736px wide (our large variant is 734) and answers in under a second,
 * where TCGdex's is 600px and took 15 seconds an image for this era. Returns
 * null only when both hosts say the file does not exist; a failed request
 * throws, so an outage is never recorded as "this card has no art".
 */
async function fetchArt(serieId, setId, card) {
  const cached = ['webp', 'png'].map((ext) => path.join(IMG, `${card.id}.${ext}`)).find((p) => fs.existsSync(p));
  const metaPath = path.join(IMG, `${card.id}.json`);
  if (cached && fs.existsSync(metaPath)) return { file: cached, ...JSON.parse(fs.readFileSync(metaPath, 'utf8')) };

  const isImage = (r) => r.ok && (r.headers.get('content-type') || '').startsWith('image/');
  let res = null, meta = null, ext = 'png';
  if (/^\d+$/.test(card.localId)) {
    const url = `${LIMITLESS_CDN}/${setId}/${setId}_${Number(card.localId)}_R_JP.png`;
    res = await fetchRetry(url);
    if (isImage(res)) meta = { source: 'limitless', url };
  }
  if (!meta) {
    const base = `${TCGDEX_ASSETS}/${serieId}/${setId}/${card.localId}`;
    res = await fetchRetry(`${base}/high.webp`, {}, 6);
    if (isImage(res)) { meta = { source: 'tcgdex', base }; ext = 'webp'; }
  }
  if (!meta) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // A placeholder or a truncated download must not become a card's art.
  const info = await sharp(buf).metadata().catch(() => null);
  if (!info || !info.width || info.width < 200) return null;
  const file = path.join(IMG, `${card.id}.${ext}`);
  fs.writeFileSync(file, buf);
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  return { file, ...meta };
}

async function buildSet(setId) {
  const set = await getJson(`${TCGDEX}/sets/${setId}`);
  if (!set || !(set.cards || []).length) {
    console.log(`${setId}: TCGdex lists no cards, skipped`);
    return null;
  }
  const serieId = set.serie?.id || 'SM';
  const detailCache = path.join(OUT, `${setId}.tcgdex.json`);
  let details = fs.existsSync(detailCache) ? JSON.parse(fs.readFileSync(detailCache, 'utf8')) : null;
  if (!details || details.length !== set.cards.length) {
    details = await pool(set.cards, 10, (c) => getJson(`${TCGDEX}/cards/${encodeURIComponent(c.id)}`));
    if (details.every(Boolean)) fs.writeFileSync(detailCache, JSON.stringify(details));
  }
  const missingDetail = details.filter((d) => !d).length;
  const cards = details.filter(Boolean);

  const lim = await limitlessSet(setId);
  let artErrors = 0;
  const arts = await pool(cards, 8, (c) => fetchArt(serieId, setId, c).catch(() => { artErrors++; return null; }));
  if (artErrors) {
    // Nothing is written: a rerun picks up from the cache and retries only the failures.
    console.log(`${setId}: ${artErrors} art request(s) failed, set NOT built. Run build again.`);
    return null;
  }
  const hashes = await pool(arts, 8, async (a) => (a ? computeDHash(fs.readFileSync(a.file)).catch(() => null) : null));

  const rows = cards.map((c, i) => ({
    id: c.id,
    name: c.name,
    english_name: null,
    language: 'ja',
    game: 'pokemon',
    set_id: setId,
    number: c.localId,
    supertype: c.category === 'Pokemon' ? 'Pokémon' : c.category,
    subtypes: [],
    rarity: c.rarity || null,
    hp: c.hp || null,
    types: c.types || [],
    attacks: c.attacks || null,
    weaknesses: c.weaknesses || null,
    resistances: c.resistances || null,
    retreat_cost: c.retreat ? Array(c.retreat).fill('Colorless') : [],
    abilities: c.abilities || null,
    rules: [],
    regulation_mark: c.regulationMark || null,
    tcgplayer_url: null,
    cardmarket_url: null,
    raw_data: {
      ...c,
      // The upstream original, so the mirrored URLs stay reversible.
      ...(arts[i]?.source === 'tcgdex' ? { image: arts[i].base } : {}),
      ...(arts[i]?.source === 'limitless' ? { imageSource: arts[i].url } : {}),
      set: { id: setId, name: set.name, printedTotal: set.cardCount?.official },
    },
    _art: arts[i] ? { file: path.relative(ROOT, arts[i].file), source: arts[i].source } : null,
    _phash: hashes[i],
    _dexId: c.dexId || [],
  }));

  const built = {
    set: {
      id: setId,
      name: lim.name || set.name,
      series: SERIES,
      printed_total: set.cardCount?.official || rows.length,
      total: set.cardCount?.total || rows.length,
      release_date: set.releaseDate || null,
      symbol_url: null,
      logo_url: null,
      game: 'pokemon',
      language: 'ja',
    },
    jaName: set.name,
    cards: rows,
  };
  fs.writeFileSync(builtPath(setId), JSON.stringify(built));

  const withArt = rows.filter((r) => r._art).length;
  const fromLimitless = rows.filter((r) => r._art?.source === 'limitless').length;
  const noKana = rows.filter((r) => r.supertype === 'Pokémon' && !/[぀-ヿ]/.test(r.name)).map((r) => `${r.number} ${r.name}`);
  console.log(
    `${setId.padEnd(6)} ${String(built.set.name).slice(0, 26).padEnd(26)} ${built.set.release_date} ` +
    `cards ${String(rows.length).padStart(3)}/${built.set.total}  art ${withArt} (${fromLimitless} from Limitless)` +
    `${missingDetail ? `  MISSING DETAIL ${missingDetail}` : ''}${noKana.length ? `  NO-KANA ${noKana.length}: ${noKana.slice(0, 3).join(', ')}` : ''}`
  );
  return built;
}

// ───────────────────────────────────────────────────────────────── names ───

function publicClient() {
  if (!SUPABASE_URL || !PUBLISHABLE) throw new Error('SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not found in .env.local');
  return createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
}

// Paged by id cursor: an OFFSET page deep into pokemon_cards runs past the
// statement timeout.
async function selectAll(sb, build) {
  const out = [];
  let last = '';
  for (;;) {
    const { data, error } = await build(sb).gt('id', last).order('id').limit(1000);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
    last = data[data.length - 1].id;
  }
  return out;
}

// The English Sun & Moon sets, by id: `.in()` uses the set_id index, where an
// ILIKE on the column scans the whole catalog.
const EN_SM_SETS = ['sm1', 'sm2', 'sm3', 'sm3.5', 'sm4', 'sm5', 'sm6', 'sm7', 'sm7.5', 'sm8', 'sm9', 'sm10', 'sm11', 'sm115', 'sm12', 'smp'];

const fold = (s) => String(s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[-‐‑–—]/g, ' ').replace(/['’`.:]/g, '').replace(/\s+/g, ' ').trim();
const nfkc = (s) => String(s || '').normalize('NFKC').trim();

/**
 * english_name for every built card, written back into the built files.
 *
 * Nothing is matched by card number against the English release, and nothing
 * is matched by picture alone (Trainer cards share a layout: on SM11a the
 * nearest English print by pHash to 溶接工, Welder, was Martial Arts Dojo at 8
 * bits). In order:
 *
 *   1. PRINT TWIN. Limitless' page for a Japanese card lists its international
 *      prints ("Int. Prints": Cosmic Eclipse #192). The English name is read
 *      from OUR English row at that set and number, so it is the catalog's own
 *      spelling. Used only when the page's Japanese name is the name TCGdex
 *      gave us for that number, which is the check that both sources number the
 *      set alike.
 *   2. SPECIES (Pokémon). The card's own dexId names the species; the Japanese
 *      name is read as [アローラ|メガ]<species>[&<species>...][GX] against the
 *      search dictionary, and kept only when the English Sun & Moon catalog
 *      prints a card of that name. When 1 and 2 both answer and disagree, the
 *      card is reported and left empty.
 *   3. SAME NAME. A print Limitless does not list (the rainbow and gold
 *      secrets) takes the name its other prints in these sets resolved to, then
 *      a pairing the Japanese catalog already holds, when that is unambiguous.
 *   4. pHash twin, Pokémon only and only among English prints that name the
 *      card's species (form names: たそがれのたてがみ, ウルトラネクロズマ).
 *
 * A card that passes none of these keeps english_name empty. Its species is
 * still found by search through the Japanese name.
 */
const TWIN_MAX = Number(process.env.TWIN_MAX || 12);
const TWIN_MARGIN = Number(process.env.TWIN_MARGIN || 4);
const LIM_CACHE = path.join(OUT, 'limitless');

/** { jaName, prints: [{ set, number }] } for one Japanese card page, or null when Limitless has no such page. */
async function limitlessPrints(setId, n) {
  fs.mkdirSync(LIM_CACHE, { recursive: true });
  const cache = path.join(LIM_CACHE, `${setId}-${n}.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const html = await getText(`${LIMITLESS}/cards/jp/${setId}/${n}`);
  let out = null;
  if (html) {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || '';
    const jaName = title.split(' - ')[0].replace(/&amp;/g, '&').trim();
    const table = html.match(/<table class="card-prints-versions">([\s\S]*?)<\/table>/)?.[1] || '';
    // Only the rows before the "JP. Prints" header are international prints.
    const intl = table.split(/<th[^>]*>\s*JP\. Prints/)[0];
    const prints = [...intl.matchAll(/<a\s+href="\/cards\/en\/[^"]+"\s*>\s*([^<]+?)\s*<span class="prints-table-card-number">#([^<]+)<\/span>/g)]
      .map((m) => ({ set: m[1].replace(/&amp;/g, '&').trim(), number: m[2].trim() }));
    out = { jaName, prints };
  }
  fs.writeFileSync(cache, JSON.stringify(out));
  await sleep(80);
  return out;
}

async function deriveNames() {
  const sb = publicClient();
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib', 'search', 'data', 'pokemonNames.json'), 'utf8'));
  const byDex = new Map(); // dex -> { en: string[], ja: string[] }
  for (const [dex, en, enDb, ja] of dict.groups) byDex.set(dex, { en: [en, ...enDb], ja: ja.map(nfkc) });

  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.built.json'));
  const sets = files.map((f) => ({ f, built: JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')) }));

  // 1. Print twins, from Limitless.
  const prints = new Map(); // card id -> page
  for (const { built } of sets) {
    const numeric = built.cards.filter((c) => /^\d+$/.test(c.number));
    const pages = await pool(numeric, 4, (c) => limitlessPrints(built.set.id, Number(c.number)).catch(() => null));
    numeric.forEach((c, i) => { if (pages[i]) prints.set(c.id, pages[i]); });
  }

  // English sets by name, then the English rows of every set a twin points at.
  const { data: enSets, error: setErr } = await sb.from('pokemon_sets').select('id, name').eq('language', 'en').eq('game', 'pokemon');
  if (setErr) throw new Error(setErr.message);
  const enSetByName = new Map(enSets.map((s) => [fold(s.name), s.id]));
  // Sets Limitless names differently from our catalog.
  const enSetIds = new Set(enSets.map((s) => s.id));
  for (const [name, id] of [['Sun & Moon Promos', 'smp'], ['HeartGold & SoulSilver', 'hgss1'], ['Expedition', 'ecard1'], ['Pokémon 151', 'sv3pt5']]) {
    if (enSetIds.has(id) && !enSetByName.has(fold(name))) enSetByName.set(fold(name), id);
  }
  const neededSets = new Set(EN_SM_SETS);
  const unknownSets = new Map();
  for (const page of prints.values()) {
    for (const p of page.prints) {
      p.set = decodeHtml(p.set);
      const id = enSetByName.get(fold(p.set));
      if (id) neededSets.add(id); else unknownSets.set(p.set, (unknownSets.get(p.set) || 0) + 1);
    }
  }
  // One set per query: `.eq('set_id')` rides the index, where a long `.in()`
  // list ordered by id ran past the statement timeout.
  const enRows = [];
  for (const setId of neededSets) {
    enRows.push(...await selectAll(sb, (c) => c.from('pokemon_cards')
      .select('id, name, number, set_id, supertype, phash').eq('set_id', setId).eq('language', 'en')));
  }
  const numKey = (n) => String(n || '').split('/')[0].trim().replace(/^0+(?=\d)/, '').toUpperCase();
  const enBySetNumber = new Map(enRows.map((r) => [`${r.set_id}|${numKey(r.number)}`, r]));
  const enByFold = new Map(); // folded name -> the catalog's most common spelling
  const spellings = new Map();
  for (const r of enRows) {
    const k = fold(r.name);
    const m = spellings.get(k) || new Map();
    m.set(r.name, (m.get(r.name) || 0) + 1);
    spellings.set(k, m);
  }
  for (const [k, m] of spellings) enByFold.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  const enHashed = enRows.filter((r) => r.phash && EN_SM_SETS.includes(r.set_id));

  const jaRows = await selectAll(sb, (c) => c.from('pokemon_cards')
    .select('id, name, english_name').eq('language', 'ja').eq('game', 'pokemon').not('english_name', 'is', null));
  const pairing = new Map(); // Japanese name -> Set of english names
  for (const r of jaRows) {
    const k = nfkc(r.name);
    if (!pairing.has(k)) pairing.set(k, new Set());
    pairing.get(k).add(r.english_name);
  }
  console.log(`Limitless pages: ${prints.size}; English rows loaded: ${enRows.length} from ${neededSets.size} sets; Japanese name pairings: ${pairing.size}`);
  if (unknownSets.size) console.log(`  twin sets not in our English catalog: ${[...unknownSets].map(([s, n]) => `${s} (${n})`).join(', ')}`);

  const twinName = (card) => {
    const page = prints.get(card.id);
    if (!page) return { name: null };
    if (nfkc(page.jaName) !== nfkc(card.name)) return { name: null, mismatch: page.jaName };
    const names = new Set();
    let via = null;
    for (const p of page.prints) {
      const setId = enSetByName.get(fold(p.set));
      const row = setId && enBySetNumber.get(`${setId}|${numKey(p.number)}`);
      if (row) { names.add(row.name); via = via || row.id; }
    }
    // Reprints of one card across English sets carry one name; if they do not, trust none.
    const folded = new Set([...names].map(fold));
    if (folded.size !== 1) return { name: null, split: [...names] };
    return { name: enByFold.get([...folded][0]) || [...names][0], via };
  };

  const nearest = (hash, accept) => {
    let best = null, second = 99;
    for (const r of enHashed) {
      if (!accept(r)) continue;
      const d = hamming(hash, r.phash);
      if (!best || d < best.d) {
        if (best && fold(best.row.name) !== fold(r.name)) second = best.d;
        best = { d, row: r };
      } else if (d < second && fold(best.row.name) !== fold(r.name)) second = d;
    }
    return best ? { ...best, second } : null;
  };

  function speciesName(card) {
    const dexIds = card._dexId || [];
    if (!dexIds.length) return null;
    let s = nfkc(card.name);
    let suffix = '';
    if (/GX$/.test(s)) { suffix = ' GX'; s = s.slice(0, -2).trim(); }
    const parts = s.split('&').map((p) => p.trim());
    if (parts.length !== dexIds.length) return null;
    const remaining = new Set(dexIds);
    const out = [];
    for (const part of parts) {
      let prefix = '', body = part;
      if (/^アローラ\s*/.test(body)) { prefix = 'Alolan '; body = body.replace(/^アローラ\s*/, ''); }
      else if (/^メガ/.test(body) && ![...remaining].some((d) => byDex.get(d)?.ja.includes(body))) { prefix = 'Mega '; body = body.slice(2); }
      const dex = [...remaining].find((d) => byDex.get(d)?.ja.includes(body));
      if (dex === undefined) return null;
      remaining.delete(dex);
      out.push({ prefix, dex });
    }
    // Each catalog spelling of each species, until the whole name is one the English catalog prints.
    const tryNames = (i, acc) => {
      if (i === out.length) return enByFold.get(fold(acc.join(' & ') + suffix)) || null;
      for (const en of byDex.get(out[i].dex).en) {
        const r = tryNames(i + 1, [...acc, out[i].prefix + en]);
        if (r) return r;
      }
      return null;
    };
    return tryNames(0, []);
  }

  const stats = { twin: 0, species: 0, sameName: 0, pairing: 0, phash: 0, empty: 0 };
  const conflicts = [], mismatches = [], unresolved = [];
  const resolvedByName = new Map(); // Japanese name -> Set of english names resolved by steps 1-2

  // Pass 1: steps 1 and 2.
  for (const { built } of sets) {
    for (const card of built.cards) {
      card.english_name = null;
      card._nameSource = null;
      const t = twinName(card);
      if (t.mismatch) mismatches.push(`${card.id}: TCGdex "${card.name}" vs Limitless "${t.mismatch}"`);
      const sp = card.supertype === 'Pokémon' ? speciesName(card) : null;
      // The twin is the exact print and may say more than the species does:
      // TCGdex drops the Prism Star mark, so シェイミ reads as "Shaymin" where
      // the twin is "Shaymin ◇". Only a twin that does not name the species at
      // all is a disagreement.
      if (t.name && sp && fold(t.name) !== fold(sp) && !fold(t.name).includes(fold(sp))) {
        conflicts.push(`${card.id} ${card.name}: twin "${t.name}" (${t.via}) vs species "${sp}"`);
        card._nameSource = 'conflict';
        continue;
      }
      if (t.name) { card.english_name = t.name; card._nameSource = `twin:${t.via}`; stats.twin++; }
      else if (sp) { card.english_name = sp; card._nameSource = 'species'; stats.species++; }
      if (card.english_name) {
        const k = nfkc(card.name);
        if (!resolvedByName.has(k)) resolvedByName.set(k, new Set());
        resolvedByName.get(k).add(card.english_name);
      }
    }
  }

  // Pass 2: steps 3 and 4 for what is left.
  for (const { f, built } of sets) {
    for (const card of built.cards) {
      if (card.english_name || card._nameSource === 'conflict') continue;
      const same = resolvedByName.get(nfkc(card.name));
      if (same && new Set([...same].map(fold)).size === 1) {
        card.english_name = [...same][0]; card._nameSource = 'same-name'; stats.sameName++;
        continue;
      }
      const known = pairing.get(nfkc(card.name));
      if (known && new Set([...known].map(fold)).size === 1) {
        card.english_name = [...known][0]; card._nameSource = 'pairing'; stats.pairing++;
        continue;
      }
      let near = null;
      if (card.supertype === 'Pokémon' && card._phash && card._dexId.length) {
        const species = card._dexId.flatMap((d) => byDex.get(d)?.en || []).map(fold);
        near = nearest(card._phash, (r) => r.supertype === 'Pokémon' && species.some((sp) => fold(r.name).includes(sp)));
        if (near && near.d <= TWIN_MAX && near.second - near.d >= TWIN_MARGIN) {
          card.english_name = near.row.name; card._nameSource = `phash:${near.row.id}:${near.d}`; stats.phash++;
          continue;
        }
      }
      stats.empty++;
      unresolved.push(`${card.id} ${card.name} [${card.supertype}${card._dexId.length ? ` dex ${card._dexId.join(',')}` : ''}]${card._art ? '' : ' (no art)'}${same ? ` same-name ${[...same].join(' / ')}` : ''}${known ? ` pairings ${[...known].join(' / ')}` : ''}${near ? ` nearest ${near.row.name} d=${near.d} next=${near.second}` : ''}`);
    }
    fs.writeFileSync(path.join(OUT, f), JSON.stringify(built));
  }

  const total = sets.reduce((a, s) => a + s.built.cards.length, 0);
  console.log(`\nenglish_name for ${total} cards: print twin ${stats.twin}, species ${stats.species}, same name ${stats.sameName}, catalog pairing ${stats.pairing}, pHash (Pokémon) ${stats.phash}, left empty ${stats.empty + conflicts.length}`);
  console.log(`numbering disagreements between TCGdex and Limitless: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 20)) console.log(`   ${m}`);
  console.log(`twin vs species conflicts (left empty): ${conflicts.length}`);
  for (const c of conflicts.slice(0, 30)) console.log(`   ${c}`);
  fs.writeFileSync(path.join(OUT, 'unresolved-names.txt'), [...conflicts.map((c) => `CONFLICT ${c}`), ...unresolved].join('\n'));
  console.log(`unresolved list -> ${path.relative(ROOT, path.join(OUT, 'unresolved-names.txt'))}`);
}

// ──────────────────────────────────────────────────────────────── commit ───

/**
 * The Japanese expansion logo on Bulbagarden Archives. Only the exact titles
 * "File:<CODE> Logo JP.png" and "File:<CODE> Logo.png": for a code English
 * also uses (SM9 is Team Up there) the search returns "SM9 Logo EN.png" first,
 * which is another product's logo.
 */
async function bulbaLogo(code) {
  const u = 'https://archives.bulbagarden.net/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=' +
    encodeURIComponent(`${code} logo`) + '&gsrlimit=20&prop=imageinfo&iiprop=url';
  const j = await getJson(u);
  const pages = Object.values(j?.query?.pages || {});
  const byTitle = new Map(pages.map((p) => [String(p.title).toLowerCase(), p.imageinfo?.[0]?.url]));
  return byTitle.get(`file:${code} logo jp.png`.toLowerCase()) || byTitle.get(`file:${code} logo.png`.toLowerCase()) || null;
}

/** Mirror the logo into our storage (Bulbagarden blocks the image optimizer) and return its URL, or null with the reason logged. */
async function mirrorLogo(sb, setId) {
  try {
    const logo = await bulbaLogo(setId);
    if (!logo) { console.log(`  ${setId}: no logo on Bulbagarden`); return null; }
    // The media host answers 403 to a browser-style User-Agent from a script and 200 to a plain tool name.
    const res = await fetchRetry(logo, { headers: { 'User-Agent': 'catalog-logo-mirror/1.0' } });
    if (!res.ok) { console.log(`  ${setId}: logo download ${res.status}`); return null; }
    // Re-encoded so the object is a real PNG whatever the host sent, and small enough for a tile.
    const buf = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 600, withoutEnlargement: true }).png().toBuffer();
    const objectPath = `jp-set-logos/${setId}.png`;
    const { error } = await sb.storage.from('listing-images').upload(objectPath, buf, { contentType: 'image/png', upsert: true, cacheControl: '31536000' });
    if (error) { console.log(`  ${setId}: logo upload failed: ${error.message}`); return null; }
    return `${SUPABASE_URL}/storage/v1/object/public/listing-images/${objectPath}`;
  } catch (e) {
    console.log(`  ${setId}: logo failed: ${e.message}`);
    return null;
  }
}

/**
 * english_name for rows already inserted, where a later `names` run resolved a
 * card the first run could not (a same-name print that only a later set
 * supplied). Fills empty values only; never changes a name that is set.
 */
async function fillNames(sb, setIds) {
  for (const setId of setIds) {
    if (!fs.existsSync(builtPath(setId))) { console.log(`  ${setId}: not built`); continue; }
    const built = JSON.parse(fs.readFileSync(builtPath(setId), 'utf8'));
    const { data, error } = await sb.from('pokemon_cards').select('id').eq('set_id', setId).eq('language', 'ja').is('english_name', null);
    if (error) throw new Error(error.message);
    const empty = new Set(data.map((r) => r.id));
    let filled = 0;
    for (const c of built.cards) {
      if (!c.english_name || !empty.has(c.id)) continue;
      const { error: upErr } = await sb.from('pokemon_cards').update({ english_name: c.english_name })
        .eq('id', c.id).eq('language', 'ja').is('english_name', null);
      if (upErr) throw new Error(upErr.message);
      filled++;
    }
    console.log(`  ${setId}: ${empty.size} without english_name, filled ${filled}`);
  }
}

/** Fill logo_url on Japanese set rows that have none. */
async function fillLogos(sb, setIds) {
  for (const setId of setIds) {
    const { data: row, error } = await sb.from('pokemon_sets').select('id, language, logo_url').eq('id', setId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || row.language !== 'ja') { console.log(`  ${setId}: no Japanese set row`); continue; }
    if (row.logo_url) { console.log(`  ${setId}: already has a logo`); continue; }
    const url = await mirrorLogo(sb, setId);
    if (!url) continue;
    const { error: upErr } = await sb.from('pokemon_sets').update({ logo_url: url }).eq('id', setId).eq('language', 'ja').is('logo_url', null);
    if (upErr) throw new Error(upErr.message);
    console.log(`  ${setId}: logo set`);
    await sleep(150);
  }
}

async function commitSet(sb, setId, dry) {
  if (!fs.existsSync(builtPath(setId))) { console.log(`${setId}: not built, skipped`); return; }
  const built = JSON.parse(fs.readFileSync(builtPath(setId), 'utf8'));

  const { data: setRow, error: setErr } = await sb.from('pokemon_sets').select('id, language, name').eq('id', setId).maybeSingle();
  if (setErr) throw new Error(`set lookup: ${setErr.message}`);
  if (setRow && setRow.language !== 'ja') {
    console.log(`${setId}: REFUSED, the id is held by a ${setRow.language} set ("${setRow.name}")`);
    return;
  }

  const ids = built.cards.map((c) => c.id);
  const held = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('pokemon_cards').select('id, language').in('id', ids.slice(i, i + 200));
    if (error) throw new Error(`card lookup: ${error.message}`);
    for (const r of data) held.set(r.id, r.language);
  }
  const foreign = [...held].filter(([, lang]) => lang !== 'ja');
  if (foreign.length) {
    console.log(`${setId}: REFUSED, ${foreign.length} card id(s) are held by another language, e.g. ${foreign.slice(0, 4).map(([id, l]) => `${id} (${l})`).join(', ')}`);
    return;
  }
  const fresh = built.cards.filter((c) => !held.has(c.id));
  if (dry) {
    console.log(`${setId}: would insert ${fresh.length} cards (${held.size} already present)${setRow ? '' : ' and the set row'}`);
    return;
  }

  if (!setRow) {
    const row = { ...built.set, logo_url: await mirrorLogo(sb, setId) };
    const { error } = await sb.from('pokemon_sets').insert([row]);
    if (error) throw new Error(`set insert: ${error.message}`);
  }

  let uploaded = 0, imageless = 0;
  const ready = await pool(fresh, 6, async (c) => {
    const { _art, _phash, _dexId, _nameSource, ...row } = c;
    row.image_small = null;
    row.image_large = null;
    row.phash = null;
    if (_art) {
      const original = fs.readFileSync(path.join(ROOT, _art.file));
      const [large, small] = await Promise.all([
        sharp(original).resize({ width: LARGE_W, withoutEnlargement: true }).webp({ quality: LARGE_Q }).toBuffer(),
        sharp(original).resize({ width: SMALL_W, withoutEnlargement: true }).webp({ quality: SMALL_Q }).toBuffer(),
      ]);
      for (const [name, buf] of [['large', large], ['small', small]]) {
        // Storage now and then answers with an HTML error page; one such reply
        // must not abort a set half way (it did, on SM7b). Card art never
        // changes once published: cache it for a year.
        let lastError = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          const { error } = await sb.storage.from(BUCKET).upload(`${row.id}/${name}.webp`, buf, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });
          lastError = error;
          if (!error) break;
          await sleep(800 * (attempt + 1));
        }
        if (lastError) throw new Error(`upload ${row.id}/${name}: ${lastError.message}`);
      }
      row.image_large = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${row.id}/large.webp`;
      row.image_small = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${row.id}/small.webp`;
      row.phash = _phash ? `\\x${_phash}` : null;
      uploaded++;
    } else {
      imageless++;
    }
    return row;
  });

  for (let i = 0; i < ready.length; i += 50) {
    const { error } = await sb.from('pokemon_cards').insert(ready.slice(i, i + 50));
    if (error) throw new Error(`card insert (${ready[i].id}...): ${error.message}`);
  }
  console.log(`${setId}: inserted ${ready.length} cards (${uploaded} with mirrored art, ${imageless} imageless), ${held.size} already present${setRow ? '' : ', set row created'}`);
}

// ────────────────────────────────────────────────────────────────── main ───

const [mode, ...rest] = process.argv.slice(2);
const flags = rest.filter((a) => a.startsWith('--'));
const setIds = rest.filter((a) => !a.startsWith('--'));

(async () => {
  if (mode === 'build') {
    if (!setIds.length) throw new Error('build needs set ids');
    for (const id of setIds) await buildSet(id);
  } else if (mode === 'names') {
    await deriveNames();
  } else if (mode === 'commit') {
    if (!setIds.length) throw new Error('commit needs set ids');
    const dry = flags.includes('--dry-run');
    const key = dry ? (SECRET || PUBLISHABLE) : SECRET;
    if (!SUPABASE_URL || !key) throw new Error('commit needs SUPABASE_SECRET_KEY in the environment (see the header)');
    const sb = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
    for (const id of setIds) await commitSet(sb, id, dry);
  } else if (mode === 'logos' || mode === 'fill-names') {
    if (!SUPABASE_URL || !SECRET) throw new Error(`${mode} needs SUPABASE_SECRET_KEY in the environment (see the header)`);
    const sb = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });
    if (mode === 'logos') await fillLogos(sb, setIds); else await fillNames(sb, setIds);
  } else {
    console.error('usage: node scripts/ingest/jp-sun-moon-sets.mjs build|names|commit|logos|fill-names [SET_ID...] [--dry-run]');
    process.exit(1);
  }
})().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});
