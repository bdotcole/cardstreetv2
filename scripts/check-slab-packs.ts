/**
 * Slab Packs — mechanics check for the fixed-odds engine.
 *
 *   npx tsx scripts/check-slab-packs.ts
 *
 * Asserts, per tier: the class odds and the per-card odds each sum to 1, the
 * per-card odds of a class add up to that class's odds, every card sits
 * inside its class band, the floor holds, the table is deterministic, a draw
 * is deterministic and verifies, a tampered seed or commit fails, and 40k
 * draws land on the published odds. The stock itself: every card has copies
 * and fits at least one pack on sale. Then the thin-stock rule: a pool with
 * its chase classes sold out still builds (their odds fold into the class
 * below and the draws follow), a pool of floor cards alone is 100% floor,
 * and only an empty floor refuses.
 *
 * The average pull is PRINTED against the target, as a warning when it is
 * far off, not asserted: the engine leans the within-class weights toward
 * the target but cannot take an average below what the cards in each band
 * allow, so a pack that pays out more than it costs is a stocking or pricing
 * decision for the founder, not an engine failure.
 * Exit 1 on any failure.
 */

import { buildTable, cardAt, commitFor, draw, poolWithoutRepeats, verifyDraw } from '../lib/slabPacks/engine';
import { poolForGame } from '../lib/slabPacks/pool';
import { HIT_CLASSES, HIT_ORDER, LIVE_TIERS, PACK_GAMES, TARGET_EV, TIERS, TIER_ORDER, classify } from '../lib/slabPacks/tiers';
import type { HitClass, PackTable } from '../lib/slabPacks/types';

let failures = 0;
function check(cond: boolean, msg: string) {
    if (!cond) {
        failures += 1;
        console.log(`  FAIL ${msg}`);
    }
}

const pctOf = (n: number) => `${(n * 100).toFixed(n * 100 >= 10 ? 0 : n * 100 >= 1 ? 1 : 2)}%`;
const N = 40_000;

// A sold-out pack has no table to check; say so rather than silently skip it.
for (const key of TIER_ORDER) {
    if (TIERS[key].status !== 'live') console.log(`${TIERS[key].name} ฿${TIERS[key].priceThb.toLocaleString('en-US')}: sold out (no stock for it yet), no table`);
}

// The pool is the inventory: a game with no cards in stock sells no packs,
// and a card that fits no pack on sale is dead stock that can never be pulled.
const stockedGames = PACK_GAMES.filter((game) => {
    const pool = poolForGame(game);
    if (!pool.length) console.log(`${game}: no cards in stock, no packs`);
    return pool.length > 0;
});
for (const game of stockedGames) for (const s of poolForGame(game)) {
    check(s.stock >= 1, `${s.key} has no copies`);
    check(LIVE_TIERS.some((k) => classify(s.valueThb, TIERS[k].priceThb) !== null), `${s.key} at ฿${s.valueThb} fits no pack on sale`);
}

for (const game of stockedGames) for (const key of LIVE_TIERS) {
    const tier = TIERS[key];
    const PREVIEW_POOL = poolForGame(game);
    const table = buildTable(game, tier, PREVIEW_POOL);
    console.log(`${game} ${tier.name} ฿${tier.priceThb.toLocaleString('en-US')}: avg ${pctOf(table.evThb / tier.priceThb)} of price, floor ฿${table.floorThb}, top ฿${table.topThb.toLocaleString('en-US')}, ${table.cards.length} cards`);
    console.log(`  odds ${HIT_ORDER.map((c) => `${HIT_CLASSES[c].letter} ${pctOf(table.byClass[c].odds)} (${table.byClass[c].cards})`).join(' · ')}`);

    const sumClass = HIT_ORDER.reduce((s, c) => s + tier.odds[c], 0);
    check(Math.abs(sumClass - 1) < 1e-9, `class odds sum to ${sumClass}`);
    // The full preview pool stocks every class, so the published odds are the tier's own.
    for (const cls of HIT_ORDER) check(table.byClass[cls].odds === tier.odds[cls], `${cls} publishes ${table.byClass[cls].odds}, tier says ${tier.odds[cls]}`);
    const sumCards = table.cards.reduce((s, c) => s + c.odds, 0);
    check(Math.abs(sumCards - 1) < 1e-9, `card odds sum to ${sumCards}`);
    for (const cls of HIT_ORDER) {
        const sum = table.cards.filter((c) => c.cls === cls).reduce((s, c) => s + c.odds, 0);
        check(Math.abs(sum - table.byClass[cls].odds) < 1e-9, `${cls} card odds sum to ${sum}, class odds ${table.byClass[cls].odds}`);
    }
    for (const c of table.cards) {
        const def = HIT_CLASSES[c.cls];
        const m = c.slab.valueThb / tier.priceThb;
        check(m >= def.min && m < def.max, `${c.slab.key} at ${m.toFixed(2)}x is outside ${c.cls} band`);
        check(c.odds > 0, `${c.slab.key} has zero odds`);
    }
    check(table.floorThb >= HIT_CLASSES.d.min * tier.priceThb, `floor ฿${table.floorThb} under ${HIT_CLASSES.d.min}x`);
    if (Math.abs(table.evThb / tier.priceThb - TARGET_EV) > 0.08) {
        const dir = table.evThb / tier.priceThb > TARGET_EV ? 'pays out more than it takes: cheaper cards in the thin bands, or a higher price, bring it down' : 'sits well under the target: the pack is stingier than the design intends';
        console.log(`  WARN average ${pctOf(table.evThb / tier.priceThb)} is more than 8 points from the ${pctOf(TARGET_EV)} target; the pack ${dir}`);
    }
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

    drawsFollowOdds(table, `mc-${game}-${key}`, client);
}

/** 40k draws per table land on the published class odds (4 sigma). */
function drawsFollowOdds(table: PackTable, seedPrefix: string, client: string) {
    const counts: Record<string, number> = {};
    for (const cls of HIT_ORDER) counts[cls] = 0;
    for (let i = 0; i < N; i++) counts[draw(table, `${seedPrefix}-${i}`, client).cls] += 1;
    for (const cls of HIT_ORDER) {
        const p = table.byClass[cls].odds;
        const freq = counts[cls] / N;
        const sd = Math.sqrt((p * (1 - p)) / N);
        check(Math.abs(freq - p) <= 4 * sd + 1e-9, `${cls} came up ${pctOf(freq)} of ${N} draws against ${pctOf(p)} published`);
    }
}

// Thin stock (founder's rule, 2026-11-07): a pack pauses only when its floor
// class is empty. Everything above the floor folds downward when sold out.
{
    const tier = TIERS.bronze;
    const pool = poolForGame('pokemon');
    const clsOf = (valueThb: number) => classify(valueThb, tier.priceThb);
    const oddsLine = (table: PackTable) => HIT_ORDER.map((c) => `${HIT_CLASSES[c].letter} ${pctOf(table.byClass[c].odds)} (${table.byClass[c].cards})`).join(' · ');

    const noChase = pool.filter((s) => clsOf(s.valueThb) !== 's' && clsOf(s.valueThb) !== 'ss');
    const folded = buildTable('pokemon', tier, noChase);
    console.log(`\nBronze with S and SS sold out: avg ${pctOf(folded.evThb / tier.priceThb)} of price`);
    console.log(`  odds ${oddsLine(folded)}`);
    check(folded.byClass.s.odds === 0 && folded.byClass.ss.odds === 0, 'sold-out chase classes still publish odds');
    check(folded.byClass.s.cards === 0 && folded.byClass.ss.cards === 0 && folded.cards.every((c) => c.cls !== 's' && c.cls !== 'ss'), 'a sold-out class still lists cards');
    check(Math.abs(folded.byClass.a.odds - (tier.odds.a + tier.odds.s + tier.odds.ss)) < 1e-9, `S and SS did not fold into A (A publishes ${folded.byClass.a.odds})`);
    check(Math.abs(folded.cards.reduce((s, c) => s + c.odds, 0) - 1) < 1e-9, 'folded card odds do not sum to 1');
    // The bias search re-targets the average with the folded odds, so losing
    // the chase classes cannot make the pack more generous than the full table.
    check(folded.evThb <= buildTable('pokemon', tier, pool).evThb + 1e-9, `folded average ${pctOf(folded.evThb / tier.priceThb)} is above the full table's`);
    drawsFollowOdds(folded, 'mc-folded', 'client-1');

    // A hole in the middle folds too: no C means C's chance goes to D.
    const noC = pool.filter((s) => clsOf(s.valueThb) !== 'c');
    const midFold = buildTable('pokemon', tier, noC);
    check(midFold.byClass.c.odds === 0 && Math.abs(midFold.byClass.d.odds - (tier.odds.d + tier.odds.c)) < 1e-9, 'an empty C did not fold into D');

    const floorOnly = buildTable('pokemon', tier, pool.filter((s) => clsOf(s.valueThb) === 'd'));
    console.log(`Bronze with only floor cards left: avg ${pctOf(floorOnly.evThb / tier.priceThb)} of price, ${floorOnly.cards.length} cards, D ${pctOf(floorOnly.byClass.d.odds)}`);
    check(Math.abs(floorOnly.byClass.d.odds - 1) < 1e-9, 'a floor-only pool is not 100% D');
    check((HIT_ORDER as readonly HitClass[]).every((c) => c === 'd' || floorOnly.byClass[c].odds === 0), 'a floor-only pool publishes odds above the floor');

    let refused = false;
    try {
        buildTable('pokemon', tier, pool.filter((s) => clsOf(s.valueThb) !== 'd'));
    } catch {
        refused = true;
    }
    check(refused, 'a pool with no floor cards still builds a table');
}

// No repeats (founder's rule, 2026-11-09): a buyer never pulls a card they
// already pulled in the same order, nor the card they pulled last. The rule
// gives way only when it would empty the floor and so refuse the sale.
{
    const tier = TIERS.bronze;
    const pool = poolForGame('pokemon');
    const isFloor = (valueThb: number) => classify(valueThb, tier.priceThb) === 'd';
    const [a, b] = pool.map((s) => s.key);

    check(poolWithoutRepeats(pool, tier, [], null) === pool, 'a buyer with no history does not draw from the whole pool');
    const trimmed = poolWithoutRepeats(pool, tier, [a], b);
    check(!trimmed.some((s) => s.key === a || s.key === b), 'a repeat is still in the draw pool');
    check(trimmed.length === pool.length - 2, 'the no-repeat pool dropped more than the repeats');

    // One floor card left, and it is the one just pulled: it stays in rather than pause the pack.
    const oneFloor = [...pool.filter((s) => !isFloor(s.valueThb)), pool.find((s) => isFloor(s.valueThb))!];
    const lone = oneFloor[oneFloor.length - 1];
    const relaxed = poolWithoutRepeats(oneFloor, tier, [], lone.key);
    check(relaxed.some((s) => s.key === lone.key), 'the only floor card was left out, which would pause the pack');
    let builds = true;
    try {
        buildTable('pokemon', tier, relaxed);
    } catch {
        builds = false;
    }
    check(builds, 'the relaxed no-repeat pool does not build a table');

    // Single packs, one after another, with every copy always back in stock:
    // the worst case for repeats. Never the same card twice running.
    let previous: string | null = null;
    let backToBack = 0;
    for (let i = 0; i < 4000; i++) {
        const d = draw(buildTable('pokemon', tier, poolWithoutRepeats(pool, tier, [], previous)), `repeat-${i}`, 'client-1');
        if (d.slabKey === previous) backToBack += 1;
        previous = d.slabKey;
    }
    check(backToBack === 0, `${backToBack} back-to-back repeats in 4,000 single packs`);

    // Ten packs in one order: ten different cards.
    const order: string[] = [];
    for (let i = 0; i < 10; i++) {
        const before = order.length ? order[order.length - 1] : null;
        order.push(draw(buildTable('pokemon', tier, poolWithoutRepeats(pool, tier, order, before)), `order-${i}`, 'client-1').slabKey);
    }
    check(new Set(order).size === order.length, 'a card came up twice inside one order');
    console.log(`\nNo repeats: 0 back-to-back in 4,000 single Bronze packs, ${new Set(order).size} different cards in a 10-pack order`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
