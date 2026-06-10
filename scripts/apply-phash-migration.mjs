/**
 * One-off runner for 20260519_phash_card_scanning.sql.
 *
 * The repo's supabase migration history is partially out of sync with the remote DB
 * (`supabase db push` would try to replay 27 already-applied migrations), so we apply
 * this single migration directly via the service-role client, matching the pattern
 * used by scripts/run_migration.ts.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260519_phash_card_scanning.sql');
const sql = fs.readFileSync(sqlPath, 'utf-8');

async function tryExecSql() {
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (!error) return { ok: true, via: 'rpc:exec_sql' };
  return { ok: false, error: error.message };
}

async function tryPgMetaQuery() {
  // Fallback: pg-meta endpoint the Supabase dashboard uses internally.
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (res.ok) return { ok: true, via: 'pg-meta' };
  return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
}

async function verify() {
  // Lightweight sanity check: column present + RPC callable.
  const { error: colErr } = await supabase.from('pokemon_cards').select('id, phash').limit(1);
  if (colErr) return { ok: false, msg: 'phash column missing: ' + colErr.message };

  const probe = '\\x0000000000000000';
  const { error: rpcErr } = await supabase.rpc('search_pokemon_by_phash', {
    query_phash: probe,
    max_distance: 64,
    result_limit: 1,
    language_filter: null,
  });
  if (rpcErr) return { ok: false, msg: 'search_pokemon_by_phash missing: ' + rpcErr.message };

  return { ok: true };
}

(async () => {
  console.log('Applying 20260519_phash_card_scanning.sql...');

  let result = await tryExecSql();
  if (!result.ok) {
    console.log(`  exec_sql RPC unavailable (${result.error}); trying pg-meta endpoint...`);
    result = await tryPgMetaQuery();
  }

  if (!result.ok) {
    console.error('\nAutomated apply failed.');
    console.error('  ', result.error);
    console.error('\nFallback: paste the contents of supabase/migrations/20260519_phash_card_scanning.sql');
    console.error('into the Supabase SQL Editor at https://supabase.com/dashboard/project/_/sql');
    process.exit(1);
  }

  console.log(`  applied via ${result.via}`);

  const v = await verify();
  if (v.ok) console.log('  verified: phash column + search_pokemon_by_phash RPC present.');
  else {
    console.error('  verification failed:', v.msg);
    process.exit(1);
  }
})();
