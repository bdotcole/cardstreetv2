/**
 * Deploy batch-price-english edge function using the Supabase Management API
 * Bypasses the CLI's .env.local parsing issue
 */

const fs = require('fs');
const path = require('path');

const PROJECT_REF = 'fdxgzddvywtmnqsaqysx';

// Read the env file for the service role key (needed to authenticate with Management API)
// Try clean version first
const envPath = path.join(__dirname, '.env.vercel.production');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
});

// Read the function code
const fnCode = fs.readFileSync(
    path.join(__dirname, 'supabase', 'functions', 'batch-price-english', 'index.ts'),
    'utf8'
);

const MANAGEMENT_API_KEY = env['SUPABASE_ACCESS_TOKEN'] || env['SUPABASE_SERVICE_ROLE_KEY'];

async function deploy() {
    console.log('Env keys found:', Object.keys(env));
    console.log('Project ref:', PROJECT_REF);
    console.log('Function code length:', fnCode.length, 'chars');

    if (!MANAGEMENT_API_KEY) {
        console.error('No API key found. Keys in env:', Object.keys(env));
        return;
    }

    console.log('Using key prefix:', MANAGEMENT_API_KEY.substring(0, 20) + '...');

    // The Supabase Management API for deploying functions uses multipart/form-data
    const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/batch-price-english`;

    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${MANAGEMENT_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: 'batch-price-english',
            body: fnCode,
            verify_jwt: false,
        }),
    });

    const text = await response.text();
    console.log(`Response status: ${response.status}`);
    console.log('Response:', text);
}

deploy().catch(console.error);
