/**
 * Slab Packs — mechanics check for the fixed-odds engine.
 *
 *   npx tsx scripts/check-slab-packs.ts
 *
 * Asserts, per tier: the class odds and the per-card odds each sum to 1, the
 * per-card odds of a class add up to that class's odds, every card sits
 * inside its class band, the floor holds, the average pull is near the
 * target, the table is deterministic, a draw is deterministic and verifies,
 * a tampered seed or commit fails, and 40k draws land on the published odds.
 * Exit 1 on any failure.
 */

import { buildTable, cardAt, commitFor, draw, verifyDraw } from '../lib/slabPacks/engine';
import { poolForGame } from '../lib/slabPacks/pool';
import { HIT_CLASSES, HIT_ORDER, PACK_GAMES, TARGET_EV, TIERS, TIER_ORDER } from '../lib/slabPacks/tiers';

let failures = 0;
function check(cond: boolean, msg: string) {
    if (!cond) {
        failures += 1;
        console.log(`  FAIL ${msg}`);
    }
}

const pctOf = (n: number) => `${(n * 100).toFixed(n * 100 >= 10 ? 0 : n * 100 >= 1 ? 1 : 2)}%`;
const N = 40_000;

for (const game of PACK_GAMES) for (const key of TIER_ORDER) {
    const tier = TIERS[key];
    const PREVIEW_POOL = poolForGame(game);
    const table = buildTable(game, tier, PREVIEW_POOL);
    console.log(`${game} ${tier.name} ฿${tier.priceThb.toLocaleString('en-US')}: avg ${pctOf(table.evThb / tier.priceThb)} of price, floor ฿${table.floorThb}, top ฿${table.topThb.toLocaleString('en-US')}, ${table.cards.length} cards`);
    console.log(`  odds ${HIT_ORDER.map((c) => `${HIT_CLASSES[c].letter} ${pctOf(tier.odds[c])} (${table.byClass[c].cards})`).join(' · ')}`);

    const sumClass = HIT_ORDER.reduce((s, c) => s + tier.odds[c], 0);
    check(Math.abs(sumClass - 1) < 1e-9, `class odds sum to ${sumClass}`);
    const sumCards = table.cards.reduce((s, c) => s + c.odds, 0);
    check(Math.abs(sumCards - 1) < 1e-9, `card odds sum to ${sumCards}`);
    for (const cls of HIT_ORDER) {
        const sum = table.cards.filter((c) => c.cls === cls).reduce((s, c) => s + c.odds, 0);
        check(Math.abs(sum - tier.odds[cls]) < 1e-9, `${cls} card odds sum to ${sum}, class odds ${tier.odds[cls]}`);
    }
    for (const c of table.cards) {
        const def = HIT_CLASSES[c.cls];
        const m = c.slab.valueThb / tier.priceThb;
        check(m >= def.min && m < def.max, `${c.slab.key} at ${m.toFixed(2)}x is outside ${c.cls} band`);
        check(c.odds > 0, `${c.slab.key} has zero odds`);
    }
    check(table.floorThb >= HIT_CLASSES.d.min * tier.priceThb, `floor ฿${table.floorThb} under ${HIT_CLASSES.d.min}x`);
    check(Math.abs(table.evThb / tier.priceThb - TARGET_EV) <= 0.08, `average ${pctOf(table.evThb / tier.priceThb)} is more than 8 points from the ${pctOf(TARGET_EV)} target`);
    check(table.cards.every((c, i) => i === 0 || table.cards[i - 1].slab.valueThb >= c.slab.valueThb), 'cards are not sorted best first');

    const again = buildTable(game, tier, PREVIEW_POOL);
    check(
        JSON.stringify(again.cards.map((c) => [c.slab.key, c.odds])) === JSON.stringify(table.cards.map((c) => [c.slab.key, c.odds])),
        'table is not deterministic',
    );

    const seed = `seed-${game}-${key}`;
    const client = 'client-1';
    const d1 = draw(table, seed, client);
    const d2 = draw(table, seed, client);
    check(d1.slabKey === d2.slabKey && d1.roll === d2.roll, 'draw is not deterministic');
    check(verifyDraw(table, seed, client, commitFor(seed), d1.slabKey), 'honest draw does not verify');
    check(!verifyDraw(table, `${seed}x`, client, commitFor(seed), d1.slabKey), 'wrong seed verifies');
    check(!verifyDraw(table, seed, client, commitFor('other'), d1.slabKey), 'wrong commit verifies');
    check(draw(table, seed, 'client-2').roll !== d1.roll, 'client seed has no effect');
    check(cardAt(table, 0).slab.key === table.cards[0].slab.key, 'roll 0 is not the first card');
    check(cardAt(table, 0.999999999).slab.key === table.cards[table.cards.length - 1].slab.key, 'roll ~1 is not the last card');

    const counts: Record<string, number> = {};
    for (const cls of HIT_ORDER) counts[cls] = 0;
    for (let i = 0; i < N; i++) counts[draw(table, `mc-${game}-${key}-${i}`, client).cls] += 1;
    for (const cls of HIT_ORDER) {
        const p = tier.odds[cls];
        const freq = counts[cls] / N;
        const sd = Math.sqrt((p * (1 - p)) / N);
        check(Math.abs(freq - p) <= 4 * sd + 1e-9, `${cls} came up ${pctOf(freq)} of ${N} draws against ${pctOf(p)} published`);
    }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
