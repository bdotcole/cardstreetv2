/**
 * Regenerates lib/data/thaiAdminAreas.json from the thailand-geography-data
 * dataset (province -> district/อำเภอ-เขต -> subdistrict/ตำบล-แขวง, with
 * English names and per-subdistrict postal codes).
 *
 * Source: https://github.com/thailand-geography-data/thailand-geography-json
 *         src/{provinces,districts,subdistricts}.json
 * Chosen over kongvut/thai-province-data because it carries the post-2017
 * Bangkok khwaeng re-splits (all 180 khwaengs — kongvut stops at 170, missing
 * e.g. วงศ์สว่าง, บางนาเหนือ/ใต้, พลับพลา, which real CardStreet profiles
 * already use).
 *
 * Names are stored WITHOUT administrative prefixes (เขต/อำเภอ/Khet/Amphoe...)
 * to match how profiles already store them ("หางดง", not "อำเภอหางดง") and the
 * bare forms Flash Express accepts. Compact keys keep the file small:
 *   { v, provinces: [{ t, e, d: [{ t, e, s: [{ t, e, z }] }] }] }
 *   t = Thai name, e = English name, z = postal code (string).
 *
 * Run: node scripts/generate-thai-admin-areas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/thailand-geography-data/thailand-geography-json/main/src';

const OUT_PATH = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'lib', 'data', 'thaiAdminAreas.json',
);

// Administrative prefixes never part of the proper name. เมือง is NOT stripped
// (it's part of real district names like เมืองเชียงใหม่).
const TH_PREFIX = /^(เขต|อำเภอ|กิ่งอำเภอ|ตำบล|แขวง)\s*/;
const EN_PREFIX = /^(khet|amphoe|king amphoe|tambon|khwaeng)\s+/i;

const stripTh = (s) => (s || '').trim().replace(TH_PREFIX, '').trim();
const stripEn = (s) => (s || '').trim().replace(EN_PREFIX, '').trim();

async function fetchJson(name) {
    const url = `${BASE}/${name}.json`;
    console.log(`Fetching ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch ${name} failed: ${res.status}`);
    return res.json();
}

const [provincesRaw, districtsRaw, subdistrictsRaw] = await Promise.all([
    fetchJson('provinces'),
    fetchJson('districts'),
    fetchJson('subdistricts'),
]);

const subsByDistrictCode = new Map();
for (const s of subdistrictsRaw) {
    const arr = subsByDistrictCode.get(s.districtCode) || [];
    arr.push(s);
    subsByDistrictCode.set(s.districtCode, arr);
}
const districtsByProvinceCode = new Map();
for (const d of districtsRaw) {
    const arr = districtsByProvinceCode.get(d.provinceCode) || [];
    arr.push(d);
    districtsByProvinceCode.set(d.provinceCode, arr);
}

const provinces = provincesRaw
    .map((p) => ({
        t: stripTh(p.provinceNameTh),
        e: stripEn(p.provinceNameEn),
        d: (districtsByProvinceCode.get(p.provinceCode) || [])
            .map((d) => ({
                t: stripTh(d.districtNameTh),
                e: stripEn(d.districtNameEn),
                s: (subsByDistrictCode.get(d.districtCode) || [])
                    .map((s) => ({
                        t: stripTh(s.subdistrictNameTh),
                        e: stripEn(s.subdistrictNameEn),
                        z: String(s.postalCode ?? ''),
                    }))
                    .sort((a, b) => a.t.localeCompare(b.t, 'th')),
            }))
            .sort((a, b) => a.t.localeCompare(b.t, 'th')),
    }))
    .sort((a, b) => a.t.localeCompare(b.t, 'th'));

const districtCount = provinces.reduce((n, p) => n + p.d.length, 0);
const subCount = provinces.reduce((n, p) => n + p.d.reduce((m, d) => m + d.s.length, 0), 0);

// Sanity floor: 77 provinces / 928 districts / ~7.4k subdistricts, and the
// post-2017 Bangkok khwaeng count. Refuse to write a truncated file.
const bkk = provinces.find((p) => p.t === 'กรุงเทพมหานคร');
const bkkSubCount = bkk ? bkk.d.reduce((n, d) => n + d.s.length, 0) : 0;
if (provinces.length !== 77 || districtCount < 900 || subCount < 7000 || bkkSubCount < 180) {
    throw new Error(`Suspicious counts: ${provinces.length} provinces, ${districtCount} districts, ${subCount} subdistricts, ${bkkSubCount} BKK khwaengs`);
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify({ v: 1, provinces }));
const kb = Math.round(fs.statSync(OUT_PATH).size / 1024);
console.log(`Wrote ${OUT_PATH} — ${provinces.length} provinces, ${districtCount} districts, ${subCount} subdistricts (${bkkSubCount} BKK khwaengs), ${kb} KB`);

// Spot-check the rows behind the 2026-07-30 manual-label incident + the
// post-2017 khwaengs real profiles already use.
const bangKhen = bkk.d.find((d) => d.t === 'บางเขน');
const cm = provinces.find((p) => p.t === 'เชียงใหม่');
const hangDong = cm.d.find((d) => d.t === 'หางดง');
console.log('spot bangkhen:', JSON.stringify(bangKhen));
console.log('spot hangdong sanphakwan:', JSON.stringify(hangDong.s.find((s) => s.t === 'สันผักหวาน')));
for (const [khet, khwaeng] of [['บางซื่อ', 'วงศ์สว่าง'], ['วังทองหลาง', 'พลับพลา'], ['บางนา', 'บางนาใต้']]) {
    const d = bkk.d.find((x) => x.t === khet);
    console.log(`spot ${khet}/${khwaeng}:`, d?.s.some((s) => s.t === khwaeng) ? 'present' : 'MISSING');
}
