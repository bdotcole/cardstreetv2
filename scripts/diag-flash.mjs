// Local-only diagnostic: call Flash Express PRODUCTION estimate_rate directly
// with the production credentials from .env.local and print the raw response.
// A rate quote is read-only — no shipment is created. Run: node scripts/diag-flash.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';

// --- minimal .env.local parser (strips surrounding quotes + trailing whitespace) ---
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.trim();
}

const mchId = (env.FLASH_EXPRESS_MCH_ID_PRODUCTION || '').trim();
const apiKey = (env.FLASH_EXPRESS_KEY_PRODUCTION || '').trim();
const baseUrl = 'https://open-api.flashexpress.com';

console.log('mchId:', JSON.stringify(mchId), '| apiKey length:', apiKey.length);

function sign(params, key) {
    const filtered = {};
    for (const [k, v] of Object.entries(params)) {
        if (k === 'sign') continue;
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        filtered[k] = String(v);
    }
    const stringA = Object.keys(filtered).sort().map(k => `${k}=${filtered[k]}`).join('&');
    return crypto.createHash('sha256').update(`${stringA}&key=${key}`, 'utf8').digest('hex').toUpperCase();
}

async function estimate(label, addr) {
    const params = {
        mchId,
        nonceStr: Date.now().toString() + crypto.randomBytes(4).toString('hex'),
        ...addr,
        weight: '500',
        expressCategory: '1',
    };
    params.sign = sign(params, apiKey);
    const res = await fetch(`${baseUrl}/open/v1/orders/estimate_rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'Accept-Language': 'en' },
        body: new URLSearchParams(params).toString(),
    });
    const text = await res.text();
    console.log(`\n=== ${label} ===`);
    console.log('HTTP', res.status);
    console.log(text);
}

// 1) The exact Bangkok placeholder route the app falls back to.
await estimate('Bangkok placeholder (Bangrak -> Khlong Toei)', {
    srcProvinceName: 'กรุงเทพมหานคร', srcCityName: 'เขตบางรัก', srcPostalCode: '10500',
    dstProvinceName: 'กรุงเทพมหานคร', dstCityName: 'เขตบางรัก', dstPostalCode: '10110',
});

// 2) A cross-province route (Bangkok -> Chiang Mai) to test up-country.
await estimate('Bangkok -> Chiang Mai', {
    srcProvinceName: 'กรุงเทพมหานคร', srcCityName: 'เขตบางรัก', srcPostalCode: '10500',
    dstProvinceName: 'เชียงใหม่', dstCityName: 'เมืองเชียงใหม่', dstPostalCode: '50000',
});
