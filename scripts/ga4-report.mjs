/**
 * GA4 engagement report — DAU/WAU/MAU, retention, and platform split.
 *
 * WHY THIS EXISTS: the database cannot answer "how many people used the app
 * this week". auth.users.last_sign_in_at is frozen at signup for ~96% of
 * accounts (Supabase refreshes sessions silently), profiles.updated_at only
 * moves on profile edits, and the push-token timestamp covers only signed-in
 * NATIVE users holding a token. GA4 is the one place that sees web + native
 * (the Capacitor shell loads cardstreet.app, so app sessions are tracked
 * identically) and logged-out visitors too.
 *
 * Zero dependencies on purpose: mints its own service-account JWT with node
 * crypto and calls the REST endpoint, so this needs no npm install and cannot
 * drift with a client-library upgrade.
 *
 * SETUP (one time):
 *   1. Service account with the Google Analytics Data API enabled.
 *   2. Add its email to GA4 property 529792127 as a Viewer
 *      (GA4 Admin > Property access management).
 *   3. Put the key JSON somewhere private and point .env.local at it:
 *        GA4_PROPERTY_ID=529792127
 *        GOOGLE_APPLICATION_CREDENTIALS=C:/path/to/ga4-reader-key.json
 *
 * Usage: node scripts/ga4-report.mjs [days]      (default 30)
 */
import { readFileSync } from 'fs';
import { createSign } from 'crypto';

// --- env (.env.local; strips CRLF + surrounding quotes, per CLAUDE.md) ---
const ROOT = 'C:/Users/brand/Downloads/cardstreet-tcg';
for (const rawLine of readFileSync(`${ROOT}/.env.local`, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
}

const PROPERTY = process.env.GA4_PROPERTY_ID || '529792127';
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!KEY_PATH) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS is not set in .env.local — see SETUP in this file.');
    process.exit(1);
}
const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));

// --- OAuth2 access token from the service-account key (RS256 JWT grant) ---
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function accessToken() {
    const iat = Math.floor(Date.now() / 1000);
    const claim = {
        iss: key.client_email,
        scope: 'https://www.googleapis.com/auth/analytics.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: iat + 3600,
        iat,
    };
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsigned}.${sig}`,
        }),
    });
    const j = await res.json();
    if (!j.access_token) throw new Error(`token exchange failed: ${JSON.stringify(j)}`);
    return j.access_token;
}

async function runReport(token, body) {
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const j = await res.json();
    if (j.error) throw new Error(`${j.error.status}: ${j.error.message}`);
    return j;
}
const rows = r => (r.rows ?? []).map(row => [
    ...(row.dimensionValues ?? []).map(d => d.value),
    ...(row.metricValues ?? []).map(m => m.value),
]);

const DAYS = Number(process.argv[2]) || 30;
const token = await accessToken();

// 1. Daily active users + sessions over the window.
const daily = await runReport(token, {
    dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: 'yesterday' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
});

// 2. Rolling windows — GA computes these natively, no summing needed.
const windows = {};
for (const [label, range] of [['DAU (yesterday)', 'yesterday'], ['WAU (7d)', '7daysAgo'], ['MAU (30d)', '30daysAgo']]) {
    const r = await runReport(token, {
        dateRanges: [{ startDate: range === 'yesterday' ? 'yesterday' : range, endDate: 'yesterday' }],
        metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }],
    });
    const [a, n] = rows(r)[0] ?? ['0', '0'];
    windows[label] = { activeUsers: Number(a), newUsers: Number(n), returning: Number(a) - Number(n) };
}

// 3. Platform split — the question the DB could not answer.
const platform = await runReport(token, {
    dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: 'yesterday' }],
    dimensions: [{ name: 'platform' }, { name: 'operatingSystem' }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
});

// 4. Where the live-stream pages actually landed.
const pages = await runReport(token, {
    dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: 'yesterday' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 12,
});

console.log(JSON.stringify({
    property: PROPERTY,
    windows,
    dailyActiveUsers: rows(daily).map(([date, au, nu, s]) => ({ date, activeUsers: +au, newUsers: +nu, sessions: +s })),
    platformSplit: rows(platform).map(([p, os, au, s]) => ({ platform: p, os, activeUsers: +au, sessions: +s })),
    topPages: rows(pages).map(([path, views, au]) => ({ path, views: +views, activeUsers: +au })),
}, null, 2));
