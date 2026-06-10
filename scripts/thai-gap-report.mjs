/**
 * Thai catalog coverage / gap report.
 *
 * Reconciles three sources of truth:
 *   1. Thai Set Tracker CSV        -> the universe of Thai sets that exist
 *   2. Pokemon Cards Master List   -> per-card Thai checklist (derivable source)
 *   3. pokemon_sets / pokemon_cards -> what is actually loaded in the DB
 *
 * Classifies every Thai set as MISSING / PARTIAL / PLACEHOLDER / COMPLETE and
 * routes it to the cheapest ingestion source. Read-only; writes a report to
 * scripts/out/.
 *
 * Usage: node scripts/thai-gap-report.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// --- env (quote-stripping, per CLAUDE.md) ---
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// --- helpers ---
const THAI = /[฀-๿]/;
const JP = /[぀-ヿ一-鿿]/; // kana + CJK
const norm = (s) => (s || '').trim().toUpperCase();
const baseNum = (n) => String(n || '').trim().split('/')[0].replace(/^0+/, '') || '0'; // "003/182" -> "3"

// quote-aware comma split (tracker)
function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// sniff tab vs comma per line (master list is mixed: comma header, tab data)
function splitSmart(line) {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs >= commas ? line.split('\t').map((s) => s.trim()) : splitCsvLine(line);
}

// --- load tracker (the universe) ---
const trackerPath = path.join(root, 'lib', 'thai database', 'Thai Set Tracker - Main (1).csv');
const trackerLines = fs.readFileSync(trackerPath, 'utf-8').split('\n').map((l) => l.replace(/\r/g, '')).filter(Boolean);
const tracker = []; // {id, thaiName, enName, enEquiv, printedTotal, total, release}
for (let i = 1; i < trackerLines.length; i++) {
  const c = splitCsvLine(trackerLines[i]);
  if (!c[0]) continue;
  tracker.push({
    id: c[0].trim(),
    thaiName: c[1] || '',
    enName: c[2] || '',
    enEquiv: c[3] || '',
    printedTotal: parseInt(c[4]) || 0,
    total: parseInt(c[5]) || 0,
    release: c[6] || '',
  });
}

// --- load master list (per-card derivable source) ---
const masterPath = path.join(root, 'lib', 'thai database', 'Pokemon Cards Master List Complete - Sheet1 (1).csv');
const masterLines = fs.readFileSync(masterPath, 'utf-8').split('\n').map((l) => l.replace(/\r/g, '')).filter(Boolean);
const masterBySet = new Map(); // SETID(upper) -> Set of base card numbers
for (let i = 1; i < masterLines.length; i++) {
  const c = splitSmart(masterLines[i]);
  // columns: game, Set(thai name), Set ID, name, English Name, card #, rarity, image_url
  const setId = norm(c[2]);
  const num = baseNum(c[5]);
  if (!setId) continue;
  if (!masterBySet.has(setId)) masterBySet.set(setId, new Set());
  masterBySet.get(setId).add(num);
}

// --- load the TRUE universe from the official site's expansion <select> ---
// The tracker only enumerates main numbered releases; the official dropdown is
// the authoritative census (includes promos, trainer decks, sub-sets).
let officialCodes = [];
try {
  const html = await fetch('https://asia.pokemon-card.com/th/card-search/list/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  }).then((r) => r.text());
  const codes = new Set();
  for (const m of html.matchAll(/value="([A-Za-z][A-Za-z0-9]{0,6})"/g)) {
    const v = m[1];
    if (v === 'all' || v === 'none') continue;
    if (/[A-Za-z]/.test(v)) codes.add(v); // skip pure numbers (page-size dropdowns)
  }
  officialCodes = [...codes];
} catch (e) {
  console.error('Could not fetch official expansion list:', e.message);
}
const officialByNorm = new Map(officialCodes.map((c) => [norm(c), c]));

// --- load DB state ---
const { data: dbSets } = await supabase.from('pokemon_sets').select('id, language').eq('language', 'th');
const dbSetIds = new Set((dbSets || []).map((s) => norm(s.id)));

// pull all th cards (6.6k rows; paginate to be safe)
let cards = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('pokemon_cards')
    .select('set_id, number, name, english_name, image_small, image_large')
    .eq('language', 'th')
    .range(from, from + 999);
  if (error) { console.error('card fetch error:', error.message); process.exit(1); }
  cards = cards.concat(data);
  if (!data || data.length < 1000) break;
}

// aggregate loaded cards by set
const loaded = new Map(); // SETID -> {numbers:Set, placeholder:int, noImage:int, total:int}
for (const c of cards) {
  const sid = norm(c.set_id);
  if (!loaded.has(sid)) loaded.set(sid, { numbers: new Set(), placeholder: 0, noImage: 0, total: 0 });
  const e = loaded.get(sid);
  e.total++;
  e.numbers.add(baseNum(c.number));
  const nm = c.name || '';
  const isPlaceholder = !THAI.test(nm) && (JP.test(nm) || nm.trim() === (c.english_name || '').trim() || nm.trim() === '');
  if (isPlaceholder) e.placeholder++;
  if (!c.image_small && !c.image_large) e.noImage++;
}

// --- classify ---
const rows = [];
for (const t of tracker) {
  const sid = norm(t.id);
  const l = loaded.get(sid);
  const loadedCount = l ? l.numbers.size : 0;
  const loadedRows = l ? l.total : 0;
  const masterCount = masterBySet.has(sid) ? masterBySet.get(sid).size : 0;
  const placeholder = l ? l.placeholder : 0;
  const noImage = l ? l.noImage : 0;
  // expected distinct cards: prefer master-list checklist, else tracker printed_total
  const expected = masterCount || t.printedTotal || 0;

  let status;
  if (loadedRows === 0) status = 'MISSING';
  else if (expected && loadedCount < expected * 0.95) status = 'PARTIAL';
  else if (placeholder > 0 && placeholder / loadedRows > 0.1) status = 'PLACEHOLDER';
  else status = 'COMPLETE';

  // route to cheapest source
  let route;
  if (status === 'COMPLETE') route = '-';
  else if (masterCount > 0) route = 'CSV-derive';
  else route = 'scrape/agent';

  rows.push({
    id: t.id, enEquiv: t.enEquiv, release: t.release, status, route,
    loaded: loadedCount, expected, master: masterCount, placeholder, noImage,
  });
}

// orphans: th sets/cards in DB but not in tracker
const trackerIds = new Set(tracker.map((t) => norm(t.id)));
const orphanSets = [...dbSetIds].filter((id) => !trackerIds.has(id));
const orphanCardSets = [...loaded.keys()].filter((id) => !trackerIds.has(id));

// --- output ---
const order = { MISSING: 0, PARTIAL: 1, PLACEHOLDER: 2, COMPLETE: 3 };
rows.sort((a, b) => order[a.status] - order[b.status] || (b.release || '').localeCompare(a.release || ''));

const counts = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

let out = '';
out += `# Thai catalog gap report\n\n`;
out += `Generated ${new Date().toISOString()}\n\n`;
out += `Tracker universe: ${tracker.length} Thai sets | DB th sets: ${dbSetIds.size} | DB th cards: ${cards.length}\n`;
out += `Master-list checklist covers: ${masterBySet.size} sets\n\n`;
out += `Status: ` + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ') + `\n\n`;

const header = `${pad('SET', 8)} ${pad('EN EQUIVALENT', 26)} ${pad('RELEASE', 11)} ${pad('STATUS', 12)} ${pad('ROUTE', 13)} ${lpad('LOAD', 5)} ${lpad('EXP', 5)} ${lpad('CSV', 5)} ${lpad('PLHLD', 6)} ${lpad('NOIMG', 6)}`;
out += header + '\n' + '-'.repeat(header.length) + '\n';
for (const r of rows) {
  out += `${pad(r.id, 8)} ${pad(r.enEquiv.slice(0, 25), 26)} ${pad(r.release, 11)} ${pad(r.status, 12)} ${pad(r.route, 13)} ${lpad(r.loaded, 5)} ${lpad(r.expected, 5)} ${lpad(r.master, 5)} ${lpad(r.placeholder, 6)} ${lpad(r.noImage, 6)}\n`;
}

if (orphanSets.length || orphanCardSets.length) {
  out += `\n## Orphans (in DB, not in tracker)\n`;
  out += `sets: ${orphanSets.join(', ') || 'none'}\n`;
  out += `card-only set_ids: ${orphanCardSets.join(', ') || 'none'}\n`;
}

// --- universe diff: official site codes vs what is loaded ---
if (officialCodes.length) {
  const trackerNorm = new Set(tracker.map((t) => norm(t.id)));
  const missing = []; // official codes with zero loaded cards
  for (const [n, orig] of officialByNorm) {
    const l = loaded.get(n);
    const loadedCount = l ? l.numbers.size : 0;
    if (loadedCount === 0) missing.push({ code: orig, inTracker: trackerNorm.has(n) });
  }
  missing.sort((a, b) => a.code.localeCompare(b.code));
  out += `\n## Universe diff: official site vs DB\n`;
  out += `Official expansion codes on asia.pokemon-card.com/th: ${officialCodes.length}\n`;
  out += `Loaded with cards in DB: ${officialCodes.filter((c) => (loaded.get(norm(c))?.numbers.size || 0) > 0).length}\n`;
  out += `MISSING from DB (zero cards): ${missing.length}\n\n`;
  out += missing.map((m) => `${m.code}${m.inTracker ? ' (in tracker, not loaded)' : ''}`).join('\n') + '\n';
}

// machine-readable CSV
let csv = 'set_id,en_equivalent,release,status,route,loaded_distinct,expected,master_checklist,placeholder_rows,no_image_rows\n';
for (const r of rows) {
  csv += `${r.id},"${r.enEquiv}",${r.release},${r.status},${r.route},${r.loaded},${r.expected},${r.master},${r.placeholder},${r.noImage}\n`;
}

const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'thai-gap-report.md'), out);
fs.writeFileSync(path.join(outDir, 'thai-gap-report.csv'), csv);

console.log(out);
console.log(`\nWritten: scripts/out/thai-gap-report.md and .csv`);
