/**
 * Read-only: has the CardStreet Pro entitlement rail ever fired in production?
 *
 * profiles.premium_until is written by lib/premiumEntitlement.ts, which only
 * runs from the Stripe webhook (checkout.session.completed +
 * customer.subscription.*) or the RevenueCat webhook. So a row with
 * premium_until set is proof a webhook was delivered and processed; zero rows
 * with a stripe subscription id is consistent with the events never arriving.
 *
 * Local-only diagnostic. SELECTs only.
 */

import { readFileSync } from 'node:fs';

function loadEnv(path = '.env.local') {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
        if (!m) continue;
        process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/s, '$1');
    }
}

loadEnv();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
    console.error('Supabase URL / service role key missing from .env.local');
    process.exit(1);
}

async function q(path) {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
    });
    // An unchecked error here would silently look like "zero rows" -- the exact
    // failure mode that has faked a wrong answer on this project before.
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
    return { rows: await res.json(), count: res.headers.get('content-range') };
}

console.log(`project: ${URL_}\n`);

const cols = await q('profiles?select=*&limit=1');
const sample = cols.rows[0] ?? {};
const premiumCols = Object.keys(sample).filter((c) => /premium|pro_|subscription|stripe_customer/i.test(c));
console.log(`premium-ish columns on profiles: ${premiumCols.join(', ') || '(none found)'}\n`);

const withPremium = await q('profiles?select=id,premium_until&premium_until=not.is.null&limit=200');
console.log(`profiles with premium_until set: ${withPremium.rows.length}  (range: ${withPremium.count})`);

const now = Date.now();
const active = withPremium.rows.filter((r) => new Date(r.premium_until).getTime() > now);
console.log(`  of those, still active today  : ${active.length}`);
for (const r of withPremium.rows.slice(0, 15)) {
    console.log(`    ${r.id}  until=${r.premium_until}`);
}
