/**
 * Assert-based checks for the Thai address stack: the Bangkok-aware Google
 * parser, the canonical-dataset validators, and the Flash leg resolver —
 * including the exact regression that produced order d307f84c's un-shippable
 * waybill (khet/khwaeng saved swapped).
 *
 * Run: npx tsx scripts/check-thai-address-logic.ts
 * No network, no DB — pure logic against lib/data/thaiAdminAreas.json.
 */
import assert from 'node:assert';
import { parseGoogleAddressToThai } from '@/lib/utils/parseGoogleAddress';
import { normalizeThaiAreaName, isBangkokLike } from '@/lib/utils/thaiAddressNormalize';
import {
    validateThaiAddressTrio,
    resolveFlashLeg,
    canonicalCapitalForProvince,
    listDistricts,
    listSubdistricts,
} from '@/lib/thaiAdminAreas';

let passed = 0;
function check(name: string, fn: () => void) {
    try {
        fn();
        passed++;
        console.log(`  ok  ${name}`);
    } catch (e) {
        console.error(`FAIL  ${name}`);
        throw e;
    }
}

const c = (types: string[], long_name: string) => ({ long_name, short_name: long_name, types });

// ── Google parser ──

check('parser: Bangkok khet→district, khwaeng→sub_district', () => {
    const parsed = parseGoogleAddressToThai([
        c(['street_number'], '8/40'),
        c(['route'], 'รามอินทรา 19'),
        c(['sublocality_level_2', 'sublocality', 'political'], 'อนุสาวรีย์'),
        c(['sublocality_level_1', 'sublocality', 'political'], 'บางเขน'),
        c(['administrative_area_level_1', 'political'], 'กรุงเทพมหานคร'),
        c(['postal_code'], '10220'),
    ]);
    assert.equal(parsed.district, 'บางเขน');
    assert.equal(parsed.sub_district, 'อนุสาวรีย์');
    assert.equal(parsed.postal_code, '10220');
});

check('parser: Bangkok recognized from English province name', () => {
    const parsed = parseGoogleAddressToThai([
        c(['sublocality_level_1', 'political'], 'Chatuchak'),
        c(['sublocality_level_2', 'political'], 'Chomphon'),
        c(['administrative_area_level_1', 'political'], 'Bangkok'),
    ]);
    assert.equal(parsed.district, 'Chatuchak');
    assert.equal(parsed.sub_district, 'Chomphon');
});

check('parser: upcountry amphoe→district, tambon→sub_district (unchanged)', () => {
    const parsed = parseGoogleAddressToThai([
        c(['administrative_area_level_2', 'political'], 'หางดง'),
        c(['sublocality_level_1', 'political'], 'สันผักหวาน'),
        c(['administrative_area_level_1', 'political'], 'เชียงใหม่'),
        c(['postal_code'], '50230'),
    ]);
    assert.equal(parsed.district, 'หางดง');
    assert.equal(parsed.sub_district, 'สันผักหวาน');
});

check('parser: upcountry locality never doubles as sub_district', () => {
    const parsed = parseGoogleAddressToThai([
        c(['locality', 'political'], 'สันทราย'),
        c(['administrative_area_level_1', 'political'], 'เชียงใหม่'),
    ]);
    assert.equal(parsed.district, 'สันทราย');
    assert.equal(parsed.sub_district, '');
});

// ── Normalizer ──

check('normalize strips administrative prefixes, keeps เมือง', () => {
    assert.equal(normalizeThaiAreaName('เขตบางเขน'), 'บางเขน');
    assert.equal(normalizeThaiAreaName(' แขวงอนุสาวรีย์ '), 'อนุสาวรีย์');
    assert.equal(normalizeThaiAreaName('อ.หางดง'), 'หางดง');
    assert.equal(normalizeThaiAreaName('Khet Bang Khen'), 'Bang Khen');
    assert.equal(normalizeThaiAreaName('เมืองเชียงใหม่'), 'เมืองเชียงใหม่');
    assert.ok(isBangkokLike('กทม.'));
    assert.ok(isBangkokLike('Bangkok'));
    assert.ok(!isBangkokLike('เชียงใหม่'));
});

check('normalize survives real-world dirt: zero-width chars, NBSP, เเ for แ', () => {
    assert.equal(normalizeThaiAreaName('บาง​เขน'), 'บางเขน');
    assert.equal(normalizeThaiAreaName('บางเขน﻿'), 'บางเขน');
    assert.equal(normalizeThaiAreaName('Bang Khen'), 'Bang Khen');
    assert.equal(normalizeThaiAreaName('เเม่นาเรือ'), 'แม่นาเรือ');
});

check('trio: audit-observed variants now resolve', () => {
    // "เมือง" shorthand for the provincial-capital district
    const mueang = validateThaiAddressTrio({ province: 'ระยอง', district: 'เมือง', subdistrict: 'เนินพระ' });
    assert.equal(mueang.status, 'valid');
    // province name repeated in the district slot
    const repeated = validateThaiAddressTrio({ province: 'นนทบุรี', district: 'นนทบุรี', subdistrict: 'บางรักน้อย' });
    assert.equal(repeated.status, 'valid');
    // เเ typing variant
    const doubleE = validateThaiAddressTrio({ province: 'พะเยา', district: 'เมืองพะเยา', subdistrict: 'เเม่นาเรือ' });
    assert.equal(doubleE.status, 'valid');
    // post-2017 Bangkok khwaengs exist (kongvut's data stopped at 170)
    const post2017 = validateThaiAddressTrio({ province: 'กรุงเทพมหานคร', district: 'บางซื่อ', subdistrict: 'วงศ์สว่าง' });
    assert.equal(post2017.status, 'valid');
    // ...including as a swap
    const post2017Swap = validateThaiAddressTrio({ province: 'กรุงเทพมหานคร', district: 'บางนาใต้', subdistrict: 'บางนา' });
    assert.equal(post2017Swap.status, 'swapped');
    // spacing-insensitive romanized names
    const en = validateThaiAddressTrio({ province: 'Nonthaburi', district: 'Bang Kruai', subdistrict: 'BangKhuWiang' });
    assert.equal(en.status, 'valid');
});

// ── Trio validation ──

check('trio: ari (เชียงใหม่/หางดง/สันผักหวาน) validates with zip 50230', () => {
    const r = validateThaiAddressTrio({ province: 'เชียงใหม่', district: 'หางดง', subdistrict: 'สันผักหวาน' });
    assert.equal(r.status, 'valid');
    assert.equal(r.status === 'valid' && r.canonical.postcode, '50230');
});

check('trio: the d307f84c swap is detected and corrected', () => {
    // Jzolate's saved row: state=อนุสาวรีย์ (khwaeng), district=บางเขน (khet).
    // profiles.state feeds `district` here, profiles.district feeds `subdistrict`.
    const r = validateThaiAddressTrio({ province: 'กรุงเทพ', district: 'อนุสาวรีย์', subdistrict: 'บางเขน' });
    assert.equal(r.status, 'swapped');
    if (r.status === 'swapped') {
        assert.equal(r.canonical.province, 'กรุงเทพมหานคร');
        assert.equal(r.canonical.district, 'บางเขน');
        assert.equal(r.canonical.subdistrict, 'อนุสาวรีย์');
        assert.equal(r.canonical.postcode, '10220');
    }
});

check('trio: prefixed spellings resolve to bare canonical names', () => {
    const r = validateThaiAddressTrio({ province: 'กรุงเทพฯ', district: 'เขตบางเขน', subdistrict: 'แขวงอนุสาวรีย์' });
    assert.equal(r.status, 'valid');
    if (r.status === 'valid') {
        assert.equal(r.canonical.district, 'บางเขน');
        assert.equal(r.canonical.subdistrict, 'อนุสาวรีย์');
    }
});

check('trio: unrelated pair stays invalid', () => {
    const r = validateThaiAddressTrio({ province: 'กรุงเทพ', district: 'อนุสาวรีย์', subdistrict: 'สีลม' });
    assert.equal(r.status, 'invalid');
});

// ── Flash leg resolution ──

check('resolveFlashLeg repairs the exact d307f84c dst leg', () => {
    const r = resolveFlashLeg({ provinceName: 'กรุงเทพ', cityName: 'อนุสาวรีย์', districtName: 'บางเขน', postalCode: '10220' });
    assert.ok(r);
    assert.equal(r!.provinceName, 'กรุงเทพมหานคร');
    assert.equal(r!.cityName, 'บางเขน');
    assert.equal(r!.districtName, 'อนุสาวรีย์');
    assert.ok(r!.changed);
});

check('resolveFlashLeg: postcode anchors an unmatchable city', () => {
    const r = resolveFlashLeg({ provinceName: 'กรุงเทพ', cityName: 'ไม่มีจริง', districtName: '', postalCode: '10220' });
    assert.ok(r);
    assert.equal(r!.cityName, 'บางเขน');
});

check('resolveFlashLeg: valid leg comes back unchanged', () => {
    const r = resolveFlashLeg({ provinceName: 'เชียงใหม่', cityName: 'หางดง', districtName: 'สันผักหวาน', postalCode: '50230' });
    assert.ok(r);
    assert.equal(r!.changed, false);
});

check('resolveFlashLeg: hopeless input returns null', () => {
    assert.equal(resolveFlashLeg({ provinceName: 'Nowhere', cityName: '', districtName: '', postalCode: '' }), null);
});

check('canonicalCapitalForProvince: เมือง district upcountry, บางรัก for BKK, null unknown', () => {
    const cm = canonicalCapitalForProvince('เชียงใหม่');
    assert.equal(cm?.cityName, 'เมืองเชียงใหม่');
    assert.ok(cm?.districtName);
    const bkk = canonicalCapitalForProvince('กทม');
    assert.equal(bkk?.cityName, 'บางรัก');
    assert.equal(bkk?.districtName, 'บางรัก');
    assert.equal(canonicalCapitalForProvince('Atlantis'), null);
});

// ── API-route list helpers ──

check('list helpers slice the dataset', () => {
    const bkkDistricts = listDistricts('กรุงเทพ');
    assert.ok(bkkDistricts && bkkDistricts.length === 50);
    const subs = listSubdistricts('กรุงเทพมหานคร', 'เขตบางเขน');
    assert.ok(subs && subs.length === 2);
    assert.ok(subs!.every(s => s.z === '10220'));
});

console.log(`\n${passed} checks passed`);
