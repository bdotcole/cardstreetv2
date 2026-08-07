/**
 * Backfill `english_name` for Thai and Japanese rows that lack it, so English
 * search ("pikachu") surfaces every language's printing of a card.
 *
 * Search matches `name OR english_name` (services/pokemonService.ts,
 * services/scannerService.ts tier-1b), so a th/ja row without english_name is
 * invisible to English queries. After the 2026-08 JA name fix, `name` on those
 * rows is (correctly) Japanese script — making english_name the only English
 * handle they have.
 *
 *   node scripts/backfill-english-names.mjs            # dry-run
 *   node scripts/backfill-english-names.mjs --sql      # emit chunked SQL
 *   node scripts/backfill-english-names.mjs --commit   # write directly
 *
 * Three deterministic phases. Nothing is machine-translated or guessed —
 * every fill traces to a verified pair in our own catalog or a pHash-verified
 * TCGdex twin. Unresolved rows are reported, not invented.
 *
 * 1. th-dict  — our own verified Thai pairs (th rows that already carry
 *    english_name) keyed by base name (suffix stripped). Ambiguous keys are
 *    dropped. Regional prefixes (ฮิซุย/อโลลา/กาลาร์/พาลเดีย/เมก้า) are
 *    resolved by looking up the bare species and re-attaching the English
 *    prefix, mirroring verified pairs like "อโลลา นัชชี ex" = "Alolan
 *    Exeggutor ex".
 * 2. th-twin  — orphan sets (S5*..S11*, S10P...) are Japanese set codes whose
 *    JA twin is absent from our catalog but present on TCGdex. TCGdex's EN
 *    localization of the twin gives the English name at the same collector
 *    number. Guarded exactly like backfill-thai-english-name.mjs: every pair
 *    is pHash-verified (Thai reprints keep the artwork; our th rows are ~100%
 *    hashed, the twin's art is hashed on the fly), pairs > MAX_TWIN_DIST bits
 *    are skipped, and a set with > SET_MISMATCH_FRAC mismatches is skipped
 *    wholesale (numbering premise broken — the SVK lesson).
 * 3. ja-dict  — ja pokemon rows with a Japanese name but no english_name,
 *    filled from our own ja pairs (same Japanese name elsewhere in the
 *    catalog) with PokeAPI species as the tie-breaker source.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getSupabase, ROOT } from './lib/thai-catalog.mjs';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const EMIT_SQL = args.includes('--sql');

const sb = getSupabase();
const OUT_DIR = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MAX_TWIN_DIST = 14;      // same gate as backfill-thai-english-name.mjs
const SET_MISMATCH_FRAC = 0.3;

const UA = { 'User-Agent': 'Mozilla/5.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ hashing --
const hexToBytes = (h) => {
  const s = h.startsWith('\\x') ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};
const POP = new Uint8Array(256);
for (let i = 0; i < 256; i++) POP[i] = (i & 1) + POP[i >> 1];
const phashDist = (aHex, bBuf) => {
  if (!aHex || !bBuf) return null;
  const a = hexToBytes(aHex);
  if (a.length !== bBuf.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[a[i] ^ bBuf[i]];
  return d;
};
// Same dHash as scripts/backfill-phashes.mjs / lib/phash.ts.
async function computeDHash(imageBuffer) {
  const buf = await sharp(imageBuffer).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const hash = Buffer.alloc(8);
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      if (buf[row * 9 + col] > buf[row * 9 + col + 1]) byte |= 1 << (7 - col);
    }
    hash[row] = byte;
  }
  return hash;
}

async function fetchJson(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    const res = await fetch(url, { headers: UA, signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
async function fetchBuffer(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    const res = await fetch(url, { headers: UA, signal: ctl.signal });
    clearTimeout(t);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch { return null; }
}

async function fetchRows(filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from('pokemon_cards').select('id, name, english_name, set_id, number, phash').order('id').range(from, from + 999);
    q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ------------------------------------------------------------ name plumbing --
// Trailing Latin gameplay suffix on a Thai/Japanese name (เรจิเอเลคิV has no
// space; แบล็กคิวเรม ex does). VMAX/VSTAR before V so the longer token wins.
const SUFFIX_RE = /\s*(VMAX|VSTAR|GX|BREAK|ex|EX|V)\s*$/;
const splitSuffix = (s) => {
  const m = (s || '').match(SUFFIX_RE);
  return m ? { base: s.slice(0, m.index).trim(), suffix: m[1] } : { base: (s || '').trim(), suffix: '' };
};
const withSuffix = (en, suffix) => (suffix ? `${en} ${suffix}` : en);

// Thai regional/mega prefixes -> English card-name prefixes, per verified pairs
// ("อโลลา นัชชี ex" = "Alolan Exeggutor ex").
const TH_PREFIXES = [
  ['ฮิซุย', 'Hisuian'],
  ['อโลลา', 'Alolan'],
  ['กาลาร์', 'Galarian'],
  ['พาลเดีย', 'Paldean'],
  ['เมก้า', 'Mega'],
];

// --------------------------------------------------------------- th phases --
async function resolveThai() {
  const all = await fetchRows((q) => q.eq('language', 'th'));
  const have = all.filter((r) => r.english_name);
  const missing = all.filter((r) => !r.english_name);
  console.log(`  th rows ${all.length}: ${have.length} with english_name, ${missing.length} missing`);

  // Dictionary from our own verified pairs, base-name keyed, ambiguity-safe.
  const dict = new Map();
  const ambiguous = new Set();
  for (const r of have) {
    const k = splitSuffix(r.name).base;
    const v = splitSuffix(r.english_name).base;
    if (!k || !v) continue;
    if (dict.has(k) && dict.get(k).toLowerCase() !== v.toLowerCase()) ambiguous.add(k);
    else dict.set(k, v);
  }
  for (const k of ambiguous) dict.delete(k);
  console.log(`  th-dict: ${dict.size} entries (${ambiguous.size} ambiguous dropped)`);

  const lookupThai = (name) => {
    const { base, suffix } = splitSuffix(name);
    if (dict.has(base)) return withSuffix(dict.get(base), suffix);
    for (const [th, en] of TH_PREFIXES) {
      if (base.startsWith(th)) {
        const bare = base.slice(th.length).trim();
        if (dict.has(bare)) return withSuffix(`${en} ${dict.get(bare)}`, suffix);
      }
    }
    return null;
  };

  const fixes = [];
  let rest = [];
  for (const r of missing) {
    const en = lookupThai(r.name);
    if (en) fixes.push({ id: r.id, en, via: 'th-dict' });
    else rest.push(r);
  }
  console.log(`  th-dict resolved ${fixes.length}, ${rest.length} left for twin lookup`);

  // ---- th-twin: TCGdex EN localization of the JA twin set, pHash-verified ----
  const bySet = new Map();
  for (const r of rest) {
    if (!bySet.has(r.set_id)) bySet.set(r.set_id, []);
    bySet.get(r.set_id).push(r);
  }

  const stillUnresolved = [];
  for (const [setId, rows] of bySet) {
    // The catalog stores the printed JA code for these sets (S10P, S8b...) —
    // strip a -th suffix if present (SVK-th precedent).
    const twinCode = setId.replace(/-th$/i, '');
    const setData = await fetchJson(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(twinCode)}`);
    if (!setData?.cards?.length) { stillUnresolved.push(...rows); continue; }

    const stripNum = (n) => String(n || '').split('/')[0].replace(/^0+/, '') || '0';
    const byNum = new Map();
    for (const c of setData.cards) byNum.set(stripNum(c.localId), c);

    // pHash-verify each pair; count mismatches for the wholesale gate.
    let ok = 0, bad = 0;
    const candidates = [];
    const pool = rows.filter((r) => byNum.has(stripNum(r.number)));
    let i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < pool.length) {
        const r = pool[i++];
        const twin = byNum.get(stripNum(r.number));
        if (!twin.image || !r.phash) { bad++; continue; }
        const img = await fetchBuffer(`${twin.image}/low.webp`);
        if (!img) { bad++; continue; }
        let d = null;
        try { d = phashDist(r.phash, await computeDHash(img)); } catch { /* corrupt image */ }
        if (d !== null && d <= MAX_TWIN_DIST) { ok++; candidates.push({ id: r.id, en: twin.name, via: 'tcgdex-twin', dist: d }); }
        else bad++;
      }
    }));

    const total = ok + bad;
    if (total > 0 && bad / total > SET_MISMATCH_FRAC) {
      console.log(`  th-twin ${setId}: SKIPPED wholesale (${bad}/${total} pairs failed pHash — numbering premise broken)`);
      stillUnresolved.push(...rows);
    } else {
      fixes.push(...candidates);
      const matchedIds = new Set(candidates.map((c) => c.id));
      stillUnresolved.push(...rows.filter((r) => !matchedIds.has(r.id)));
      if (candidates.length) console.log(`  th-twin ${setId}: ${candidates.length}/${rows.length} verified (${bad} rejected)`);
    }
    await sleep(150);
  }

  return { fixes, unresolved: stillUnresolved };
}

// --------------------------------------------------------------- ja phase --
async function resolveJa() {
  const all = await fetchRows((q) => q.eq('language', 'ja').eq('game', 'pokemon'));
  const missing = all.filter((r) => !r.english_name);
  console.log(`  ja pokemon rows ${all.length}: ${missing.length} missing english_name`);

  const dict = new Map();
  const ambiguous = new Set();
  for (const r of all) {
    if (!r.english_name) continue;
    const k = splitSuffix(r.name).base;
    const v = splitSuffix(r.english_name).base;
    if (!k || !v || !/[぀-ヿ一-鿿]/.test(k)) continue;
    if (dict.has(k) && dict.get(k).toLowerCase() !== v.toLowerCase()) ambiguous.add(k);
    else dict.set(k, v);
  }
  for (const k of ambiguous) dict.delete(k);
  console.log(`  ja-dict: ${dict.size} entries (${ambiguous.size} ambiguous dropped)`);

  const fixes = [];
  const unresolved = [];
  for (const r of missing) {
    const { base, suffix } = splitSuffix(r.name);
    if (dict.has(base)) fixes.push({ id: r.id, en: withSuffix(dict.get(base), suffix), via: 'ja-dict' });
    else unresolved.push(r);
  }
  return { fixes, unresolved };
}

// ------------------------------------------------------------------ output --
const sqlEsc = (s) => String(s).replace(/'/g, "''");

function emitSql(label, fixes) {
  const CHUNK = 3000;
  const chunks = [];
  for (let i = 0; i < fixes.length; i += CHUNK) chunks.push(fixes.slice(i, i + CHUNK));
  chunks.forEach((chunk, i) => {
    const suffix = chunks.length > 1 ? `-${String(i + 1).padStart(2, '0')}` : '';
    const file = path.join(OUT_DIR, `english-names-${label}${suffix}.sql`);
    fs.writeFileSync(file, [
      `-- english_name backfill (${label}) -- part ${i + 1}/${chunks.length}, ${chunk.length} rows`,
      `-- Generated by scripts/backfill-english-names.mjs. Idempotent: only fills NULL/empty.`,
      'BEGIN;',
      'UPDATE pokemon_cards AS p',
      '   SET english_name = v.en',
      'FROM (VALUES',
      chunk.map((f) => `  ('${sqlEsc(f.id)}','${sqlEsc(f.en)}')`).join(',\n'),
      ') AS v(id, en)',
      "WHERE p.id = v.id AND (p.english_name IS NULL OR p.english_name = '');",
      'COMMIT;',
      '',
    ].join('\n'), 'utf-8');
    console.log(`  SQL -> ${path.relative(ROOT, file)} (${chunk.length} rows)`);
  });
}

async function commitFixes(fixes) {
  let n = 0;
  for (const f of fixes) {
    const { error } = await sb.from('pokemon_cards')
      .update({ english_name: f.en }).eq('id', f.id).is('english_name', null);
    if (error) console.warn(`  ! ${f.id}: ${error.message}`);
    else if (++n % 500 === 0) console.log(`  ...wrote ${n}/${fixes.length}`);
  }
  console.log(`  committed ${n} rows`);
}

// -------------------------------------------------------------------- main --
(async () => {
  console.log(`english_name backfill -- ${COMMIT ? 'COMMIT' : 'DRY RUN'}${EMIT_SQL ? ' (+SQL)' : ''}\n`);

  console.log('=== thai ===');
  const th = await resolveThai();
  const thVia = th.fixes.reduce((a, f) => ((a[f.via] = (a[f.via] || 0) + 1), a), {});
  console.log(`  RESOLVED ${th.fixes.length} ${JSON.stringify(thVia)} | UNRESOLVED ${th.unresolved.length}`);

  console.log('\n=== ja pokemon ===');
  const ja = await resolveJa();
  console.log(`  RESOLVED ${ja.fixes.length} | UNRESOLVED ${ja.unresolved.length}`);

  for (const [label, r] of [['thai', th], ['ja', ja]]) {
    if (r.unresolved.length) {
      const file = path.join(OUT_DIR, `english-names-${label}-unresolved.json`);
      fs.writeFileSync(file, JSON.stringify(r.unresolved.map(({ phash, ...x }) => x), null, 2), 'utf-8');
      console.log(`  ${label} unresolved -> ${path.relative(ROOT, file)}`);
    }
    if (r.fixes.length && EMIT_SQL) emitSql(label, r.fixes);
    if (r.fixes.length && COMMIT) await commitFixes(r.fixes);
  }
})();
