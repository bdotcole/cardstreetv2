/**
 * Read-only audit of profiles' shipping addresses against the canonical Thai
 * admin dataset. Finds rows with the khet↔khwaeng swap (the class behind
 * order d307f84c's un-shippable waybill), rows that don't resolve at all, and
 * counts clean rows.
 *
 * Writes NOTHING to the database. Swapped rows get a CAS-guarded UPDATE
 * emitted into scripts/out/thai-address-swap-fixes-<date>.sql for review and
 * manual run in the Supabase SQL Editor.
 *
 * Run: npx tsx scripts/audit-thai-addresses.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { validateThaiAddressTrio } from '@/lib/thaiAdminAreas';

// .env.local loader — strips surrounding quotes (see CLAUDE.md: unstripped
// quotes have burned scripts before).
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = v;
    }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run from a tree with .env.local)');
const supabase = createClient(url, key);

const sqlEscape = (s: string) => s.replace(/'/g, "''");

interface Row {
    id: string;
    username: string | null;
    province: string | null;
    state: string | null;
    district: string | null;
    postcode: string | null;
}

const counts = { total: 0, incomplete: 0, valid: 0, swapped: 0, unresolved: 0 };
const fixes: string[] = [];
const unresolved: string[] = [];

async function main() {
let cursor = '';
for (;;) {
    let q = supabase
        .from('profiles')
        .select('id, username, province, state, district, postcode')
        .or('province.not.is.null,state.not.is.null,district.not.is.null')
        .order('id', { ascending: true })
        .limit(500);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q.returns<Row[]>();
    if (error) throw error;
    if (!data || data.length === 0) break;
    cursor = data[data.length - 1].id;

    for (const row of data) {
        counts.total++;
        const province = (row.province || '').trim();
        const state = (row.state || '').trim();
        const district = (row.district || '').trim();
        if (!province || !state || !district) {
            counts.incomplete++;
            continue;
        }
        // profiles.state = อำเภอ/เขต (dataset district);
        // profiles.district = ตำบล/แขวง (dataset subdistrict).
        const trio = validateThaiAddressTrio({ province, district: state, subdistrict: district });
        if (trio.status === 'valid') {
            counts.valid++;
        } else if (trio.status === 'swapped') {
            counts.swapped++;
            fixes.push(
                `-- ${row.username || row.id}: state '${state}' / district '${district}' -> '${trio.canonical.district}' / '${trio.canonical.subdistrict}'\n` +
                `UPDATE profiles SET state = '${sqlEscape(trio.canonical.district)}', district = '${sqlEscape(trio.canonical.subdistrict)}', postcode = '${sqlEscape(trio.canonical.postcode)}'\n` +
                `WHERE id = '${row.id}' AND state = '${sqlEscape(state)}' AND district = '${sqlEscape(district)}';`,
            );
        } else {
            counts.unresolved++;
            unresolved.push(`${row.username || row.id}: ${province} / ${state} / ${district} / ${row.postcode || '-'}`);
        }
    }
    if (data.length < 500) break;
}

console.log('\nProfiles with any address data:', counts.total);
console.log('  complete + valid   :', counts.valid);
console.log('  swapped (fixable)  :', counts.swapped);
console.log('  unresolved trio    :', counts.unresolved);
console.log('  incomplete fields  :', counts.incomplete);

if (unresolved.length) {
    console.log('\nUnresolved rows (need eyes, no auto-fix):');
    for (const u of unresolved) console.log('  ' + u);
}

if (fixes.length) {
    const outDir = path.join(process.cwd(), 'scripts', 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const outPath = path.join(outDir, `thai-address-swap-fixes-${stamp}.sql`);
    const header =
        `-- Swapped khet/khwaeng profile fixes generated ${new Date().toISOString()} by scripts/audit-thai-addresses.ts\n` +
        `-- Review, then run in the Supabase SQL Editor. Each UPDATE is CAS-guarded on the current bad values.\n\n`;
    fs.writeFileSync(outPath, header + fixes.join('\n\n') + '\n');
    console.log(`\nWrote ${fixes.length} CAS-guarded UPDATE(s) to ${outPath}`);
} else {
    console.log('\nNo swapped rows — nothing to fix.');
}
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
