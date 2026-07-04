/**
 * Concurrency hammer for the auction bid engine (place_bid / buy_now RPCs).
 *
 * THE exit criterion for shipping auction-engine changes — run it after any
 * change to place_bid, the increment ladder, or the soft-close logic:
 *
 *   node scripts/hammer-auction-bids.mjs [--bidders=8] [--rounds=6] [--keep]
 *
 * What it does, against the LIVE linked DB (all rows are synthetic and
 * cleaned up unless --keep):
 *   1. Deterministic eBay-semantics scenario (proxy ladder, tie-goes-to-first,
 *      below-min rejection, raise-own-max).
 *   2. Random CONCURRENT rounds: N bidders fire place_bid simultaneously.
 *      Afterwards the serialized order is recovered from bids.seq and replayed
 *      through a local simulator of the eBay model; the DB rows and final
 *      auction state must match the simulator EXACTLY. Any lost update,
 *      double-application, or mis-resolution under lock contention fails.
 *   3. Soft-close: a bid inside the final window must extend ends_at.
 *   4. Buy-It-Now race: two simultaneous buy_now calls -> exactly one wins.
 *   5. Strike suspension: 2 strikes/90d -> place_bid returns 'suspended'.
 *   6. Privilege check: the anon key must NOT be able to execute place_bid.
 *
 * Exit code 0 = all invariants hold; 1 = at least one failed.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Worktree-friendly: try the repo root first, then the main tree the worktree
// hangs off (worktrees don't carry the untracked .env.local).
const ENV_CANDIDATES = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '..', '..', '..', '.env.local'),
];
for (const envPath of ENV_CANDIDATES) {
    if (!fs.existsSync(envPath)) continue;
    fs.readFileSync(envPath, 'utf-8').split(/\r?\n/).forEach((line) => {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    });
    break;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
}));
const N_BIDDERS = parseInt(args.bidders || '8', 10);
const N_ROUNDS = parseInt(args.rounds || '6', 10);
const KEEP = !!args.keep;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── Test-side oracle: mirror of lib/auctionRules.ts (intentional duplication —
//    if someone changes the SQL but not the TS rules, this hammer catches it).
function inc(price) {
    if (price < 10000) return 500;
    if (price < 50000) return 1000;
    if (price < 100000) return 2000;
    if (price < 500000) return 5000;
    if (price < 1000000) return 10000;
    if (price < 5000000) return 25000;
    return 50000;
}

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) {
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

const RUN = Date.now().toString(36);
const createdUserIds = [];
const createdAuctionIds = [];

async function createUser(label) {
    const email = `cs-hammer-${RUN}-${label}@example.com`;
    const { data, error } = await db.auth.admin.createUser({
        email,
        password: `Hammer${RUN}!aA1`,
        email_confirm: true,
        user_metadata: { display_name: `Hammer ${label}` },
    });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    createdUserIds.push(data.user.id);
    // handle_new_user trigger creates the profiles row; make sure it landed.
    for (let i = 0; i < 20; i++) {
        const { data: p } = await db.from('profiles').select('id').eq('id', data.user.id).maybeSingle();
        if (p) return data.user.id;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`profile for ${label} never appeared`);
}

async function createAuction(sellerId, over = {}) {
    const { data, error } = await db.from('auctions').insert({
        seller_id: sellerId,
        card_id: `hammer-${RUN}`,
        card_data: { name: 'Hammer Test Card', images: {} },
        condition: 'Near Mint',
        starting_price: 5000,          // ฿50
        current_price: 5000,
        status: 'live',
        ends_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        original_ends_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        ...over,
    }).select('*').single();
    if (error) throw new Error(`createAuction: ${error.message}`);
    createdAuctionIds.push(data.id);
    return data;
}

const bid = (auctionId, bidderId, max) =>
    db.rpc('place_bid', { p_auction_id: auctionId, p_bidder_id: bidderId, p_max_bid: max });

// ── eBay-model simulator (mirror of the place_bid RPC, no reserve) ──
function simulate(startPrice, sequence) {
    let price = startPrice, high = null, highMax = 0;
    const rows = [];
    for (const { bidder, max } of sequence) {
        if (high === bidder) {                    // raise own max (accepted ⇒ max > highMax)
            highMax = max;
            rows.push({ bidder, amount: price, proxy: false });
        } else if (high === null) {               // first bid
            price = startPrice;
            high = bidder; highMax = max;
            rows.push({ bidder, amount: price, proxy: false });
        } else if (max > highMax) {               // challenger wins
            if (highMax > price) rows.push({ bidder: high, amount: highMax, proxy: true });
            price = Math.min(max, highMax + inc(highMax));
            rows.push({ bidder, amount: price, proxy: false });
            high = bidder; highMax = max;
        } else {                                  // incumbent defends (ties included)
            rows.push({ bidder, amount: max, proxy: false });
            const newPrice = max === highMax ? highMax : Math.min(highMax, max + inc(max));
            rows.push({ bidder: high, amount: newPrice, proxy: true });
            price = newPrice;
        }
    }
    return { price, high, highMax, rows };
}

async function main() {
    console.log(`Hammer run ${RUN}: ${N_BIDDERS} bidders × ${N_ROUNDS} concurrent rounds`);

    console.log('\nProvisioning test users…');
    const seller = await createUser('seller');
    const bidders = [];
    for (let i = 0; i < N_BIDDERS; i++) bidders.push(await createUser(`b${i}`));

    // ─── 1. Deterministic eBay semantics ───
    console.log('\n[1] Deterministic proxy-bidding semantics');
    {
        const a = await createAuction(seller);
        const [A, B] = bidders;

        let r = (await bid(a.id, A, 20000)).data;
        check('first bid displays at starting price', r.accepted && r.current_price === 5000 && r.is_high_bidder, JSON.stringify(r));

        r = (await bid(a.id, B, 10000)).data;
        check('lower challenger pushed to their max + increment', r.accepted && !r.is_high_bidder && r.current_price === 11000, JSON.stringify(r));

        r = (await bid(a.id, B, 11500)).data;
        check('below-min challenge rejected', !r.accepted && r.reason === 'below_min', JSON.stringify(r));

        // Incumbent max ฿200 sits in the ฿100–499 band (฿10 steps), so the
        // challenger takes it at ฿200 + ฿10 = ฿210 (21000 satang).
        r = (await bid(a.id, B, 25000)).data;
        check('higher challenger takes lead at old max + increment', r.accepted && r.is_high_bidder && r.current_price === 21000, JSON.stringify(r));

        r = (await bid(a.id, A, 25000)).data;
        check('tie goes to the earlier (standing) bidder', r.accepted && !r.is_high_bidder && r.current_price === 25000, JSON.stringify(r));

        r = (await bid(a.id, B, 24000)).data;
        check('high bidder must raise above own max', !r.accepted && r.reason === 'not_above_own_max', JSON.stringify(r));

        r = (await bid(a.id, seller, 50000)).data;
        check('seller cannot bid on own auction', !r.accepted && r.reason === 'own_auction', JSON.stringify(r));

        const { data: fin } = await db.from('auctions').select('*').eq('id', a.id).single();
        check('final: B leads at ฿250', fin.high_bidder_id === B && fin.current_price === 25000 && fin.bid_count === 4,
            `high=${fin.high_bidder_id === B} price=${fin.current_price} count=${fin.bid_count}`);
    }

    // ─── 2. Concurrent random rounds + serialized replay oracle ───
    console.log('\n[2] Concurrency hammer + serialized-replay oracle');
    {
        const a = await createAuction(seller);
        const accepted = [];
        let rejects = 0;

        for (let round = 0; round < N_ROUNDS; round++) {
            const base = 5000 + round * 30000;
            const results = await Promise.all(bidders.map((b) => {
                const max = base + Math.floor(Math.random() * 300) * 100;
                return bid(a.id, b, max).then((res) => ({ b, max, res }));
            }));
            for (const { res } of results) {
                if (res.error) { failures++; console.error('  RPC error:', res.error.message); continue; }
                if (res.data.accepted) accepted.push(res.data); else rejects++;
            }
        }
        console.log(`  ${accepted.length} accepted, ${rejects} rejected across ${N_BIDDERS * N_ROUNDS} concurrent calls`);

        const { data: fin } = await db.from('auctions').select('*').eq('id', a.id).single();
        const { data: rows } = await db.from('bids').select('*').eq('auction_id', a.id).order('seq', { ascending: true });

        const userRows = rows.filter((x) => !x.is_proxy);
        check('bid_count === accepted calls === non-proxy rows',
            fin.bid_count === accepted.length && userRows.length === accepted.length,
            `bid_count=${fin.bid_count} accepted=${accepted.length} userRows=${userRows.length}`);

        let monotonic = true;
        for (let i = 1; i < rows.length; i++) if (rows[i].amount < rows[i - 1].amount) monotonic = false;
        check('visible amounts non-decreasing in serialization order', monotonic);

        // Replay the serialized order through the oracle.
        const seq = userRows.map((x) => ({ bidder: x.bidder_id, max: Number(x.max_amount) }));
        const sim = simulate(5000, seq);
        check('final price matches oracle replay', Number(fin.current_price) === sim.price,
            `db=${fin.current_price} sim=${sim.price}`);
        check('high bidder matches oracle replay', fin.high_bidder_id === sim.high,
            `db=${fin.high_bidder_id} sim=${sim.high}`);

        const rowsMatch = rows.length === sim.rows.length && rows.every((x, i) =>
            x.bidder_id === sim.rows[i].bidder &&
            Number(x.amount) === sim.rows[i].amount &&
            x.is_proxy === sim.rows[i].proxy);
        check('every bid row (incl. proxy counter-bids) matches oracle replay',
            rowsMatch, `db rows=${rows.length} sim rows=${sim.rows.length}`);

        const { data: highRow } = await db.from('bids').select('*').eq('id', fin.high_bid_id).single();
        check('high_bid_id row belongs to high bidder at current price',
            highRow && highRow.bidder_id === fin.high_bidder_id && Number(highRow.amount) === Number(fin.current_price));
    }

    // ─── 3. Soft close ───
    console.log('\n[3] Soft-close anti-snipe');
    {
        const endsAt = new Date(Date.now() + 45_000).toISOString();
        const a = await createAuction(seller, { ends_at: endsAt, original_ends_at: endsAt });
        const r = (await bid(a.id, bidders[0], 9000)).data;
        const { data: fin } = await db.from('auctions').select('ends_at, extension_count').eq('id', a.id).single();
        check('bid inside final window extends ends_at',
            r.accepted && r.extended && Date.parse(fin.ends_at) > Date.parse(endsAt) && fin.extension_count === 1,
            JSON.stringify({ r, fin }));
    }

    // ─── 4. Buy-It-Now race ───
    console.log('\n[4] Buy-It-Now race (two simultaneous buyers)');
    {
        const a = await createAuction(seller, { buy_now_price: 100000 });
        const [r1, r2] = await Promise.all([
            db.rpc('buy_now', { p_auction_id: a.id, p_buyer_id: bidders[0] }),
            db.rpc('buy_now', { p_auction_id: a.id, p_buyer_id: bidders[1] }),
        ]);
        const wins = [r1.data, r2.data].filter((x) => x?.accepted).length;
        check('exactly one buyer wins the race', wins === 1, JSON.stringify([r1.data, r2.data]));

        const b = await createAuction(seller, { buy_now_price: 100000 });
        await bid(b.id, bidders[2], 6000);
        const r3 = (await db.rpc('buy_now', { p_auction_id: b.id, p_buyer_id: bidders[3] })).data;
        check('BIN unavailable once bidding has started', !r3.accepted && r3.reason === 'bidding_started', JSON.stringify(r3));
    }

    // ─── 5. Strike suspension ───
    console.log('\n[5] Deadbeat strike suspension');
    {
        const a = await createAuction(seller);
        const victim = bidders[N_BIDDERS - 1];
        await db.from('auction_strikes').insert([
            { user_id: victim, reason: 'unpaid' },
            { user_id: victim, reason: 'unpaid' },
        ]);
        const r = (await bid(a.id, victim, 9000)).data;
        check('2 strikes/90d suspends bidding', !r.accepted && r.reason === 'suspended', JSON.stringify(r));
    }

    // ─── 6. Privileges ───
    console.log('\n[6] RPC privileges');
    if (ANON_KEY) {
        const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
        const { error } = await anon.rpc('place_bid', {
            p_auction_id: createdAuctionIds[0], p_bidder_id: bidders[0], p_max_bid: 999999,
        });
        check('anon key cannot execute place_bid', !!error, 'anon call unexpectedly succeeded');
    } else {
        console.log('  SKIP  no anon key in env');
    }

    // ─── Cleanup ───
    if (!KEEP) {
        console.log('\nCleaning up…');
        await db.from('auction_strikes').delete().in('user_id', createdUserIds);
        await db.from('auctions').delete().in('id', createdAuctionIds); // bids cascade
        for (const id of createdUserIds) await db.auth.admin.deleteUser(id);
        console.log(`  removed ${createdAuctionIds.length} auctions, ${createdUserIds.length} users`);
    } else {
        console.log('\n--keep: leaving test rows in place');
    }

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
    console.error('\nFatal:', err);
    if (!KEEP) {
        try {
            await db.from('auction_strikes').delete().in('user_id', createdUserIds);
            await db.from('auctions').delete().in('id', createdAuctionIds);
            for (const id of createdUserIds) await db.auth.admin.deleteUser(id);
        } catch { /* best effort */ }
    }
    process.exit(1);
});
