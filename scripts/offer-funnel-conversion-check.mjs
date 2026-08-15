/**
 * Read-only conversion check for the accepted-offer -> payment funnel.
 *
 * Baseline captured 2026-08-15, right after the fixes in c47ca2b shipped and
 * the backlog sweep in 130206d ran: 12 accepted offers, 0 ever paid, 9 of them
 * reminded by the sweep and 3 left for the daily cron. Re-run to see whether
 * any converted, whether the cron is firing, and whether the Apple Private
 * Relay mail fix has landed.
 *
 * ZERO DEPENDENCIES ON PURPOSE — talks to PostgREST over native fetch rather
 * than importing supabase-js, so it still runs when node_modules is missing or
 * half-installed (which is exactly the state that broke the first version of
 * this script). Plain `node`, no tsx, no build step.
 *
 * Writes NOTHING. Run: node scripts/offer-funnel-conversion-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

// .env.local loader — strips surrounding quotes (CLAUDE.md), walking up from
// cwd so it works from a git worktree too.
function findEnvFile() {
    let dir = process.cwd();
    for (;;) {
        const candidate = path.join(dir, '.env.local');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}
const env = {};
const envPath = findEnvFile();
if (envPath) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m) continue;
        env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
}
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) throw new Error(`Missing Supabase env (looked in ${envPath ?? 'no .env.local found'})`);

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(pathAndQuery) {
    const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, { headers: H });
    if (!res.ok) throw new Error(`${pathAndQuery} -> ${res.status} ${await res.text()}`);
    return res.json();
}

const BASELINE = '2026-08-15T00:00:00Z';

console.log(`OFFER FUNNEL CONVERSION CHECK — baseline ${BASELINE.slice(0, 10)}, run ${new Date().toISOString().slice(0, 16)}\n`);

// ── 1. Conversions ──
const all = await rest(
    'offers?select=id,status,amount,buyer_id,accepted_order_id,created_at,updated_at,payment_nudge_count,payment_nudge_sent_at&order=created_at.desc',
);
const acceptedUnpaid = all.filter(o => o.status === 'accepted' && !o.accepted_order_id);
const converted = all.filter(o => o.accepted_order_id);
const convertedSince = converted.filter(o => o.updated_at >= BASELINE);

console.log('── CONVERSIONS ──');
console.log(`offers total: ${all.length}  |  accepted + still unpaid: ${acceptedUnpaid.length}  (was 12 at baseline)`);
console.log(`offers ever linked to an order: ${converted.length}  (was 2 at baseline)`);
console.log(`NEW conversions since baseline: ${convertedSince.length}`);
for (const o of convertedSince) {
    const [ord] = await rest(`orders?select=status,total_amount,created_at&id=eq.${o.accepted_order_id}`);
    console.log(`   ${o.id.slice(0, 8)}  ฿${o.amount}  -> order ${ord?.status} ฿${ord?.total_amount} ${ord?.created_at?.slice(0, 16)}`);
}

// ── 2. Is the reminder cron firing? ──
console.log('\n── REMINDER CRON ──');
const nudged = all.filter(o => (o.payment_nudge_count ?? 0) > 0);
const byCron = nudged.filter(o => o.payment_nudge_sent_at >= BASELINE);
console.log(`reminded at all: ${nudged.length}  |  by the 08-15 sweep: ${nudged.length - byCron.length}  |  by the cron since: ${byCron.length}`);
for (const o of byCron) {
    console.log(`   ${o.id.slice(0, 8)}  ฿${o.amount}  touch #${o.payment_nudge_count}  ${o.payment_nudge_sent_at?.slice(0, 16)}`);
}
const unreminded = acceptedUnpaid.filter(o => (o.payment_nudge_count ?? 0) === 0);
if (unreminded.length) {
    console.log(`   ${unreminded.length} accepted+unpaid never reminded — if any is >24h old and <14d, the cron is NOT running:`);
    for (const o of unreminded) {
        const ageD = Math.round((Date.now() - new Date(o.created_at)) / 86400000);
        console.log(`     ${o.id.slice(0, 8)} ฿${o.amount} ${ageD}d old, accepted ${o.updated_at.slice(0, 16)}`);
    }
}

// ── 3. New activity since the UI changes ──
console.log('\n── NEW ACTIVITY SINCE BASELINE ──');
const newOffers = all.filter(o => o.created_at >= BASELINE);
console.log(`new offers made: ${newOffers.length}  |  accepted: ${newOffers.filter(o => o.status === 'accepted').length}  |  paid: ${newOffers.filter(o => o.accepted_order_id).length}`);
const newBuyers = [...new Set(newOffers.map(o => o.buyer_id))];
if (newBuyers.length) {
    // Does address-at-offer-time work? New offerers should be checkout-ready.
    const profs = await rest(`profiles?select=id,username,address,province,postcode,phone_number&id=in.(${newBuyers.join(',')})`);
    const ready = profs.filter(p => p.address && p.province && p.postcode && p.phone_number);
    console.log(`new offerers checkout-ready: ${ready.length}/${profs.length}  (was 2/8 at baseline — this is the address-at-offer-time fix)`);
    for (const p of profs.filter(p => !ready.includes(p))) console.log(`   NOT ready: ${p.username}`);
}

// ── 4. Apple Private Relay ──
console.log('\n── APPLE PRIVATE RELAY ──');
let page = 1, relay = 0, total = 0;
for (;;) {
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: H });
    if (!res.ok) break;
    const users = (await res.json()).users ?? [];
    if (!users.length) break;
    for (const u of users) { total++; if ((u.email ?? '').endsWith('privaterelay.appleid.com')) relay++; }
    if (users.length < 1000) break;
    page++;
}
console.log(`relay accounts: ${relay}/${total}  (mail to them bounces until docs/runbooks/apple-private-relay-email.md is done)`);

if (env.COURIER_AUTH_TOKEN) {
    const res = await fetch('https://api.courier.com/messages?limit=50', {
        headers: { Authorization: `Bearer ${env.COURIER_AUTH_TOKEN}` },
    });
    if (res.ok) {
        const msgs = (await res.json()).results ?? [];
        const counts = {};
        let relaySends = 0, relayBounces = 0;
        for (const m of msgs) {
            counts[m.status] = (counts[m.status] ?? 0) + 1;
            if (String(m.recipient ?? '').endsWith('privaterelay.appleid.com')) {
                relaySends++;
                if (m.status === 'UNDELIVERABLE') relayBounces++;
            }
        }
        console.log(`courier last ${msgs.length} messages: ${JSON.stringify(counts)}`);
        console.log(`relay sends in that window: ${relaySends}, of which bounced: ${relayBounces}` +
            (relaySends === 0 ? '  (no relay sends to judge by — send a test)' : relayBounces === 0 ? '  <- FIXED' : '  <- still broken'));
    }
}
