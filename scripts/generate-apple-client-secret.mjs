// Generates the "client secret" JWT that Supabase's Apple provider expects in the
// "Secret Key (for OAuth)" field. Apple does not hand you this string — you sign it
// yourself with your .p8 private key. Output is valid for ~6 months (Apple's max),
// after which you must re-run this and paste the new value into Supabase.
//
// Usage (PowerShell):
//   $env:APPLE_TEAM_ID="XXXXXXXXXX"; `
//   $env:APPLE_KEY_ID="MNG33FBACU"; `
//   $env:APPLE_SERVICES_ID="com.cardstreet.signin"; `
//   $env:APPLE_PRIVATE_KEY_PATH="C:\path\to\AuthKey_MNG33FBACU.p8"; `
//   node scripts/generate-apple-client-secret.mjs
//
//   APPLE_TEAM_ID       Your 10-char Apple Developer Team ID (portal, top right).
//   APPLE_KEY_ID        The 10-char Key ID of the Sign in with Apple key (Apple > Keys).
//   APPLE_SERVICES_ID   The Services ID (NOT the bundle ID) used for web OAuth, e.g.
//                       com.cardstreet.signin. This becomes the JWT `sub`.
//   APPLE_PRIVATE_KEY_PATH  Path to the downloaded .p8 file.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const TEAM_ID = process.env.APPLE_TEAM_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const SERVICES_ID = process.env.APPLE_SERVICES_ID;
const KEY_PATH = process.env.APPLE_PRIVATE_KEY_PATH;

const missing = Object.entries({ APPLE_TEAM_ID: TEAM_ID, APPLE_KEY_ID: KEY_ID, APPLE_SERVICES_ID: SERVICES_ID, APPLE_PRIVATE_KEY_PATH: KEY_PATH })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error('Missing required env vars: ' + missing.join(', '));
  process.exit(1);
}

const privateKey = readFileSync(KEY_PATH, 'utf8');

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 60 * 60 * 24 * 180; // Apple caps exp at ~6 months.

const header = { alg: 'ES256', kid: KEY_ID };
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + SIX_MONTHS,
  aud: 'https://appleid.apple.com',
  sub: SERVICES_ID,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

// ES256 for JOSE must be raw r||s (IEEE P1363), not the DER encoding Node emits by default.
const signature = createSign('SHA256')
  .update(signingInput)
  .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

const jwt = `${signingInput}.${signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;

console.log('\nApple client secret (paste into Supabase > Apple > Secret Key (for OAuth)):\n');
console.log(jwt);
console.log(`\nExpires: ${new Date((now + SIX_MONTHS) * 1000).toISOString()} — regenerate before then.\n`);
