/**
 * Second half of the SWSH-era Japanese set ingest.
 *
 * Takes scripts/out/jp-swsh-sets.json (produced by limitless-jp-sets.mjs), and:
 *   1. computes a dHash for every new Japanese card from its Limitless image,
 *      so the rows land already hashed — the Thai twin match and the scanner
 *      both need `phash`, and hashing at insert avoids a second pass over the
 *      catalog later;
 *   2. pHash-verifies each Thai row against the Japanese card at the same
 *      (set, number) and derives the Thai `english_name` from the verified twin.
 *
 * The verification is the same gate as backfill-thai-english-name.mjs and exists
 * for the same reason: a Thai product can share a set code with a Japanese one
 * yet be a different, renumbered lineup (the SVK incident mislabeled 22/27 rows
 * that way). A Thai reprint keeps the artwork, so a true pair lands within
 * MAX_TWIN_DIST bits; pairs beyond it are dropped, and a set where more than
 * SET_MISMATCH_FRAC of hashed pairs disagree is dropped whole.
 *
 *   node scripts/ingest/jp-sets-phash-and-twin.mjs          # dry-run + report
 *   node scripts/ingest/jp-sets-phash-and-twin.mjs --sql    # emit both SQL files
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getSupabase, ROOT } from '../lib/thai-catalog.mjs';

const EMIT_SQL = process.argv.includes('--sql');
const sb = getSupabase();
const OUT_DIR = path.join(ROOT, 'scripts', 'out');

const MAX_TWIN_DIST = 14;        // same gate as backfill-thai-english-name.mjs
const SET_MISMATCH_FRAC = 0.3;
const CONCURRENCY = 8;

const hexToBytes = (h) => {
  const s = h.startsWith('\\x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};
const POP = new Uint8Array(256);
for (let i = 0; i < 256; i++) POP[i] = (i & 1) + POP[i >> 1];
const dist = (aHex, bHex) => {
  if (!aHex || !bHex) return null;
  const a = hexToBytes(aHex), b = hexToBytes(bHex);
  if (a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[a[i] ^ b[i]];
  return d;
};

// Identical to scripts/backfill-phashes.mjs and lib/phash.ts.
async function computeDHash(buf) {
  const px = await sharp(buf).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const hash = Buffer.alloc(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) if (px[row * 9 + col] > px[row * 9 + col + 1]) byte |= 1 << (7 - col);
    hash[row] = byte;
  }
  return '\\x' + hash.toString('hex');
}

async function fetchBuffer(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30000);
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404) return null;
    } catch { /* retry */ }
  }
  return null;
}

const esc = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const numKey = (n) => String(n || '').split('/')[0].replace(/[^0-9]/g, '').replace(/^0+/, '') || '0';

const CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';
const imgUrl = (code, n, size) => `${CDN}/${code}/${code}_${n}_R_JP_${size}.png`;

// Limitless's CDN path casing does not always match the set code in its page
// URLs: S6h's images live under S6H and s6k's under S6K, while S6a's really are
// S6a. Getting this wrong 403s every image in the set — it cost exactly the 166
// unhashed cards on the first run, and would have stored dead image URLs. Probe
// once per set and rewrite that set's URLs to whatever actually answers.
async function resolveCdnCode(code, sampleN) {
  const variants = [...new Set([code, code.toUpperCase(), code.toLowerCase()])];
  for (const v of variants) {
    try {
      const r = await fetch(imgUrl(v, sampleN, 'LG'), { method: 'HEAD' });
      if (r.ok) return v;
    } catch { /* try next */ }
  }
  return null;
}

(async () => {
  const sets = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'jp-swsh-sets.json'), 'utf-8'));

  for (const s of sets) {
    const first = s.cards[0];
    if (!first) continue;
    const sampleN = Number(first.number);
    const cdn = await resolveCdnCode(s.set.id, sampleN);
    if (!cdn) { console.log(`  ${s.set.id}: no CDN casing answers — images unavailable`); continue; }
    if (cdn !== s.set.id) console.log(`  ${s.set.id}: CDN path is "${cdn}" — rewriting image URLs`);
    for (const c of s.cards) {
      const n = Number(c.number);
      c.image_small = imgUrl(cdn, n, 'SM');
      c.image_large = imgUrl(cdn, n, 'LG');
    }
  }

  const allCards = sets.flatMap((s) => s.cards);
  console.log(`hashing ${allCards.length} Japanese cards from ${sets.length} sets...`);

  let i = 0, hashed = 0, failed = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < allCards.length) {
      const c = allCards[i++];
      const buf = await fetchBuffer(c.image_large) || await fetchBuffer(c.image_small);
      if (!buf) { failed++; continue; }
      try { c.phash = await computeDHash(buf); hashed++; } catch { failed++; }
      if (hashed % 200 === 0 && hashed) console.log(`  ...${hashed}/${allCards.length}`);
    }
  }));
  console.log(`hashed ${hashed}, failed ${failed}\n`);

  // ---- Thai twin verification -------------------------------------------
  const thBySet = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('pokemon_cards')
      .select('id, name, english_name, set_id, number, phash')
      .eq('game', 'pokemon').eq('language', 'th').order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data.length) break;
    for (const r of data) {
      if (!thBySet.has(r.set_id)) thBySet.set(r.set_id, []);
      thBySet.get(r.set_id).push(r);
    }
    if (data.length < 1000) break;
  }

  const thaiFixes = [];
  console.log('Thai twin verification (pHash-gated):');
  for (const s of sets) {
    const thRows = thBySet.get(s.set.id) || [];
    if (!thRows.length) continue;
    const jaByNum = new Map(s.cards.map((c) => [numKey(c.number), c]));

    let ok = 0, bad = 0;
    const candidates = [];
    for (const th of thRows) {
      const ja = jaByNum.get(numKey(th.number));
      if (!ja || !ja.phash || !th.phash) continue;
      const d = dist(th.phash, ja.phash);
      if (d === null) continue;
      if (d <= MAX_TWIN_DIST) {
        ok++;
        if (!(th.english_name || '').trim() && ja.english_name) {
          candidates.push({ id: th.id, en: ja.english_name, d });
        }
      } else bad++;
    }
    const total = ok + bad;
    if (total && bad / total > SET_MISMATCH_FRAC) {
      console.log(`  ${s.set.id.padEnd(6)} SKIPPED — ${bad}/${total} pairs failed pHash (numbering premise broken)`);
      continue;
    }
    thaiFixes.push(...candidates);
    console.log(`  ${s.set.id.padEnd(6)} ${String(ok).padStart(3)}/${total} pairs verified, ${candidates.length} english_name fills`);
  }
  console.log(`\nThai english_name fills available: ${thaiFixes.length}`);

  if (!EMIT_SQL) return;

  // ---- SQL: japanese cards ----------------------------------------------
  // Multi-row VALUES in chunks: one statement per row was 1.7MB / 1,914
  // statements, which the Supabase SQL Editor will not run.
  const CARD_COLS = 'id, name, english_name, set_id, number, supertype, rarity, language, game, image_small, image_large, phash, raw_data';
  const CARD_UPSERT =
    'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, ' +
    'english_name = COALESCE(pokemon_cards.english_name, EXCLUDED.english_name), ' +
    'rarity = COALESCE(pokemon_cards.rarity, EXCLUDED.rarity), ' +
    'phash = COALESCE(pokemon_cards.phash, EXCLUDED.phash), ' +
    'image_small = EXCLUDED.image_small, image_large = EXCLUDED.image_large;';
  const cardRow = (c) =>
    `  (${esc(c.id)},${esc(c.name)},${esc(c.english_name)},${esc(c.set_id)},${esc(c.number)},${esc(c.supertype)},` +
    `${esc(c.rarity)},'ja','pokemon',${esc(c.image_small)},${esc(c.image_large)},` +
    `${c.phash ? `${esc(c.phash)}::bytea` : 'NULL'},${esc(JSON.stringify(c.raw_data))}::jsonb)`;

  const CHUNK = 500;
  const chunks = [];
  for (let k = 0; k < allCards.length; k += CHUNK) chunks.push(allCards.slice(k, k + CHUNK));

  chunks.forEach((chunk, ci) => {
    const file = path.join(OUT_DIR, `jp-swsh-sets-${String(ci + 1).padStart(2, '0')}.sql`);
    const L = [
      `-- Japanese SWSH-era ingest -- part ${ci + 1}/${chunks.length}, ${chunk.length} cards`,
      `-- Generated by scripts/ingest/jp-sets-phash-and-twin.mjs. Idempotent (upsert by id).`,
      `-- Run parts in order: part 1 creates the sets that the cards reference.`,
      'BEGIN;',
    ];
    if (ci === 0) {
      L.push('INSERT INTO pokemon_sets (id, name, series, printed_total, total, release_date, language, game) VALUES');
      L.push(sets.map(({ set }) =>
        `  (${esc(set.id)},${esc(set.name)},${esc(set.series)},${set.printed_total},${set.total},${esc(set.release_date)},'ja','pokemon')`
      ).join(',\n'));
      L.push('ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, printed_total = EXCLUDED.printed_total,',
             '  total = EXCLUDED.total, release_date = COALESCE(EXCLUDED.release_date, pokemon_sets.release_date);');
    }
    L.push(`INSERT INTO pokemon_cards (${CARD_COLS}) VALUES`);
    L.push(chunk.map(cardRow).join(',\n'));
    L.push(CARD_UPSERT, 'COMMIT;', '');
    fs.writeFileSync(file, L.join('\n'), 'utf-8');
    console.log(`SQL -> ${path.relative(ROOT, file)} (${chunk.length} cards)`);
  });
  // Remove the old single-file output so a stale 1.7MB copy can't be run by mistake.
  const stale = path.join(OUT_DIR, 'jp-swsh-sets.sql');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);

  // ---- SQL: thai english_name -------------------------------------------
  if (thaiFixes.length) {
    const thFile = path.join(OUT_DIR, 'thai-english-from-jp-twin.sql');
    fs.writeFileSync(thFile, [
      `-- Thai english_name from the newly ingested Japanese twins -- ${thaiFixes.length} rows`,
      `-- Every pair pHash-verified within ${MAX_TWIN_DIST} bits. Run AFTER jp-swsh-sets.sql.`,
      'BEGIN;',
      'UPDATE pokemon_cards AS p SET english_name = v.en',
      'FROM (VALUES',
      thaiFixes.map((f) => `  (${esc(f.id)},${esc(f.en)})`).join(',\n'),
      ') AS v(id, en)',
      "WHERE p.id = v.id AND (p.english_name IS NULL OR p.english_name = '');",
      'COMMIT;',
      '',
    ].join('\n'), 'utf-8');
    console.log(`SQL -> ${path.relative(ROOT, thFile)} (${thaiFixes.length} rows)`);
  }
})();
