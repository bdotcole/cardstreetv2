/**
 * Read-only Stripe health check for the CardStreet Pro billing rail.
 *
 * Answers one question: can a web Pro purchase ever activate? The entitlement
 * is written by lib/stripeWebhook.ts on checkout.session.completed +
 * customer.subscription.*, which are PLATFORM events. If the TH endpoint that
 * subscribes to them is Connect-scoped (application != null / connect: true),
 * those events are delivered for connected accounts only and the platform's
 * own subscription events never arrive -- the buyer is charged and never gets
 * Pro.
 *
 * Local-only diagnostic; not part of the app. GETs only, nothing is mutated.
 */

import { readFileSync } from 'node:fs';

// Same convention as scripts/backfill-phashes.mjs. Surrounding quotes MUST be
// stripped: Next.js does it per the dotenv spec, a naive parser does not, and
// a quoted key is sent to the API verbatim and rejected.
function loadEnv(path = '.env.local') {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    } catch {
        console.error(`Could not read ${path}`);
        process.exit(1);
    }
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
        if (!m) continue;
        process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/s, '$1');
    }
}

loadEnv();

// Prefer the TH key. Fall back to the legacy unsuffixed one purely so the
// script can report WHICH account it reached -- the webhook listing is only
// meaningful if that account is the TH platform.
const KEY = process.env.STRIPE_SECRET_KEY_TH ?? process.env.STRIPE_SECRET_KEY;
const KEY_SOURCE = process.env.STRIPE_SECRET_KEY_TH ? 'STRIPE_SECRET_KEY_TH' : 'STRIPE_SECRET_KEY (fallback)';
if (!KEY) {
    console.error('No Stripe secret key found in .env.local');
    process.exit(1);
}

async function stripeGet(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`https://api.stripe.com/v1/${path}${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${KEY}:`).toString('base64')}` },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${body?.error?.message ?? ''}`);
    return body;
}

const PRO_EVENTS = [
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
];

console.log(`key source: ${KEY_SOURCE}`);
console.log(`mode      : ${KEY.startsWith('sk_live') ? 'LIVE' : 'TEST'}`);

// Identify the account first -- a webhook listing from the dormant US platform
// says nothing about the TH destination we actually care about.
const acct = await stripeGet('account');
console.log(`account   : ${acct.id}  country=${acct.country}  default_currency=${acct.default_currency}`);
if (acct.country !== 'TH') {
    console.log('\n!! This key is NOT the TH platform. The listing below does not answer');
    console.log('!! the Pro-billing question -- check the TH account instead.\n');
}

const endpoints = await stripeGet('webhook_endpoints', { limit: '100' });
console.log(`=== webhook endpoints (${endpoints.data.length}) ===`);

let platformCovered = false;
for (const e of endpoints.data) {
    // `application` non-null means the endpoint belongs to a Connect app, i.e.
    // it receives connected-account events rather than the platform's own.
    const connectScoped = e.application != null || e.connect === true;
    const covers = PRO_EVENTS.filter((x) => e.enabled_events.includes(x) || e.enabled_events.includes('*'));
    if (!connectScoped && covers.length === PRO_EVENTS.length && e.status === 'enabled') platformCovered = true;

    console.log(`\n  url         : ${e.url}`);
    console.log(`  status      : ${e.status}`);
    console.log(`  scope       : ${connectScoped ? 'CONNECT (connected accounts)' : 'PLATFORM (your account)'}`);
    console.log(`  application : ${e.application ?? '(none)'}`);
    console.log(`  connect     : ${e.connect ?? '(not reported)'}`);
    console.log(`  pro events  : ${covers.length ? covers.join(', ') : 'NONE'}`);
    console.log(`  all events  : ${e.enabled_events.join(', ')}`);
}

console.log(`\n=== verdict ===`);
console.log(
    platformCovered
        ? 'OK: a PLATFORM-scoped enabled endpoint covers all four Pro events.'
        : 'BROKEN: no platform-scoped endpoint covers all four Pro events -> web Pro purchases can never activate.',
);

// Corroborate from the money side: subscriptions that exist in Stripe are
// purchases that happened regardless of what the webhook did.
const subs = await stripeGet('subscriptions', { limit: '100', status: 'all' });
const pro = subs.data.filter((s) => s.metadata?.purpose === 'cardstreet_premium');
console.log(`\n=== cardstreet_premium subscriptions in Stripe: ${pro.length} ===`);
for (const s of pro) {
    console.log(
        `  ${s.id}  status=${s.status}  created=${new Date(s.created * 1000).toISOString().slice(0, 10)}  user_id=${s.metadata?.user_id ?? '(none)'}`,
    );
}
