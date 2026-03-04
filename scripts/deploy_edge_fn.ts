/**
 * Deploys batch-price-english via Supabase Management API (PATCH)
 * and sets up the pg_cron daily schedule.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local' });

const PROJECT_REF = 'fdxgzddvywtmnqsaqysx';
const ACCESS_TOKEN = 'sbp_6666684bd695f180a2cf4158f0903e25c19d1bd3';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

async function deployFunction() {
  const fnPath = path.join('supabase', 'functions', 'batch-price-english', 'index.ts');
  const code = fs.readFileSync(fnPath, 'utf-8');
  console.log(`\n[1] Deploying batch-price-english (${code.length} chars)...`);

  // Use PATCH as per Supabase Management API docs
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/batch-price-english`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: code,
        verify_jwt: false,
      }),
    }
  );

  const text = await resp.text();
  if (resp.ok) {
    console.log('✅ Deploy successful!');
    try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
    return true;
  } else {
    // Try POST (create/upsert)
    console.warn(`  PATCH failed (${resp.status}): ${text}`);
    console.log('  Retrying with POST...');
    const resp2 = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slug: 'batch-price-english',
          name: 'batch-price-english',
          body: code,
          verify_jwt: false,
        }),
      }
    );
    const text2 = await resp2.text();
    if (resp2.ok) {
      console.log('✅ POST deploy successful!');
      return true;
    }
    console.error(`  POST also failed (${resp2.status}): ${text2}`);
    return false;
  }
}

async function setupCron() {
  console.log('\n[2] Setting up pg_cron daily schedule...');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Verify pg_net is available
  const { data: netCheck } = await supabase
    .from('pg_extension' as any)
    .select('extname')
    .eq('extname', 'pg_net');

  const hasPgNet = netCheck && netCheck.length > 0;
  console.log(`  pg_net available: ${hasPgNet}`);

  const cronBody = hasPgNet
    ? `SELECT net.http_post(url := '${FUNCTIONS_URL}/batch-price-english', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ${SERVICE_ROLE_KEY}'), body := '{}'::jsonb); `
    : `/* pg_net not available - cron registered but needs pg_net extension */`;

  // Schedule via Management API
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
                    SELECT cron.schedule(
                      'price-english-cards-daily',
                      '0 0 * * *',
                      $cmd$${cronBody}$cmd$
                    );
                `
      }),
    }
  );
  const text = await resp.text();
  if (resp.ok) {
    console.log('✅ Cron job scheduled for midnight UTC daily!');
  } else {
    console.warn(`  DB query API (${resp.status}): ${text}`);
    console.log('\n  📋 Run this SQL manually in Supabase SQL Editor:');
    console.log(`
SELECT cron.schedule(
  'price-english-cards-daily',
  '0 0 * * *',
  $$
    SELECT net.http_post(
      url := '${FUNCTIONS_URL}/batch-price-english',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ${SERVICE_ROLE_KEY}'
      ),
      body := '{}'::jsonb
    );
  $$
);`);
  }
}

async function testEndpoint() {
  console.log('\n[3] Testing function endpoint with a single set (base1)...');
  const resp = await fetch(`${FUNCTIONS_URL}/batch-price-english`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ setId: 'base1' }),
  });
  const result = await resp.json();
  console.log(`  Status: ${resp.status}`);
  console.log(`  Response:`, JSON.stringify(result, null, 2));
}

async function main() {
  console.log('=== batch-price-english Full Deploy ===');
  const deployed = await deployFunction();
  await setupCron();
  if (deployed) {
    // Wait 3 seconds for deployment to propagate
    await new Promise(r => setTimeout(r, 3000));
    await testEndpoint();
  }
}

main();
