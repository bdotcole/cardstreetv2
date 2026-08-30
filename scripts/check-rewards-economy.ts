/**
 * Economy invariant check for the coin store. Run with:
 *   npx tsx scripts/check-rewards-economy.ts
 *
 * Imports the real modules (never a regex over the source) so it fails when
 * the catalog, the style maps, and the locale strings drift apart. The
 * pricing ceiling is the load-bearing one: a coin must never be redeemable
 * for more than one satang, because settlementCoins' anti-wash-trading caps
 * are computed against that peg.
 */
import { CATALOG, CHAT_COLORS, FRAME_STYLES, CHECKIN_CALENDAR, QUEST_COINS, settlementCoins } from '../lib/rewardTiers';
import en from '../lib/locales/en.json';
import th from '../lib/locales/th.json';

const enItems = (en as { rewards: { item: Record<string, string> } }).rewards.item;
const thItems = (th as { rewards: { item: Record<string, string> } }).rewards.item;

let failures = 0;
const fail = (msg: string) => { failures++; console.error('  FAIL ' + msg); };
const ok = (msg: string) => console.log('  ok   ' + msg);

console.log('\nCatalog integrity');
const keys = CATALOG.map((i) => i.key);
if (new Set(keys).size !== keys.length) fail('duplicate catalog keys');
else ok(`${keys.length} unique SKUs`);

for (const item of CATALOG) {
    if (!enItems[item.key]) fail(`missing EN label: ${item.key}`);
    if (!thItems[item.key]) fail(`missing TH label: ${item.key}`);
}
if (failures === 0) ok('every SKU has EN + TH labels');

for (const k of Object.keys(enItems)) {
    if (!keys.includes(k)) fail(`stale locale key with no SKU: ${k}`);
}

console.log('\nCosmetic wiring');
for (const item of CATALOG) {
    if (item.key.startsWith('frame_') && !(item.key in FRAME_STYLES)) {
        fail(`frame SKU has no FRAME_STYLES entry: ${item.key}`);
    }
    if (item.key.startsWith('chat_color_')) {
        const colour = item.key.slice('chat_color_'.length);
        if (!(colour in CHAT_COLORS)) fail(`colour SKU maps to unknown colour: ${item.key}`);
    }
}
for (const frame of Object.keys(FRAME_STYLES)) {
    if (!keys.includes(frame)) fail(`FRAME_STYLES entry is not purchasable: ${frame}`);
}
if (CATALOG.some((i) => i.key === 'chat_color_rainbow')) {
    fail('rainbow must stay bundle-only (no solo SKU)');
} else {
    ok('rainbow is bundle-only');
}

console.log('\nShop grouping (the hub renders one section per kind)');
const SHOP_KINDS = ['cosmetic', 'perk', 'voucher'] as const;
const grouped = SHOP_KINDS.reduce((n, kind) => n + CATALOG.filter((i) => i.kind === kind).length, 0);
if (grouped !== CATALOG.length) {
    fail(`${CATALOG.length - grouped} SKU(s) fall outside the rendered sections and would be invisible`);
} else {
    ok(SHOP_KINDS.map((k) => `${k}: ${CATALOG.filter((i) => i.kind === k).length}`).join(', '));
}

console.log('\nPricing ceiling (1 coin <= 1 satang)');
for (const item of CATALOG) {
    const cost = item.realCostSatang ?? 0;
    if (cost > 0 && item.coins < cost) {
        fail(`${item.key}: ${item.coins} coins buys ${cost} satang — coin worth > 1 satang`);
    }
    if (item.voucher && (item.realCostSatang ?? 0) !== item.voucher.amountSatang) {
        fail(`${item.key}: budget reserves ${item.realCostSatang} but voucher pays ${item.voucher.amountSatang}`);
    }
}
if (failures === 0) ok('no SKU breaches the ceiling; budget reserve equals face value');

console.log('\nValue ladder (higher tiers must not be worse value)');
const orderVouchers = CATALOG
    .filter((i) => i.voucher?.type === 'order')
    .sort((a, b) => a.coins - b.coins);
let prevRate = 0;
for (const v of orderVouchers) {
    const rate = (v.voucher!.amountSatang) / v.coins; // satang returned per coin
    const line = `${v.key}: ${v.coins.toLocaleString()} coins -> ${(v.voucher!.amountSatang / 100).toFixed(0)} THB (${rate.toFixed(3)} satang/coin)`;
    if (rate < prevRate - 1e-9) fail(`${line}  [worse value than the cheaper tier]`);
    else ok(line);
    prevRate = rate;
}

console.log('\nTime-to-afford at realistic earn rates');
const weekly = CHECKIN_CALENDAR.reduce((s, c) => s + c, 0);
const casual = weekly * 4.33;                       // check-in only
const engaged = casual + QUEST_COINS * 3 * 30;      // + all three daily quests
// Coin-back is the dominant source for the people vouchers actually target:
// settlementCoins pays the buyer 1% of the order, capped at 500 coins each.
const buyer = engaged + 3 * settlementCoins(500, 45).buyer;
console.log(`  casual  ~${Math.round(casual)} coins/month (check-in only)`);
console.log(`  engaged ~${Math.round(engaged)} coins/month (+ all daily quests)`);
console.log(`  buyer   ~${Math.round(buyer)} coins/month (+ three 500 THB orders)`);
for (const v of CATALOG.filter((i) => i.kind === 'voucher').sort((a, b) => a.coins - b.coins)) {
    console.log(
        `  ${v.key.padEnd(17)} ${String(v.coins).padStart(6)} coins = ` +
        `${(v.coins / buyer).toFixed(1)} mo buyer / ${(v.coins / engaged).toFixed(1)} mo engaged / ` +
        `${(v.coins / casual).toFixed(1)} mo casual`,
    );
}

console.log(failures === 0 ? '\nPASS — economy consistent\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
