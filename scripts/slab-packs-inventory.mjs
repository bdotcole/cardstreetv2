/**
 * Slab Packs — build lib/slabPacks/inventory.ts: the cards Cardstreet holds
 * for the packs, resolved against the catalog.
 *
 *   node scripts/slab-packs-inventory.mjs            # dry run: resolves and prints
 *   node scripts/slab-packs-inventory.mjs --write    # rewrites lib/slabPacks/inventory.ts
 *
 * ROWS is the founder's sourcing sheet
 * (docs/specs/digital-rips-card-ladder-2026-11-04.xlsx, filled 2026-11-07),
 * one entry per card type with the copies held. When more cards arrive, add
 * them here and re-run with --write, then `npx tsx scripts/check-slab-packs.ts`.
 *
 * Values are the sheet's market values (our own estimates for the Thai
 * cards, which the founder may raise). A value under MIN_VALUE_THB cannot go
 * in any pack on sale (Bronze ฿150 x the D floor 0.5 = ฿75, see
 * lib/slabPacks/tiers.ts), so it is raised to MIN_VALUE_THB and the row says
 * so. `en` supplies an English name where the catalog row has none.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
 * .env.local (the catalog is public-read).
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'lib/slabPacks/inventory.ts');
const WRITE = process.argv.includes('--write');
const MIN_VALUE_THB = 80;

// slots: the sheet rows the card came from. set / number / lang as printed
// on the card. qty: copies held. thb: the sheet's market value.
const ROWS = [
    { slots: [1], set: 'MA6', number: '068', lang: 'th', qty: 1, thb: 70, en: 'Mew ex' },
    { slots: [2], set: 'MA3', number: '209', lang: 'th', qty: 1, thb: 70 },
    { slots: [3], set: 'MA6', number: '064', lang: 'th', qty: 2, thb: 75 },
    { slots: [4], set: 'MA3', number: '114', lang: 'th', qty: 1, thb: 85 },
    { slots: [5], set: 'MA6', number: '140', lang: 'th', qty: 1, thb: 82, en: 'Drifloon' },
    { slots: [6], set: 'MA3', number: '126', lang: 'th', qty: 1, thb: 86 },
    { slots: [7], set: 'swshp', number: 'SWSH080', lang: 'en', qty: 1, thb: 87 },
    { slots: [8], set: 'MA3', number: '202', lang: 'th', qty: 1, thb: 90 },
    { slots: [9], set: 'MA6', number: '067', lang: 'th', qty: 1, thb: 87 },
    { slots: [10], set: 'MA3', number: '197', lang: 'th', qty: 1, thb: 98 },
    { slots: [11], set: 'MA6', number: '139', lang: 'th', qty: 1, thb: 101, en: 'Morpeko' },
    { slots: [12], set: 'MA3', number: '229', lang: 'th', qty: 1, thb: 104 },
    { slots: [13], set: 'MA5', number: '192', lang: 'th', qty: 1, thb: 99 },
    { slots: [14], set: 'MA3', number: '200', lang: 'th', qty: 1, thb: 107 },
    { slots: [15], set: 'MA6', number: '132', lang: 'th', qty: 1, thb: 120, en: 'Moltres' },
    { slots: [16], set: 'MA6', number: '147', lang: 'th', qty: 1, thb: 120, en: 'Zarude' },
    { slots: [17], set: 'MA6', number: '136', lang: 'th', qty: 1, thb: 120, en: 'Zapdos' },
    { slots: [18], set: 'MA6', number: '144', lang: 'th', qty: 1, thb: 123, en: 'Alolan Meowth' },
    { slots: [19], set: 'MA3', number: '075', lang: 'th', qty: 1, thb: 128 },
    { slots: [20], set: 'SV4a-th', number: '276', lang: 'th', qty: 1, thb: 128 },
    { slots: [21], set: 'swshp', number: 'SWSH135', lang: 'en', qty: 1, thb: 129 },
    { slots: [22], set: 'MA6', number: '150', lang: 'th', qty: 1, thb: 129 },
    { slots: [23], set: 'MA3', number: '196', lang: 'th', qty: 1, thb: 144 },
    { slots: [24], set: 'MA6', number: '186', lang: 'th', qty: 1, thb: 168 },
    { slots: [25], set: 'MA6', number: '137', lang: 'th', qty: 1, thb: 175 },
    { slots: [26], set: 'swshp', number: 'SWSH118', lang: 'en', qty: 1, thb: 179 },
    { slots: [27], set: 'swshp', number: 'SWSH119', lang: 'en', qty: 1, thb: 185 },
    { slots: [28], set: 'SV2D-th', number: '087', lang: 'th', qty: 1, thb: 189 },
    { slots: [29], set: 'svp', number: '163', lang: 'en', qty: 1, thb: 214 },
    { slots: [30], set: 'MA1', number: '151', lang: 'th', qty: 1, thb: 231 },
    { slots: [31], set: 'MA6', number: '146', lang: 'th', qty: 1, thb: 240, en: 'Galarian Meowth' },
    { slots: [32, 33], set: 'MA6', number: '178', lang: 'th', qty: 2, thb: 257 },
    { slots: [34], set: 'MA6', number: '193', lang: 'th', qty: 1, thb: 264, en: 'Raikou' },
    { slots: [35], set: 'MA6', number: '189', lang: 'th', qty: 1, thb: 270, en: 'Solgaleo GX' },
    { slots: [36], set: 'MA3', number: '205', lang: 'th', qty: 1, thb: 339 },
    { slots: [39], set: 'sv07', number: '151', lang: 'en', qty: 1, thb: 401 },
    { slots: [40], set: 'MA3', number: '223', lang: 'th', qty: 1, thb: 446 },
    { slots: [41], set: 'MA6', number: '175', lang: 'th', qty: 1, thb: 450, en: 'Dark Tyranitar' },
    { slots: [42, 43, 44, 45], set: 'hgss2', number: '13', lang: 'en', qty: 4, thb: 491 },
    { slots: [46], set: 'sv03', number: '207', lang: 'en', qty: 1, thb: 503 },
    { slots: [47], set: 'SV8s', number: '195', lang: 'th', qty: 1, thb: 574 },
    { slots: [50], set: 'MA6', number: '166', lang: 'th', qty: 1, thb: 1073, en: 'Mew ex' },
    { slots: [51], set: 'MA6', number: '159', lang: 'th', qty: 1, thb: 1111 },
    { slots: [52], set: 'smp', number: 'SM247', lang: 'en', qty: 1, thb: 1250 },
    { slots: [53], set: 'MA5', number: '225', lang: 'th', qty: 1, thb: 2773 },
    { slots: [54], set: 'bw9', number: '64', lang: 'en', qty: 1, thb: 3236 },
    { slots: [55], set: 'MA3', number: '234', lang: 'th', qty: 1, thb: 4835 },
    { slots: [56], set: 'MA3', number: '246', lang: 'th', qty: 1, thb: 8406 },
];

// Some Thai sets store the printed "NNN/total" string as the card number.
const PRINTED_TOTAL = { MA6: 130, MA5: 164, SV8s: 182, MA3: 193, MA1: 126, 'SV4a-th': 190, 'SV2D-th': 71 };

function loadEnv() {
    const out = {};
    for (const file of [path.join(ROOT, '.env.local'), path.join(ROOT, '..', '..', '..', '.env.local')]) {
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
            if (!m || out[m[1]]) continue;
            // Strip quotes, and the literal "\r\n" text some values carry.
            out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/\\[rn]/g, '').trim();
        }
    }
    return out;
}

const env = loadEnv();
const URL_BASE = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!URL_BASE || !KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    process.exit(1);
}

async function rest(table, params) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?${qs}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${table}?${qs}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

function numberVariants(number, setId) {
    const out = new Set([number]);
    if (/^\d+$/.test(number)) {
        out.add(String(Number(number)));
        out.add(number.padStart(3, '0'));
        if (PRINTED_TOTAL[setId]) out.add(`${number.padStart(3, '0')}/${PRINTED_TOTAL[setId]}`);
    }
    return [...out];
}

const SELECT = 'id,game,name,english_name,set_id,number,rarity,language,image_small,image_large,pokemon_sets(name,release_date)';
const items = [];
let failed = 0;
for (const row of ROWS) {
    const nums = numberVariants(row.number, row.set).map((v) => `"${v}"`).join(',');
    const rows = await rest('pokemon_cards', { select: SELECT, set_id: `eq.${row.set}`, number: `in.(${nums})`, language: `eq.${row.lang}` });
    if (rows.length !== 1) {
        failed += 1;
        console.log(`  !! slot ${row.slots.join(',')} ${row.set} ${row.number} (${row.lang}): ${rows.length} catalog rows`);
        continue;
    }
    const c = rows[0];
    if (!c.image_small || !c.image_large || !/supabase\.co\//.test(c.image_small)) {
        failed += 1;
        console.log(`  !! slot ${row.slots.join(',')} ${c.id}: no mirrored art`);
        continue;
    }
    const lang = c.language === 'th' ? 'TH' : c.language === 'ja' || c.language === 'jp' ? 'JP' : 'EN';
    const english = row.en ?? c.english_name ?? (lang === 'EN' ? c.name : null);
    if (!english) {
        failed += 1;
        console.log(`  !! slot ${row.slots.join(',')} ${c.id}: no English name; add en: to the row`);
        continue;
    }
    const year = c.pokemon_sets?.release_date ? Number(String(c.pokemon_sets.release_date).slice(0, 4)) : 0;
    const bumped = row.thb < MIN_VALUE_THB;
    items.push({
        cardId: c.id,
        grade: 'raw',
        name: english,
        localName: lang === 'EN' ? null : c.name,
        setName: c.pokemon_sets?.name ?? c.set_id,
        number: String(c.number).split('/')[0],
        year: Number.isFinite(year) ? year : 0,
        lang,
        rarity: c.rarity ?? '',
        valueThb: bumped ? MIN_VALUE_THB : row.thb,
        qty: row.qty,
        game: c.game,
        image: { small: c.image_small, large: c.image_large },
        note: bumped ? `sheet value ฿${row.thb}, raised to ฿${MIN_VALUE_THB} to clear the Bronze floor (฿75)` : undefined,
    });
}
items.sort((a, b) => a.valueThb - b.valueThb || a.cardId.localeCompare(b.cardId));

const copies = items.reduce((s, i) => s + i.qty, 0);
const value = items.reduce((s, i) => s + i.qty * i.valueThb, 0);
for (const i of items) {
    console.log(`${i.cardId.padEnd(38)} x${i.qty} ฿${String(i.valueThb).padStart(5)}  ${i.name}${i.localName ? ` (${i.localName})` : ''}  ${i.setName} #${i.number}${i.note ? `  [${i.note}]` : ''}`);
}
console.log(`\n${items.length} card types, ${copies} copies, ฿${value.toLocaleString('en-US')} at the sheet's values${failed ? `, ${failed} row(s) FAILED` : ''}`);
if (failed) process.exit(1);
if (!WRITE) {
    console.log('dry run; pass --write to rewrite lib/slabPacks/inventory.ts');
    process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const esc = (s) => JSON.stringify(String(s));
const lines = items.map((i) => {
    const fields = [
        `cardId: ${esc(i.cardId)}`,
        `grade: ${esc(i.grade)}`,
        `name: ${esc(i.name)}`,
        `localName: ${i.localName ? esc(i.localName) : 'null'}`,
        `setName: ${esc(i.setName)}`,
        `number: ${esc(i.number)}`,
        `year: ${i.year}`,
        `lang: ${esc(i.lang)}`,
        `rarity: ${esc(i.rarity)}`,
        `valueThb: ${i.valueThb}`,
        `qty: ${i.qty}`,
        `game: ${esc(i.game)}`,
        `image: { small: ${esc(i.image.small)}, large: ${esc(i.image.large)} }`,
    ];
    if (i.note) fields.push(`note: ${esc(i.note)}`);
    return `    { ${fields.join(', ')} },`;
});
const file = `/**
 * Slab Packs — the cards Cardstreet holds for the packs, one row per card
 * type with the copies in stock. Resolved against the catalog on ${today}
 * from the founder's sourcing sheet (docs/specs/digital-rips-card-ladder-2026-11-04.xlsx).
 *
 * Generated by scripts/slab-packs-inventory.mjs — do not edit by hand; add
 * the card to ROWS there and re-run with --write.
 *
 * Values are the sheet's market values (our own estimates for the Thai
 * cards). A value under the cheapest pack's floor was raised to it and the
 * row carries a note. The pool for the tables is built from this file in
 * pool.ts; the preview store counts copies down as they are pulled.
 */
import type { GameKey, Slab } from './types';

export interface InventoryItem {
    cardId: string;
    grade: Slab['grade'];
    /** English name, for the label and the lists. */
    name: string;
    /** The name printed on a Thai or Japanese card. */
    localName: string | null;
    setName: string;
    number: string;
    year: number;
    lang: Slab['lang'];
    rarity: string;
    valueThb: number;
    /** Copies held when the file was generated. */
    qty: number;
    game: GameKey;
    image: { small: string; large: string };
    note?: string;
}

export const INVENTORY_SNAPSHOT_DATE = '${today}';

export const INVENTORY: InventoryItem[] = [
${lines.join('\n')}
];
`;
fs.writeFileSync(OUT, file);
console.log(`wrote ${OUT} (${items.length} rows)`);
