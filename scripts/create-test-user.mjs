// Creates a pre-confirmed test account for App Store review.
// You run this (I don't create accounts directly):  node scripts/create-test-user.mjs
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
// Sign-in is by EMAIL + password, so give the reviewer the email below (not the username).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- credentials for the test account ---
const EMAIL = 'tester1@cardstreet.app';
const PASSWORD = 'Tester1!';
const USERNAME = 'tester1';
const FULL_NAME = 'Tester One';

// Minimal .env.local loader that strips surrounding quotes (see CLAUDE.md note).
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data, error } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true, // pre-confirmed so the reviewer can sign in immediately
  user_metadata: { username: USERNAME, full_name: FULL_NAME },
});

if (error) {
  console.error('Failed to create test user:', error.message);
  process.exit(1);
}

// Best-effort: make sure the profile row carries the username (in case the
// new-user trigger does not populate it from metadata).
const id = data.user?.id;
if (id) {
  const { error: pErr } = await admin
    .from('profiles')
    .upsert({ id, username: USERNAME, display_name: FULL_NAME }, { onConflict: 'id' });
  if (pErr) console.warn('Note: profile upsert warning:', pErr.message);
}

console.log('\nTest account ready:');
console.log('  Email (use this to sign in):', EMAIL);
console.log('  Password:', PASSWORD);
console.log('  Username:', USERNAME);
console.log('\nPut the EMAIL + PASSWORD in App Store Connect > App Review Information.\n');
