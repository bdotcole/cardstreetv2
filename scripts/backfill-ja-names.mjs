/**
 * Backfill Japanese card names for `language='ja'` rows that were ingested with
 * English (or machine-translated) names.
 *
 * The Japanese catalog was ingested from English-first sources, so most JA rows
 * carry a Latin `name`. Yu-Gi-Oh (15.5k) and One Piece (3k) are 100% English;
 * vintage Pokemon (E/PCG/PMCG/neo/web/VS eras) is a mix of English and literal
 * machine translations that are simply wrong as card names -- "Venusaur" became
 * 金星 (the planet Venus), "Blastoise" became 爆風 ("blast wind"), "Spearow"
 * became 槍 ("spear"). Those are worse than English: they are plausible-looking
 * Japanese that no card actually prints.
 *
 *   node scripts/backfill-ja-names.mjs                        # dry-run, all games
 *   node scripts/backfill-ja-names.mjs --game=pokemon         # one game
 *   node scripts/backfill-ja-names.mjs --game=pokemon --sql   # emit SQL for the SQL Editor
 *   node scripts/backfill-ja-names.mjs --game=pokemon --commit
 *
 * The English name is never destroyed: before `name` is overwritten it is moved
 * into `english_name` when that column is empty. English search of JA cards keeps
 * working, and the scanner's name tier matches on both columns.
 *
 * Sources, in priority order -- all authoritative, nothing invented. A name is
 * only written when a source returns it; unresolved rows are reported, not
 * guessed. (Guessing is what produced 金星 in the first place.)
 *
 *   pokemon  TCGdex /v2/ja (card-level, keyed by our own card id)
 *            -> PokeAPI pokemon-species (species-level, authoritative kana)
 *   yugioh   YGOPRODeck bulk dump for konami_id -> Konami's official OCG database
 *            (db.yugioh-card.com, request_locale=ja) -- the printed JP name
 *   onepiece onepiece-cardgame.com/cardlist (Bandai's official JP card list)
 *
 * Yu-Gi-Oh is a per-card scrape of Konami's DB: ~15.5k requests, rate-limited to
 * be polite, so it takes hours. It caches every resolved name to
 * scripts/out/ja-names-konami-cache.json and is fully resumable -- re-running
 * picks up where it stopped and costs nothing for names already cached.
 */
import fs from 'fs';
import path from 'path';
import { getSupabase, ROOT } from './lib/thai-catalog.mjs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const EMIT_SQL = args.includes('--sql');
const GAME = (args.find((a) => a.startsWith('--game=')) || '--game=all').split('=')[1];
const LIMIT = Number((args.find((a) => a.startsWith('--limit=')) || '--limit=0').split('=')[1]) || 0;

const sb = getSupabase();
const OUT_DIR = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const KANA = /[぀-ヿ]/;                 // hiragana or katakana
const HAN = /[一-鿿]/;                  // kanji
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Names are scraped out of HTML, so entities arrive raw ("キッド&amp;キラー").
const decodeEntities = (s) =>
  String(s || '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, ' ');

const isJapaneseName = (s) => KANA.test(s || '') || HAN.test(s || '');

/**
 * Does this name need replacing? Kanji means different things per game:
 *
 * - Pokemon requires KANA. Every machine-translation artifact in the catalog is
 *   kanji-only (金星 for Venusaur, 爆風 for Blastoise, 槍 for Spearow) because a
 *   translator maps the English word to its kanji gloss, while genuine Pokemon
 *   names are katakana. So kanji-only is treated as broken.
 * - One Piece and Yu-Gi-Oh accept kanji. Kanji-only names are perfectly normal
 *   there (光月日和 = Kouzuki Hiyori), so demanding kana would reject the real
 *   printed name and leave the row in English.
 */
const isBadName = (s, game) => (game === 'pokemon' ? !KANA.test(s || '') : !isJapaneseName(s));

/**
 * Accept a candidate from a source only if it would not itself be flagged as bad.
 *
 * This is not belt-and-braces: TCGdex is where the Pokemon mistranslations came
 * from in the first place, so it happily returns 金星 for Venusaur. Without this
 * gate the backfill "resolves" those rows to the exact value it was sent to
 * replace. Making acceptance the mirror of rejection also makes the whole script
 * idempotent -- it can never write a value that a re-run would flag again.
 */
const isAcceptable = (s, game) => !!s && !isBadName(s, game);

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
    await sleep(600 * (i + 1));
  }
  return null;
}
const fetchJson = async (url) => {
  const t = await fetchText(url);
  try { return t ? JSON.parse(t) : null; } catch { return null; }
};

// Page through every matching row; PostgREST caps a single response at 1000.
async function fetchRows(game) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pokemon_cards')
      .select('id, name, english_name, set_id, number')
      .eq('language', 'ja')
      .eq('game', game)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------- pokemon ---
async function resolvePokemon(rows) {
  const targets = rows.filter((r) => isBadName(r.name, 'pokemon'));
  console.log(`  ${rows.length} ja rows, ${targets.length} needing a Japanese name`);

  // 1) TCGdex, keyed by our own card id (ids match 1:1 for these sets).
  const sets = [...new Set(targets.map((r) => r.set_id).filter(Boolean))];
  const byId = {};
  for (const s of sets) {
    const j = await fetchJson(`https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(s)}`);
    for (const c of j?.cards || []) byId[c.id] = c.name;
  }
  console.log(`  TCGdex: indexed ${Object.keys(byId).length} JA cards across ${sets.length} sets`);

  const fixes = [];
  const rest = [];
  for (const r of targets) {
    const t = byId[r.id];
    if (isAcceptable(t, 'pokemon')) fixes.push({ ...r, ja: t, via: 'tcgdex' });
    else rest.push(r);
  }

  // 2) PokeAPI species names. The species token is authoritative kana; an "ex"
  //    suffix is re-attached in the JP convention (no space) after the lookup.
  const parse = (r) => {
    let base = (r.english_name || r.name || '').trim();
    let suffix = '';
    const m = base.match(/^(.*?)[\s-]*(ex|EX|GX|V|VMAX)$/);
    if (m && m[1].trim()) { base = m[1].trim(); suffix = m[2].toLowerCase() === 'ex' ? 'ex' : m[2]; }
    if (/^rocket'?s\s/i.test(base)) return null;   // owner-prefixed; not a plain species
    let slug = base.toLowerCase().replace(/['.’]/g, '').replace(/\s+/g, '-');
    slug = slug.replace(/^nidoranf$/, 'nidoran-f').replace(/^nidoranm$/, 'nidoran-m')
               .replace(/^nidoran-female$/, 'nidoran-f').replace(/^nidoran-male$/, 'nidoran-m')
               .replace(/^mr-mime$/, 'mr-mime').replace(/^farfetchd$/, 'farfetchd');
    return slug ? { slug, suffix } : null;
  };

  const wanted = [...new Set(rest.map((r) => parse(r)?.slug).filter(Boolean))];
  const species = {};
  let i = 0;
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (i < wanted.length) {
      const slug = wanted[i++];
      const j = await fetchJson(`https://pokeapi.co/api/v2/pokemon-species/${slug}`);
      const ja = (j?.names || []).find((n) => n.language.name === 'ja')
              || (j?.names || []).find((n) => n.language.name === 'ja-hrkt');
      if (isAcceptable(ja?.name, 'pokemon')) species[slug] = ja.name;
    }
  }));
  console.log(`  PokeAPI: resolved ${Object.keys(species).length}/${wanted.length} species`);

  const unresolved = [];
  for (const r of rest) {
    const p = parse(r);
    const base = p && species[p.slug];
    if (base) fixes.push({ ...r, ja: base + (p.suffix || ''), via: p.suffix ? 'pokeapi+suffix' : 'pokeapi' });
    else unresolved.push(r);
  }
  return { fixes, unresolved };
}

// ----------------------------------------------------------------- yugioh ---
async function resolveYugioh(rows) {
  const targets = rows.filter((r) => isBadName(r.name, 'yugioh'));
  console.log(`  ${rows.length} ja rows, ${targets.length} needing a Japanese name`);

  // One bulk request gives konami_id for the entire English card pool.
  const bulk = await fetchJson('https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes');
  const konamiByName = new Map();
  // Our YGO ingest mangled some names: quotes and angle brackets were dropped
  // (Maxx "C" -> Maxx C, Maliss <P> March Hare -> Maliss P March Hare) and some
  // non-ASCII glyphs became "?" (Fiendish Engine Ω -> Fiendish Engine ?). A
  // punctuation-insensitive key recovers those. Ambiguous keys (two distinct cards
  // collapsing to the same one) are dropped rather than guessed.
  const loose = new Map();
  const ambiguous = new Set();
  const normLoose = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const c of bulk?.data || []) {
    const cid = c.misc_info?.[0]?.konami_id;
    if (!cid) continue;
    konamiByName.set(c.name.toLowerCase(), cid);
    const k = normLoose(c.name);
    if (loose.has(k) && loose.get(k) !== cid) ambiguous.add(k);
    else loose.set(k, cid);
  }
  for (const k of ambiguous) loose.delete(k);
  console.log(`  YGOPRODeck: ${konamiByName.size} cards carry a konami_id (${loose.size} loose keys, ${ambiguous.size} ambiguous dropped)`);

  const cachePath = path.join(OUT_DIR, 'ja-names-konami-cache.json');
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf-8')) : {};
  const save = () => fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');

  // Konami prints the JP name inside the #cardname block, after a furigana <span>:
  //   <h1 id="cardname" ...> <span>ちょうでんじタートル</span> 超電磁タートル <span>Electromagnetic Turtle</span>
  const parseKonami = (html) => {
    const block = html.match(/id="cardname"[\s\S]{0,600}?<\/h1>/i)?.[0];
    if (!block) return null;
    const stripped = block.replace(/<span[^>]*class="?ruby[^>]*>[\s\S]*?<\/span>/gi, '');
    const text = decodeEntities(stripped.replace(/<[^>]+>/g, '\n'))
      .split('\n').map((s) => s.trim()).filter(Boolean);
    // The printed name is the first line that is Japanese and is not pure furigana
    // (furigana is all-kana; the real name almost always carries kanji or katakana).
    const cands = text.filter((s) => KANA.test(s) || HAN.test(s));
    if (!cands.length) return null;
    return cands.find((s) => HAN.test(s)) || cands[cands.length - 1] || null;
  };

  const fixes = [];
  const unresolved = [];
  let done = 0;
  const pool = LIMIT ? targets.slice(0, LIMIT) : targets;
  for (const r of pool) {
    const en = r.english_name || r.name || '';
    const cid = konamiByName.get(en.toLowerCase()) ?? loose.get(normLoose(en));
    if (!cid) { unresolved.push(r); continue; }
    let ja = cache[cid];
    if (ja === undefined) {
      const html = await fetchText(
        `https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=${cid}&request_locale=ja`
      );
      ja = html ? parseKonami(html) : null;
      cache[cid] = ja;
      if (++done % 25 === 0) { save(); console.log(`  ...${done}/${pool.length} scraped`); }
      await sleep(350);   // be a good citizen against Konami's DB
    }
    if (isAcceptable(ja, 'yugioh')) fixes.push({ ...r, ja, via: 'konami' });
    else unresolved.push(r);
  }
  save();
  return { fixes, unresolved };
}

// --------------------------------------------------------------- onepiece ---
async function resolveOnePiece(rows) {
  const targets = rows.filter((r) => isBadName(r.name, 'onepiece'));
  console.log(`  ${rows.length} ja rows, ${targets.length} needing a Japanese name`);

  const index = await fetchText('https://www.onepiece-cardgame.com/cardlist/');
  const seriesIds = [...(index || '').matchAll(/<option value="(\d+)"/g)].map((m) => m[1]);
  console.log(`  Bandai JP: ${seriesIds.length} series to walk`);

  const byCode = {};
  for (const s of seriesIds) {
    const html = await fetchText(`https://www.onepiece-cardgame.com/cardlist/?series=${s}`);
    for (const m of (html || '').matchAll(
      /<dl class="modalCol" id="([^"]+)">[\s\S]*?<div class="cardName">([\s\S]*?)<\/div>/g
    )) {
      const name = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
      if (name) byCode[m[1].trim().toUpperCase()] = name;
    }
    await sleep(200);
  }
  console.log(`  Bandai JP: indexed ${Object.keys(byCode).length} cards`);

  // Our ids namespace the printed code: "op-eb-01-jp-eb01-017" -> "EB01-017".
  // Numbers are not always zero-padded in our ids ("...-eb02-32"), but Bandai always
  // prints three digits, so pad before looking up.
  const codeOf = (r) => {
    const m = String(r.id).toUpperCase().match(/([A-Z]{1,4}\d{2})-(\d{1,3})(?!\d)/);
    if (m) return `${m[1]}-${m[2].padStart(3, '0')}`;
    const n = String(r.number || '').toUpperCase().match(/([A-Z]{1,4}\d{2})-(\d{1,3})(?!\d)/);
    return n ? `${n[1]}-${n[2].padStart(3, '0')}` : null;
  };

  const fixes = [];
  const unresolved = [];
  for (const r of targets) {
    const ja = byCode[codeOf(r)];
    if (isAcceptable(ja, 'onepiece')) fixes.push({ ...r, ja, via: 'bandai-jp' });
    else unresolved.push(r);
  }
  return { fixes, unresolved };
}

// ------------------------------------------------------------------ apply ---
const sqlEsc = (s) => String(s).replace(/'/g, "''");

async function applyFixes(game, fixes) {
  // Preserve the English name before overwriting `name`, so English search of JA
  // cards (and the scanner's name tier, which matches both columns) keeps working.
  const rowsToWrite = fixes.map((f) => ({
    id: f.id,
    ja: f.ja,
    keepEnglish: !f.english_name && !isJapaneseName(f.name) ? f.name : null,
  }));

  if (EMIT_SQL) {
    // One bulk UPDATE ... FROM (VALUES ...) per chunk rather than one statement per
    // row: 14.7k individual UPDATEs is 2.25MB and times out in the Supabase SQL
    // Editor. Chunked so each file is a manageable paste.
    const CHUNK = 3000;
    const chunks = [];
    for (let i = 0; i < rowsToWrite.length; i += CHUNK) chunks.push(rowsToWrite.slice(i, i + CHUNK));
    const multi = chunks.length > 1;

    chunks.forEach((chunk, i) => {
      const suffix = multi ? `-${String(i + 1).padStart(2, '0')}` : '';
      const file = path.join(OUT_DIR, `ja-names-${game}${suffix}.sql`);
      const values = chunk
        .map((r) => `  ('${sqlEsc(r.id)}','${sqlEsc(r.ja)}','${sqlEsc(r.keepEnglish || '')}')`)
        .join(',\n');
      fs.writeFileSync(file, [
        `-- Japanese name backfill for ${game} (language='ja')`,
        `-- Part ${i + 1} of ${chunks.length} -- ${chunk.length} rows. Run parts in any order.`,
        `-- Generated by scripts/backfill-ja-names.mjs. Idempotent: safe to re-run.`,
        `-- english_name is only filled where empty, so the English name is never lost.`,
        'BEGIN;',
        'UPDATE pokemon_cards AS p',
        '   SET name = v.ja,',
        "       english_name = COALESCE(p.english_name, NULLIF(v.en, ''))",
        'FROM (VALUES',
        values,
        ') AS v(id, ja, en)',
        'WHERE p.id = v.id;',
        'COMMIT;',
        '',
      ].join('\n'), 'utf-8');
      console.log(`  SQL -> ${path.relative(ROOT, file)} (${chunk.length} rows)`);
    });
  }

  if (!COMMIT) return;
  let n = 0;
  for (const r of rowsToWrite) {
    const patch = { name: r.ja };
    if (r.keepEnglish) patch.english_name = r.keepEnglish;
    const { error } = await sb.from('pokemon_cards').update(patch).eq('id', r.id);
    if (error) console.warn(`  ! ${r.id}: ${error.message}`);
    else if (++n % 250 === 0) console.log(`  ...wrote ${n}/${rowsToWrite.length}`);
  }
  console.log(`  committed ${n} rows`);
}

// ------------------------------------------------------------------- main ---
const RESOLVERS = { pokemon: resolvePokemon, yugioh: resolveYugioh, onepiece: resolveOnePiece };

(async () => {
  const games = GAME === 'all' ? Object.keys(RESOLVERS) : [GAME];
  console.log(`Japanese name backfill -- ${COMMIT ? 'COMMIT' : 'DRY RUN'}${EMIT_SQL ? ' (+SQL)' : ''}\n`);

  for (const game of games) {
    if (!RESOLVERS[game]) { console.warn(`unknown game "${game}"`); continue; }
    console.log(`=== ${game} ===`);
    const rows = await fetchRows(game);
    const { fixes, unresolved } = await RESOLVERS[game](rows);

    const byVia = fixes.reduce((a, f) => ((a[f.via] = (a[f.via] || 0) + 1), a), {});
    console.log(`  RESOLVED ${fixes.length}  ${JSON.stringify(byVia)}`);
    console.log(`  UNRESOLVED ${unresolved.length}`);
    console.log(fixes.slice(0, 8).map((f) => `    ${f.id}  "${f.name}" -> ${f.ja}  [${f.via}]`).join('\n'));

    if (unresolved.length) {
      const file = path.join(OUT_DIR, `ja-names-${game}-unresolved.json`);
      fs.writeFileSync(file, JSON.stringify(unresolved, null, 2), 'utf-8');
      console.log(`  unresolved list -> ${path.relative(ROOT, file)}`);
    }
    if (fixes.length) await applyFixes(game, fixes);
    console.log('');
  }
})();
