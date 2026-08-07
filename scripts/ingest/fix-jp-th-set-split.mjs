/**
 * Repair the Thai/Japanese set-row collision created by the SWSH ingest.
 *
 * WHAT WENT WRONG: `pokemon_sets.id` is a single-column PK, so one code can hold
 * only one language's set row (CLAUDE.md, "Shared set codes across languages").
 * For these 19 codes the row belonged to the THAI product. The ingest's
 * `INSERT ... ON CONFLICT (id) DO UPDATE` therefore overwrote each Thai set row
 * with Japanese values instead of creating a Japanese one — Thai set names became
 * English ("VMAX ไคลแมกซ์" -> "VMAX Climax") and printed_total/total became the
 * Japanese counts. `language` stayed 'th', so the Japanese cards ended up hanging
 * off a Thai-language set row and no Japanese set row existed at all.
 *
 * THE FIX follows the established split (18 sets were done this way on
 * 2026-07-14, and SVK-th before them): the base code carries the JAPANESE set,
 * and the Thai product moves to `<CODE>-th`.
 *
 *   1. base row  -> language='ja'. Its current contents (English name, Japanese
 *      totals, Japanese release date) are already exactly right for the Japanese
 *      set, so only the language needs correcting.
 *   2. INSERT `<CODE>-th` rows carrying the Thai names, re-scraped from the
 *      official Thai site (asia.pokemon-card.com) — the same source the Thai
 *      catalog pipeline already uses. Nothing is translated or invented.
 *   3. Repoint Thai cards and set_bridge.thai_set_id at `<CODE>-th`.
 *
 * The scanner needs no change: tier 1's `set_id ILIKE '<code>%'` + language
 * filter resolves a printed "S8b" on a Thai card to S8b-th, exactly as it
 * already does for SVK-th.
 *
 * KNOWN LOSS: the Thai rows' original printed_total/total were overwritten and
 * are not recoverable from the DB, raw_data, or listing snapshots. The new -th
 * rows use our Thai card count for both, which is self-consistent but may differ
 * from the printed total (e.g. S12-th carries printed=98 with 125 cards). Exact
 * values would need a Supabase point-in-time restore.
 *
 *   node scripts/ingest/fix-jp-th-set-split.mjs          # report
 *   node scripts/ingest/fix-jp-th-set-split.mjs --sql    # emit repair SQL
 */
import fs from 'fs';
import path from 'path';
import { getSupabase, ROOT } from '../lib/thai-catalog.mjs';

const EMIT_SQL = process.argv.includes('--sql');
const sb = getSupabase();
const OUT_DIR = path.join(ROOT, 'scripts', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SETS = ['S5a', 'S5I', 'S5R', 'S6a', 'S6h', 's6k', 'S7D', 'S7R', 'S8', 'S8a',
              'S8b', 'S10a', 'S10b', 'S10D', 'S10P', 'S11', 'S11a', 'SVM', 'SH'];

const decode = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();

// Thai set names live in the expansion filter of the official Thai card search:
//   <input id="checkboxN" class="expansionCode" value="S8b"> <label for="checkboxN">VMAX ไคลแมกซ์</label>
async function scrapeThaiSetNames() {
  const res = await fetch('https://asia.pokemon-card.com/th/card-search/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  const html = await res.text();
  const byCode = new Map();
  for (const m of html.matchAll(
    /<input\s+id="(checkbox\d+)"[^>]*class="expansionCode"\s+value="([^"]+)"[^>]*>\s*<label for="\1">([^<]+)<\/label>/g
  )) {
    byCode.set(m[2].toLowerCase(), decode(m[3]));
  }
  return byCode;
}

const esc = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

(async () => {
  const names = await scrapeThaiSetNames();
  console.log(`scraped ${names.size} Thai set names from asia.pokemon-card.com\n`);

  const plan = [];
  for (const code of SETS) {
    // The site's casing differs from ours for two codes (S6h->S6H, s6k->S6K),
    // the same casing drift the image CDN has. Match case-insensitively.
    const thaiName = names.get(code.toLowerCase());
    const { count: thCards } = await sb.from('pokemon_cards').select('id', { count: 'exact', head: true })
      .eq('language', 'th').eq('set_id', code);
    const { count: jaCards } = await sb.from('pokemon_cards').select('id', { count: 'exact', head: true })
      .eq('language', 'ja').eq('set_id', code);
    const { data: setRow } = await sb.from('pokemon_sets').select('id,name,language,printed_total,release_date').eq('id', code);
    plan.push({ code, thaiName, thCards: thCards || 0, jaCards: jaCards || 0, base: setRow?.[0] || null });
    console.log(`  ${code.padEnd(6)} th=${String(thCards).padStart(4)} ja=${String(jaCards).padStart(4)}  base="${setRow?.[0]?.name ?? 'MISSING'}" (${setRow?.[0]?.language})  thaiName=${thaiName ? `"${thaiName}"` : '*** NOT FOUND ***'}`);
  }

  const missing = plan.filter((p) => !p.thaiName);
  if (missing.length) console.log(`\nWARNING: no Thai name for ${missing.map((m) => m.code).join(', ')} — those sets are skipped`);

  const usable = plan.filter((p) => p.thaiName && p.thCards > 0);
  console.log(`\nrepairable: ${usable.length} sets, ${usable.reduce((a, p) => a + p.thCards, 0)} Thai cards to repoint`);
  if (!EMIT_SQL) return;

  const L = [
    `-- Repair: split ${usable.length} shared set codes into base(ja) + <CODE>-th`,
    `-- Generated by scripts/ingest/fix-jp-th-set-split.mjs.`,
    `-- Fixes Thai set rows that the SWSH ingest overwrote with Japanese values.`,
    `-- Thai names re-scraped from asia.pokemon-card.com. Idempotent.`,
    'BEGIN;',
    '',
    '-- 1. The base rows now hold correct Japanese data; only the language is wrong.',
    `UPDATE pokemon_sets SET language = 'ja'`,
    `WHERE id IN (${usable.map((p) => esc(p.code)).join(', ')}) AND language <> 'ja';`,
    '',
    '-- 2. Recreate the Thai set rows under the -th suffix.',
    'INSERT INTO pokemon_sets (id, name, series, printed_total, total, release_date, language, game) VALUES',
    usable.map((p) =>
      `  (${esc(p.code + '-th')},${esc(p.thaiName)},'Pokémon (TH)',${p.thCards},${p.thCards},${esc(p.base?.release_date ?? null)},'th','pokemon')`
    ).join(',\n'),
    `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, language = 'th', series = EXCLUDED.series;`,
    '',
    '-- 3. Repoint the Thai cards.',
    ...usable.map((p) =>
      `UPDATE pokemon_cards SET set_id = ${esc(p.code + '-th')} WHERE language = 'th' AND set_id = ${esc(p.code)};`),
    '',
    '-- 4. Keep the pricing bridge pointing at the Thai set.',
    ...usable.map((p) =>
      `UPDATE set_bridge SET thai_set_id = ${esc(p.code + '-th')} WHERE thai_set_id = ${esc(p.code)};`),
    '',
    'COMMIT;',
    '',
  ];
  const file = path.join(OUT_DIR, 'fix-jp-th-set-split.sql');
  fs.writeFileSync(file, L.join('\n'), 'utf-8');
  console.log(`SQL -> ${path.relative(ROOT, file)}`);
})();
