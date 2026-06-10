// Local diagnostic: pull the REAL seller/buyer addresses from Supabase and run
// the production Flash estimate_rate exactly as /api/orders/estimate does, to
// reproduce why the app falls back to ฿40. Read-only. Run: node scripts/diag-flash-real.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.trim();
}

const mchId = env.FLASH_EXPRESS_MCH_ID_PRODUCTION;
const apiKey = env.FLASH_EXPRESS_KEY_PRODUCTION;
const baseUrl = 'https://open-api.flashexpress.com';
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function sign(params, key) {
    const filtered = {};
    for (const [k, v] of Object.entries(params)) {
        if (k === 'sign' || v == null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        filtered[k] = String(v);
    }
    const stringA = Object.keys(filtered).sort().map(k => `${k}=${filtered[k]}`).join('&');
    return crypto.createHash('sha256').update(`${stringA}&key=${key}`, 'utf8').digest('hex').toUpperCase();
}

async function estimate(addr) {
    const params = {
        mchId,
        nonceStr: Date.now().toString() + crypto.randomBytes(4).toString('hex'),
        ...addr, weight: '500', expressCategory: '1',
    };
    params.sign = sign(params, apiKey);
    const res = await fetch(`${baseUrl}/open/v1/orders/estimate_rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'Accept-Language': 'en' },
        body: new URLSearchParams(params).toString(),
    });
    return { status: res.status, body: await res.text() };
}

// Sellers (have a connected Stripe account) and their stored addresses.
const { data: sellers } = await supabase
    .from('profiles')
    .select('id, display_name, province, state, district, postcode, stripe_account_id, stripe_region, stripe_charges_enabled')
    .not('stripe_account_id', 'is', null);

console.log('=== Sellers (stripe_account_id not null) ===');
for (const s of sellers || []) {
    console.log({
        id: s.id, name: s.display_name, region: s.stripe_region, charges: s.stripe_charges_enabled,
        province: s.province, state: s.state, district: s.district, postcode: s.postcode,
    });
}

// A buyer: pick a profile that has address fields filled.
const { data: buyers } = await supabase
    .from('profiles')
    .select('id, display_name, province, state, district, postcode')
    .not('postcode', 'is', null)
    .limit(5);

console.log('\n=== Sample profiles with a postcode (potential buyers) ===');
for (const b of buyers || []) console.log({ id: b.id, name: b.display_name, province: b.province, state: b.state, district: b.district, postcode: b.postcode });

// Reproduce the app's call: seller addr -> buyer addr, with the SAME Bangkok
// placeholder fallbacks the route uses when a field is blank.
const seller = (sellers || [])[0];
const buyer = (buyers || [])[0];
if (seller && buyer) {
    const addr = {
        srcProvinceName: seller.province || 'กรุงเทพมหานคร',
        srcCityName: seller.state || seller.district || 'เขตบางรัก',
        srcPostalCode: seller.postcode || '10500',
        dstProvinceName: buyer.province || 'กรุงเทพมหานคร',
        dstCityName: buyer.state || buyer.district || 'เขตบางรัก',
        dstPostalCode: buyer.postcode || '10110',
    };
    console.log('\n=== Flash estimate with REAL seller -> buyer addresses ===');
    console.log('Request addr:', addr);
    console.log(await estimate(addr));
}
