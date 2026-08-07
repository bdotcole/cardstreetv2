/**
 * Ingest Japanese (language='ja') Pokemon sets that no existing source could reach.
 *
 * Why this exists: the Thai catalog reprints Japanese sets 1:1, and the Thai
 * english_name backfill resolves a Thai row through its Japanese twin. For the
 * Sword & Shield era those twins were never ingested, so ~1,612 Thai rows had no
 * English name and were invisible to English search. TCGdex — our usual ja source
 * — lists these sets but returns ZERO cards for every one of them (verified for
 * all 18 SWSH-era codes), so the twins had to come from elsewhere.
 *
 *   node scripts/ingest/limitless-jp-sets.mjs                 # dry-run, all sets
 *   node scripts/ingest/limitless-jp-sets.mjs --sets=S8b,S11  # subset
 *   node scripts/ingest/limitless-jp-sets.mjs --sql           # emit SQL
 *   node scripts/ingest/limitless-jp-sets.mjs --commit        # write directly
 *
 * Two sources, each for what it alone has:
 *   Limitless  card numbers, the printed JAPANESE name (page <title>), and
 *              images at a constructible CDN path
 *   JustTCG    the ENGLISH name + rarity per collector number (game
 *              `pokemon-japan`), which Limitless does not expose
 *
 * A card is only emitted when Limitless yields a Japanese name; english_name is
 * attached when JustTCG has that number and left null otherwise. Nothing is
 * translated or guessed — the same bar as backfill-ja-names.mjs.
 *
 * Images point at the Limitless CDN. The monthly mirror cron
 * (app/api/cron/mirror-images) pulls newly-ingested cards onto our own storage,
 * so that is the intended steady state, not a gap.
 *
 * Idempotent: rows are upserted by id, so a re-run refreshes rather than
 * duplicates. Sets whose cards already exist are skipped unless --force.
 */
import fs from 'fs';
import path from 'path';
import { getSupabase, ROOT } from '../lib/thai-catalog.mjs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const EMIT_SQL = args.includes('--sql');
const FORCE = args.includes('--force');
const ONLY = (args.find((a) => a.startsWith('--sets=')) || '').replace('--sets=', '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const sb = getSupabase();
const OUT_DIR = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

// The SWSH-era Japanese sets the Thai catalog reprints but our catalog lacked.
// S-P (Sword & Shield promos) is deliberately absent: Limitless 404s the promo
// path, and Thai promo numbering diverges from Japanese anyway (see the
// project_promo_pricing_catalog note), so a number-keyed twin match is unsafe there.
const SETS = ['S5a', 'S5I', 'S5R', 'S6a', 'S6h', 's6k', 'S7D', 'S7R', 'S8', 'S8a',
              'S8b', 'S10a', 'S10b', 'S10D', 'S10P', 'S11', 'S11a', 'SVM', 'SH'];

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad3 = (n) => String(n).padStart(3, '0');

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const res = await fetch(url, { headers: UA, signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch { /* retry */ }
    await sleep(500 * (i + 1));
  }
  return null;
}

// ------------------------------------------------------------- limitless ---
async function limitlessSet(code) {
  const html = await fetchText(`https://limitlesstcg.com/cards/jp/${code}`);
  if (!html) return null;
  // Match links generically then filter by code — building a regex out of the
  // set code breaks on codes like "S-P".
  const nums = new Set();
  for (const m of html.matchAll(/\/cards\/jp\/([A-Za-z0-9-]+)\/(\d+)/g)) {
    if (m[1].toLowerCase() === code.toLowerCase()) nums.add(Number(m[2]));
  }
  const heading = html.match(/<img class="set"[^>]*>\s*([^<]+)/)?.[1]?.trim() || '';
  return {
    // "VMAX Climax (S8b)" -> "VMAX Climax"
    name: heading.replace(/\s*\([^)]*\)\s*$/, '').trim() || code,
    releaseDate: parseDate(html.match(/<div class="infobox-line">\s*([^<•]+)•/)?.[1]?.trim()),
    numbers: [...nums].sort((a, b) => a - b),
  };
}

function parseDate(s) {
  if (!s) return null;
  // "3rd December 2021" -> 2021-12-03
  const m = s.match(/(\d{1,2})\w{0,2}\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const mi = months.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
}

// The page <title> is the cleanest carrier of the printed Japanese name:
//   "ビードル - VMAX Climax (S8b) #1 – Limitless"
async function limitlessCardName(code, n) {
  const html = await fetchText(`https://limitlesstcg.com/cards/jp/${code}/${n}`);
  if (!html) return null;
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || '';
  const name = title.split(' - ')[0].trim();
  if (!name || !/[぀-ヿ一-鿿]/.test(name)) return null;
  // Read the type off the card-text-type block ("Pokémon - Basic", "Trainer -
  // Supporter"). A page-wide /Pok[eé]mon/ test matches site chrome and labelled
  // 博士の研究 (a Supporter) as a Pokémon.
  const typeBlock = html.match(/class="card-text-type"[^>]*>([\s\S]{0,120}?)</)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const head = typeBlock.split(' - ')[0].trim();
  const supertype = /^Pok[eé]mon$/i.test(head) ? 'Pokémon'
    : /^Trainer$/i.test(head) ? 'Trainer'
    : /^Energy$/i.test(head) ? 'Energy' : null;
  return { name, supertype };
}

// --------------------------------------------------------------- justtcg ---
function justTcgEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf-8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trim().startsWith('#')) continue;
    let v = line.slice(i + 1).trim();
    env[line.slice(0, i).trim()] = v.replace(/^["']|["']$/g, '');
  }
  return env.JUSTTCG_API_KEY;
}
const JT_KEY = justTcgEnv();

async function justTcgSetIndex() {
  const res = await fetch('https://api.justtcg.com/v1/sets?game=pokemon-japan', { headers: { 'x-api-key': JT_KEY } });
  const j = await res.json();
  const byCode = new Map();
  for (const s of j.data || []) {
    // Names carry the code as a prefix: "S8b: VMAX Climax".
    const m = s.name.match(/^([A-Za-z0-9-]+):\s/);
    if (m) byCode.set(m[1].toLowerCase(), s);
  }
  return byCode;
}

// JustTCG decorates names with the collector number and a printing qualifier
// ("Mew - 002/028 (Mirror Holofoil)"), and lists several printings per number.
// Strip both, then keep the cleanest candidate per number.
function cleanEnglishName(raw) {
  return String(raw || '')
    .replace(/\s*-\s*\d+\/\d+/g, '')                                  // embedded collector number
    .replace(/\s*\([^)]*(?:holo|foil|reverse|mirror|edition)[^)]*\)/gi, '')  // printing qualifier
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// number -> { englishName, rarity }. Sealed rows carry number "N/A".
async function justTcgCards(setId) {
  const out = new Map();
  for (let offset = 0; ; offset += 100) {
    const url = `https://api.justtcg.com/v1/cards?game=pokemon-japan&set=${encodeURIComponent(setId)}&limit=100&offset=${offset}&include_price_history=false`;
    const res = await fetch(url, { headers: { 'x-api-key': JT_KEY } });
    if (!res.ok) break;
    const j = await res.json();
    for (const c of j.data || []) {
      const raw = String(c.number || '');
      if (!raw || raw === 'N/A') continue;
      const num = Number(raw.split('/')[0].replace(/[^0-9]/g, ''));
      if (!num) continue;
      const name = cleanEnglishName(c.name);
      if (!name) continue;
      const rarity = c.rarity && c.rarity !== 'None' ? c.rarity : null;
      const prev = out.get(num);
      // Prefer the base printing: an entry whose raw name needed no qualifier
      // stripped, and failing that the shortest cleaned name.
      const undecorated = name === String(c.name || '').trim();
      if (!prev || (undecorated && !prev.undecorated) || (undecorated === prev.undecorated && name.length < prev.englishName.length)) {
        out.set(num, { englishName: name, rarity: rarity ?? prev?.rarity ?? null, undecorated });
      } else if (prev && !prev.rarity && rarity) {
        prev.rarity = rarity;
      }
    }
    if (!j.meta?.hasMore) break;
    await sleep(1300);   // JustTCG rate limit, per the other ingest scripts
  }
  return out;
}

// ------------------------------------------------------------------ build ---
async function buildSet(code, jtIndex) {
  const meta = await limitlessSet(code);
  if (!meta || !meta.numbers.length) { console.log(`  ${code}: no Limitless data`); return null; }

  const jtSet = jtIndex.get(code.toLowerCase());
  const english = jtSet ? await justTcgCards(jtSet.id) : new Map();
  console.log(`  ${code}: ${meta.numbers.length} cards on Limitless, ${english.size} English names from JustTCG`);

  const cards = [];
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < meta.numbers.length) {
      const n = meta.numbers[i++];
      const info = await limitlessCardName(code, n);
      if (!info) continue;
      const en = english.get(n);
      cards.push({
        id: `${code}-${pad3(n)}`,
        name: info.name,
        english_name: en?.englishName ?? null,
        set_id: code,
        number: pad3(n),
        supertype: info.supertype,
        rarity: en?.rarity ?? null,
        language: 'ja',
        game: 'pokemon',
        image_small: `${CDN}/${code}/${code}_${n}_R_JP_SM.png`,
        image_large: `${CDN}/${code}/${code}_${n}_R_JP_LG.png`,
        raw_data: { source: 'limitless+justtcg', set: { id: code, name: meta.name, printedTotal: meta.numbers.length } },
      });
      await sleep(120);
    }
  }));
  cards.sort((a, b) => a.number.localeCompare(b.number));
  return {
    set: {
      id: code,
      name: meta.name,
      series: 'Pokémon (JP)',
      printed_total: meta.numbers.length,
      total: meta.numbers.length,
      release_date: meta.releaseDate,
      language: 'ja',
      game: 'pokemon',
    },
    cards,
  };
}

// ----------------------------------------------------------------- output ---
const esc = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

function emitSql(all) {
  const file = path.join(OUT_DIR, 'jp-swsh-sets.sql');
  const lines = [
    `-- Japanese SWSH-era set ingest: ${all.length} sets, ${all.reduce((a, s) => a + s.cards.length, 0)} cards`,
    `-- Generated by scripts/ingest/limitless-jp-sets.mjs. Idempotent (upsert by id).`,
    'BEGIN;',
  ];
  for (const { set } of all) {
    lines.push(
      `INSERT INTO pokemon_sets (id, name, series, printed_total, total, release_date, language, game) VALUES ` +
      `(${esc(set.id)}, ${esc(set.name)}, ${esc(set.series)}, ${set.printed_total}, ${set.total}, ${esc(set.release_date)}, 'ja', 'pokemon') ` +
      `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, printed_total = EXCLUDED.printed_total, total = EXCLUDED.total, release_date = COALESCE(EXCLUDED.release_date, pokemon_sets.release_date);`
    );
  }
  for (const { cards } of all) {
    for (const c of cards) {
      lines.push(
        `INSERT INTO pokemon_cards (id, name, english_name, set_id, number, supertype, rarity, language, game, image_small, image_large, raw_data) VALUES ` +
        `(${esc(c.id)}, ${esc(c.name)}, ${esc(c.english_name)}, ${esc(c.set_id)}, ${esc(c.number)}, ${esc(c.supertype)}, ${esc(c.rarity)}, 'ja', 'pokemon', ${esc(c.image_small)}, ${esc(c.image_large)}, ${esc(JSON.stringify(c.raw_data))}::jsonb) ` +
        `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, english_name = COALESCE(pokemon_cards.english_name, EXCLUDED.english_name), rarity = COALESCE(pokemon_cards.rarity, EXCLUDED.rarity), image_small = COALESCE(pokemon_cards.image_small, EXCLUDED.image_small), image_large = COALESCE(pokemon_cards.image_large, EXCLUDED.image_large);`
      );
    }
  }
  lines.push('COMMIT;', '');
  fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  console.log(`  SQL -> ${path.relative(ROOT, file)}`);
}

async function commit(all) {
  for (const { set, cards } of all) {
    const { error: se } = await sb.from('pokemon_sets').upsert(set, { onConflict: 'id' });
    if (se) { console.warn(`  ! set ${set.id}: ${se.message}`); continue; }
    for (let i = 0; i < cards.length; i += 200) {
      const { error } = await sb.from('pokemon_cards').upsert(cards.slice(i, i + 200), { onConflict: 'id' });
      if (error) console.warn(`  ! ${set.id} cards ${i}: ${error.message}`);
    }
    console.log(`  committed ${set.id}: ${cards.length} cards`);
  }
}

// ------------------------------------------------------------------- main ---
(async () => {
  const targets = ONLY.length ? ONLY : SETS;
  console.log(`JP SWSH set ingest -- ${COMMIT ? 'COMMIT' : 'DRY RUN'}${EMIT_SQL ? ' (+SQL)' : ''}\n${targets.length} sets\n`);

  const jtIndex = await justTcgSetIndex();
  console.log(`JustTCG: ${jtIndex.size} pokemon-japan sets carry a code prefix\n`);

  const all = [];
  for (const code of targets) {
    if (!FORCE) {
      const { count } = await sb.from('pokemon_cards').select('id', { count: 'exact', head: true })
        .eq('language', 'ja').eq('game', 'pokemon').eq('set_id', code);
      if (count) { console.log(`  ${code}: already has ${count} ja rows, skipping (--force to redo)`); continue; }
    }
    const built = await buildSet(code, jtIndex);
    if (built?.cards.length) {
      const withEn = built.cards.filter((c) => c.english_name).length;
      console.log(`  ${code}: built ${built.cards.length} cards (${withEn} with english_name)`);
      all.push(built);
    }
  }

  const totalCards = all.reduce((a, s) => a + s.cards.length, 0);
  const totalEn = all.reduce((a, s) => a + s.cards.filter((c) => c.english_name).length, 0);
  console.log(`\nTOTAL: ${all.length} sets, ${totalCards} cards, ${totalEn} with english_name`);

  fs.writeFileSync(path.join(OUT_DIR, 'jp-swsh-sets.json'), JSON.stringify(all, null, 1), 'utf-8');
  if (all.length && EMIT_SQL) emitSql(all);
  if (all.length && COMMIT) await commit(all);
})();
