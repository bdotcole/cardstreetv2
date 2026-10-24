/**
 * Slab Packs — rebuild the PREVIEW slab pool (lib/slabPacks/demoPool.ts).
 *
 *   node scripts/slab-packs-preview-pool.mjs            # dry run: prints the spread
 *   node scripts/slab-packs-preview-pool.mjs --write    # rewrites demoPool.ts
 *
 * Reads PSA 10 / PSA 9 rows from market_values, converts USD to THB at the
 * app's fixed rate (constants.tsx EXCHANGE_RATES.USD), keeps cards with
 * mirrored art, and samples a spread of values from the cheapest tier's D
 * floor to the dearest tier's SS ceiling so every class of every pack has
 * cards. These are NOT slabs Cardstreet owns; when real inventory exists the
 * table builder is fed from the inventory table and this file goes away.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from
 * .env.local (the tables are public-read). SUPABASE_SECRET_KEY, if set in the
 * environment, is used instead of the anon key.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'lib/slabPacks/demoPool.ts');
const WRITE = process.argv.includes('--write');

// constants.tsx: 1 THB = 0.028 USD.
const THB_PER_USD = 1 / 0.028;
// The ladder's reach: Silver's D floor (0.45 x 775) to Galaxy Opal's SS ceiling (30 x 15,500).
const MIN_THB = 340;
const MAX_THB = 470_000;
// Log-spaced value buckets and how many slabs each may contribute.
const BUCKETS = 26;
const PER_BUCKET = 16;

function loadEnv() {
    const out = {};
    for (const file of [path.join(ROOT, '.env.local'), path.join(ROOT, '..', '..', '..', '.env.local')]) {
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (!m || out[m[1]]) continue;
            // Strip quotes, and the literal "\r\n" text some values carry.
            out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/\\r\\n$/, '').replace(/\\n$/, '').trim();
        }
    }
    return out;
}

const env = loadEnv();
const URL_BASE = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_BASE || !KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
    process.exit(1);
}

async function rest(pathAndQuery, extraHeaders = {}) {
    const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...extraHeaders },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

/** Every page of a query, 1000 rows at a time (PostgREST's cap). */
async function all(pathAndQuery) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const page = await rest(pathAndQuery, { Range: `${from}-${from + 999}` });
        rows.push(...page);
        if (page.length < 1000) break;
    }
    return rows;
}

const minUsd = (MIN_THB / THB_PER_USD).toFixed(2);
const maxUsd = (MAX_THB / THB_PER_USD).toFixed(2);
console.log(`graded rows between $${minUsd} and $${maxUsd} ...`);
const values = await all(
    `market_values?select=card_id,condition,market_avg,currency,language&condition=in.(%22PSA%2010%22,%22PSA%209%22)&currency=eq.USD&market_avg=gte.${minUsd}&market_avg=lte.${maxUsd}&order=market_avg.desc`,
);
console.log(`${values.length} graded values`);

// One row per slab type (card + grade), highest value if duplicated across languages.
const byKey = new Map();
for (const v of values) {
    const grade = v.condition === 'PSA 10' ? 10 : 9;
    const key = `${v.card_id}:${grade}`;
    const thb = Math.round(Number(v.market_avg) * THB_PER_USD);
    if (!Number.isFinite(thb) || thb < MIN_THB || thb > MAX_THB) continue;
    const prev = byKey.get(key);
    if (!prev || prev.valueThb < thb) byKey.set(key, { cardId: v.card_id, grade, valueThb: thb });
}

// Card details, in batches: name, set, number, rarity, language, mirrored art.
const ids = [...new Set([...byKey.values()].map((s) => s.cardId))];
console.log(`${byKey.size} slab types over ${ids.length} cards; fetching card rows ...`);
const cards = new Map();
for (let i = 0; i < ids.length; i += 150) {
    const batch = ids.slice(i, i + 150).map((id) => `"${encodeURIComponent(id)}"`).join(',');
    const rows = await rest(
        `pokemon_cards?select=id,name,english_name,set_id,number,rarity,language,image_small,pokemon_sets(name,release_date)&id=in.(${batch})`,
    );
    for (const r of rows) cards.set(r.id, r);
}

const candidates = [];
for (const slab of byKey.values()) {
    const c = cards.get(slab.cardId);
    if (!c || !c.image_small || !/supabase\.co\//.test(c.image_small)) continue;
    const lang = c.language === 'ja' || c.language === 'jp' ? 'JP' : c.language === 'th' ? 'TH' : 'EN';
    if (lang === 'TH') continue;
    const name = (lang === 'JP' && c.english_name) || c.name;
    const year = c.pokemon_sets?.release_date ? Number(String(c.pokemon_sets.release_date).slice(0, 4)) : 0;
    candidates.push({
        ...slab,
        name,
        setName: c.pokemon_sets?.name ?? c.set_id,
        number: String(c.number ?? ''),
        year: Number.isFinite(year) ? year : 0,
        lang,
        rarity: c.rarity ?? '',
    });
}
console.log(`${candidates.length} candidates with mirrored art`);

// Stratified sample: log-spaced buckets so the cheap end and the grails are
// both represented, PSA 10 first, one grade per card where possible.
const lo = Math.log(MIN_THB);
const hi = Math.log(MAX_THB);
const buckets = Array.from({ length: BUCKETS }, () => []);
for (const c of candidates) {
    const b = Math.min(BUCKETS - 1, Math.floor(((Math.log(c.valueThb) - lo) / (hi - lo)) * BUCKETS));
    buckets[b].push(c);
}
function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
}
const picked = [];
const usedCards = new Set();
for (const bucket of buckets) {
    bucket.sort((x, y) => y.grade - x.grade || seeded(x.cardId) - seeded(y.cardId));
    let n = 0;
    for (const c of bucket) {
        if (n >= PER_BUCKET) break;
        if (usedCards.has(c.cardId)) continue;
        usedCards.add(c.cardId);
        picked.push(c);
        n += 1;
    }
    // A thin bucket may take a second grade of the same card rather than go empty.
    for (const c of bucket) {
        if (n >= Math.min(PER_BUCKET, 6)) break;
        if (picked.includes(c)) continue;
        picked.push(c);
        n += 1;
    }
}
picked.sort((x, y) => x.valueThb - y.valueThb || x.cardId.localeCompare(y.cardId));

console.log(`picked ${picked.length} slabs:`);
for (let b = 0; b < BUCKETS; b++) {
    const from = Math.round(Math.exp(lo + ((hi - lo) * b) / BUCKETS));
    const to = Math.round(Math.exp(lo + ((hi - lo) * (b + 1)) / BUCKETS));
    const n = picked.filter((c) => c.valueThb >= from && c.valueThb < to).length;
    console.log(`  ฿${String(from).padStart(7)} – ฿${String(to).padStart(7)}: ${n} (${buckets[b].length} available)`);
}

if (!WRITE) {
    console.log('\ndry run; pass --write to rewrite lib/slabPacks/demoPool.ts');
    process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const esc = (s) => JSON.stringify(String(s));
const lines = picked.map(
    (c) => `  [${esc(c.cardId)},${c.grade},${esc(c.name)},${esc(c.setName)},${esc(c.number)},${c.year},${esc(c.lang)},${esc(c.rarity)},${c.valueThb}],`,
);
const file = `/**
 * PREVIEW slab pool for the Slab Packs prototype (admin wall only).
 *
 * Real catalog cards with real PSA 9 / PSA 10 market values, snapshotted from
 * market_values on ${today} and converted at the app's fixed USD rate
 * (constants.tsx EXCHANGE_RATES.USD). These are NOT slabs Cardstreet owns —
 * the prototype has no inventory. When real inventory exists, the table
 * builder is fed from the inventory table instead and this file is deleted.
 *
 * Generated by scripts/slab-packs-preview-pool.mjs — do not edit by hand.
 *
 * Tuple: [cardId, grade, name, setName, number, year, lang, rarity, valueThb]
 */
export type DemoSlabRow = [string, 9 | 10, string, string, string, number, 'EN' | 'JP', string, number];

export const DEMO_POOL_SNAPSHOT_DATE = '${today}';

export const DEMO_POOL: DemoSlabRow[] = [
${lines.join('\n')}
];
`;
fs.writeFileSync(OUT, file);
console.log(`wrote ${OUT} (${picked.length} rows)`);
