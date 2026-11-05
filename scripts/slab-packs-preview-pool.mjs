/**
 * Slab Packs — rebuild the PREVIEW slab pool (lib/slabPacks/demoPool.ts).
 *
 *   node scripts/slab-packs-preview-pool.mjs            # dry run: prints the spread
 *   node scripts/slab-packs-preview-pool.mjs --write    # rewrites demoPool.ts
 *
 * Reads raw near-mint (Raw_NM) and PSA 10 / PSA 9 rows from market_values,
 * converts USD to THB at the app's fixed rate (constants.tsx
 * EXCHANGE_RATES.USD), keeps cards with mirrored art, and samples a spread
 * of values from the cheapest LIVE tier's D floor to the dearest LIVE tier's
 * SS ceiling so every class of every pack on sale has cards. Raw singles are
 * preferred (the low-price packs are built from singles); a slab fills a
 * bucket only where singles run thin. These are NOT cards Cardstreet owns;
 * when real inventory exists the table builder is fed from the inventory
 * table and this file goes away. Re-run when a tier goes live or a price
 * moves outside MIN_THB..MAX_THB.
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
// The live ladder's reach: Bronze's D floor (0.45 x 150) to Gold's SS ceiling (30 x 750).
// The coming-soon tiers (Platinum and up) are not stocked.
const MIN_THB = 68;
const MAX_THB = 22_500;
// Log-spaced value buckets and how many cards each may contribute, per game.
const BUCKETS = 20;
const PER_BUCKET = 10;
// Rows fetched per bucket per game before the mirrored-art filter.
const FETCH_PER_BUCKET = 400;
const GAMES = ['pokemon', 'onepiece', 'lorcana'];
// market_values has no game column; the id prefixes tell the games apart.
const GAME_FILTER = {
    lorcana: 'card_id=like.lorcana-*',
    onepiece: 'card_id=like.op-*',
    pokemon: 'card_id=not.like.lorcana-*&card_id=not.like.op-*',
};
const CONDITIONS = '("Raw_NM","PSA 10","PSA 9")';
const gradeOf = (condition) => (condition === 'PSA 10' ? 10 : condition === 'PSA 9' ? 9 : 'raw');

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

const lo = Math.log(MIN_THB);
const hi = Math.log(MAX_THB);
const bucketEdge = (b) => Math.round(Math.exp(lo + ((hi - lo) * b) / BUCKETS));

// One bounded fetch per bucket per game, instead of paging the whole table:
// the raw rows alone run to six figures. Heap order inside a bucket is as
// good as random for a sample.
console.log(`priced rows between ฿${MIN_THB} and ฿${MAX_THB}, ${BUCKETS} buckets x ${GAMES.length} games ...`);
const values = [];
for (let b = 0; b < BUCKETS; b++) {
    const from = (bucketEdge(b) / THB_PER_USD).toFixed(2);
    const to = (bucketEdge(b + 1) / THB_PER_USD).toFixed(2);
    for (const game of GAMES) {
        const rows = await rest(
            `market_values?select=card_id,condition,market_avg,currency,language&condition=in.${encodeURIComponent(CONDITIONS)}&currency=eq.USD&market_avg=gte.${from}&market_avg=lt.${to}&${GAME_FILTER[game]}&limit=${FETCH_PER_BUCKET}`,
        );
        values.push(...rows);
    }
}
console.log(`${values.length} priced rows fetched`);

// One row per card type (card + grade), highest value if duplicated across languages.
const byKey = new Map();
for (const v of values) {
    const grade = gradeOf(v.condition);
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
        `pokemon_cards?select=id,game,name,english_name,set_id,number,rarity,language,image_small,pokemon_sets(name,release_date)&id=in.(${batch})&game=in.(${GAMES.join(',')})`,
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
        game: c.game,
        name,
        setName: c.pokemon_sets?.name ?? c.set_id,
        number: String(c.number ?? ''),
        year: Number.isFinite(year) ? year : 0,
        lang,
        rarity: c.rarity ?? '',
    });
}
console.log(`${candidates.length} candidates with mirrored art`);

// Stratified sample per game: log-spaced buckets so the cheap end and the
// grails are both represented, raw singles first (then PSA 10, then 9), one
// grade per card where possible.
const gradeRank = (g) => (g === 'raw' ? 2 : g === 10 ? 1 : 0);
const bucketOf = (c) => Math.min(BUCKETS - 1, Math.floor(((Math.log(c.valueThb) - lo) / (hi - lo)) * BUCKETS));
const byGame = Object.fromEntries(GAMES.map((g) => [g, Array.from({ length: BUCKETS }, () => [])]));
for (const c of candidates) if (byGame[c.game]) byGame[c.game][bucketOf(c)].push(c);
function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
}
const picked = [];
const usedCards = new Set();
for (const game of GAMES) for (const bucket of byGame[game]) {
    bucket.sort((x, y) => gradeRank(y.grade) - gradeRank(x.grade) || seeded(x.cardId) - seeded(y.cardId));
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
picked.sort((x, y) => x.game.localeCompare(y.game) || x.valueThb - y.valueThb || x.cardId.localeCompare(y.cardId));

console.log(`picked ${picked.length} cards (${picked.filter((c) => c.grade === 'raw').length} raw singles):`);
for (let b = 0; b < BUCKETS; b++) {
    const from = bucketEdge(b);
    const to = bucketEdge(b + 1);
    const cells = GAMES.map((g) => `${g} ${picked.filter((c) => c.game === g && c.valueThb >= from && c.valueThb < to).length}/${byGame[g][b].length}`);
    console.log(`  ฿${String(from).padStart(7)} – ฿${String(to).padStart(7)}: ${cells.join('  ')}`);
}

if (!WRITE) {
    console.log('\ndry run; pass --write to rewrite lib/slabPacks/demoPool.ts');
    process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const esc = (s) => JSON.stringify(String(s));
const lines = picked.map(
    (c) => `  [${esc(c.cardId)},${c.grade === 'raw' ? '"raw"' : c.grade},${esc(c.name)},${esc(c.setName)},${esc(c.number)},${c.year},${esc(c.lang)},${esc(c.rarity)},${c.valueThb},${esc(c.game)}],`,
);
const file = `/**
 * PREVIEW card pool for the Slab Packs prototype (admin wall only).
 *
 * Real catalog cards with real market values (raw near-mint singles first,
 * PSA 9 / PSA 10 slabs where singles run thin), snapshotted from
 * market_values on ${today} and converted at the app's fixed USD rate
 * (constants.tsx EXCHANGE_RATES.USD). These are NOT cards Cardstreet owns —
 * the prototype has no inventory. When real inventory exists, the table
 * builder is fed from the inventory table instead and this file is deleted.
 *
 * Generated by scripts/slab-packs-preview-pool.mjs — do not edit by hand.
 *
 * Tuple: [cardId, grade ('raw' for a single), name, setName, number, year, lang, rarity, valueThb, game]
 */
export type DemoSlabRow = [string, 9 | 10 | 'raw', string, string, string, number, 'EN' | 'JP', string, number, 'pokemon' | 'onepiece' | 'lorcana'];

export const DEMO_POOL_SNAPSHOT_DATE = '${today}';

export const DEMO_POOL: DemoSlabRow[] = [
${lines.join('\n')}
];
`;
fs.writeFileSync(OUT, file);
console.log(`wrote ${OUT} (${picked.length} rows)`);
