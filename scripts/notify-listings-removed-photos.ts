/**
 * Tell a seller that listings were taken down for missing photos.
 *
 * The admin console has a Remove button but sends no notice, so the seller
 * finds the listing gone and nothing says why. This sends ONE bilingual
 * email (Thai, then English) naming the removed cards and how to relist
 * them — from the vault, with front and back photos — plus one push that
 * opens the vault (type 'listing_removed', hooks/usePushNotifications.ts).
 *
 * First use: seller d698a3ae on 2026-10-21, after the bulk lister published
 * 18 photo-less Charizards (฿175–฿220,944) in one tap; the photo rule in
 * lib/listingPhotoPolicy.ts was client-only until that day's migration.
 *
 * The removal itself happens first (admin console or SQL: status =
 * 'removed'). This script reads the seller's removed rows that carry no
 * seller photo, and nothing else.
 *
 * Usage:
 *   npx tsx scripts/notify-listings-removed-photos.ts --seller <uuid>          # dry run: prints the message
 *   npx tsx scripts/notify-listings-removed-photos.ts --seller <uuid> --send   # sends email + push
 *   --since <ISO>   only rows removed (updated_at) at or after this time; default: today 00:00 UTC
 *   --env <path>    .env.local to read; default: <repo>/.env.local
 *   --data <json>   skip the Supabase reads and take {email, name, fcmToken, rows} from this
 *                   file — for a machine whose .env.local holds no working service-role key
 *                   (the legacy JWT keys were disabled on the project; the CLI's
 *                   `npx supabase db query --linked` still reads everything).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';

const PHOTOS_REQUIRED_FROM_THB = 100;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

// .env.local loader: strips CRLF, surrounding quotes AND a literal "\r\n" text
// left inside the quotes (vercel env pull writes those; each has bitten a naive
// parser in this repo, see CLAUDE.md). Never overrides a value already set.
function loadEnv(file: string) {
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const line = raw.replace(/\r$/, '').trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        value = value.replace(/(\\r|\\n)+$/, '');
        if (!(key in process.env)) process.env[key] = value;
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type RemovedRow = {
    id: string;
    price: number | string;
    condition: string;
    card_data: Record<string, unknown> | null;
    updated_at: string;
};

function describe(row: RemovedRow): string {
    const cd = row.card_data ?? {};
    const name = String(cd.name ?? '');
    const alt = String(cd.thaiName ?? '');
    const set = typeof cd.set === 'string' ? cd.set : String((cd.set as { name?: unknown } | null)?.name ?? '');
    const number = String(cd.number ?? '');
    const label = [name, alt && alt !== name ? `(${alt})` : '', set, number].filter(Boolean).join(' · ');
    return `${label} — ฿${Number(row.price).toLocaleString('en-US')}`;
}

async function main() {
    const seller = arg('seller');
    if (!seller || !/^[0-9a-f-]{36}$/.test(seller)) {
        console.error('Usage: --seller <uuid> [--send] [--since <ISO>] [--env <path>] [--data <json>]');
        process.exit(2);
    }
    const send = process.argv.includes('--send');
    const since = arg('since') ?? new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
    loadEnv(arg('env') ?? path.resolve(__dirname, '..', '.env.local'));

    let removed: RemovedRow[];
    let email: string | null;
    let fcmToken: string | null;
    let name: string;
    const dataFile = arg('data');
    if (dataFile) {
        const d = JSON.parse(readFileSync(dataFile, 'utf8')) as {
            email?: string | null; name?: string | null; fcmToken?: string | null; rows?: RemovedRow[];
        };
        removed = (d.rows ?? []).slice().sort((a, b) => Number(b.price) - Number(a.price));
        email = d.email ?? null;
        fcmToken = d.fcmToken ?? null;
        name = d.name ?? '';
    } else {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
        const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

        const [{ data: profile }, { data: userRes }, { data: prefs }, { data: rows, error }] = await Promise.all([
            admin.from('profiles').select('display_name, username').eq('id', seller).maybeSingle(),
            admin.auth.admin.getUserById(seller),
            admin.from('notification_preferences').select('fcm_token').eq('user_id', seller).maybeSingle(),
            admin
                .from('listings')
                .select('id, price, condition, card_data, updated_at')
                .eq('seller_id', seller)
                .eq('status', 'removed')
                .is('image_front_url', null)
                .gte('updated_at', since)
                .order('price', { ascending: false }),
        ]);
        if (error) throw error;
        removed = (rows ?? []) as RemovedRow[];
        email = userRes?.user?.email ?? null;
        fcmToken = (prefs as { fcm_token?: string | null } | null)?.fcm_token ?? null;
        name = profile?.display_name || profile?.username || '';
    }

    console.log(`Seller ${seller} (${name}) · email ${email ?? 'none'} · push ${fcmToken ? 'yes' : 'no'}`);
    console.log(`${removed.length} removed listing(s) without photos since ${since}`);
    if (removed.length === 0) { console.log('Nothing to notify about.'); return; }
    for (const r of removed) console.log('  ' + describe(r));

    const n = removed.length;
    const vaultUrl = 'https://cardstreet.app/?tab=vault&utm_source=courier&utm_medium=email&utm_campaign=listing_removed';
    const list = removed.map((r) => `<li>${escapeHtml(describe(r))}</li>`).join('');
    const muted = 'style="color:#64748b"';
    const html = [
        `<p>สวัสดีคุณ${escapeHtml(name)},</p>`,
        `<p>ทีม Cardstreet ได้นำประกาศขายของคุณออกจากตลาด ${n} รายการ (รายการด้านล่าง) เพราะประกาศขายที่ราคา ฿${PHOTOS_REQUIRED_FROM_THB} ขึ้นไปต้องมีรูปถ่ายของการ์ดใบจริงทั้งด้านหน้าและด้านหลัง ประกาศเหล่านี้ใช้รูปจากแคตตาล็อกแทน ผู้ซื้อจึงไม่เห็นสภาพของการ์ดที่จะได้รับจริง</p>`,
        `<p>การ์ดทั้งหมดยังอยู่ใน Vault ของคุณตามเดิม หากต้องการลงขายอีกครั้ง ให้เปิดการ์ดใน Vault แล้วลงขายทีละใบพร้อมถ่ายรูปด้านหน้าและด้านหลัง (การลงขายหลายใบพร้อมกันด้วยรูปแคตตาล็อกใช้ได้เฉพาะการ์ดสภาพ NM ราคาต่ำกว่า ฿${PHOTOS_REQUIRED_FROM_THB})</p>`,
        `<ul>${list}</ul>`,
        `<p>หากมีคำถาม ตอบกลับอีเมลนี้ได้เลย</p>`,
        `<p><a href="${vaultUrl}">เปิด Vault ของฉัน · Open my Vault</a></p>`,
        `<hr style="border:0;border-top:1px solid #e2e8f0;margin:20px 0">`,
        `<p ${muted}>Hi ${escapeHtml(name)},</p>`,
        `<p ${muted}>We removed ${n} of your listings from the market (listed above). Listings priced at ฿${PHOTOS_REQUIRED_FROM_THB} or more need photos of the actual card, front and back. These used the catalog image instead, so buyers could not see the condition of the card they would receive.</p>`,
        `<p ${muted}>Your cards are still in your Vault. To relist one, open it in your Vault and list it on its own with a front and back photo. Bulk listing with the catalog image is only for near-mint cards under ฿${PHOTOS_REQUIRED_FROM_THB}.</p>`,
        `<p ${muted}>Questions? Just reply to this email.</p>`,
    ].join('\n');
    const subject = `ประกาศขาย ${n} รายการถูกนำออก — ต้องใช้รูปถ่ายของการ์ดจริง`;
    const push = {
        type: 'listing_removed',
        title: `ประกาศขาย ${n} รายการถูกนำออก · ${n} listing${n === 1 ? '' : 's'} removed`,
        body:
            `การ์ดราคา ฿${PHOTOS_REQUIRED_FROM_THB} ขึ้นไปต้องใช้รูปถ่ายของจริง ลงขายใหม่จาก Vault พร้อมรูปได้เลย · ` +
            `Listings at ฿${PHOTOS_REQUIRED_FROM_THB}+ need real photos. Relist from your Vault with photos.`,
    };

    console.log('\n--- email subject ---\n' + subject + '\n--- email html ---\n' + html + '\n--- push ---');
    console.log(push.title + '\n' + push.body);

    if (!send) { console.log('\nDry run. Add --send to deliver.'); return; }

    // Imported after the env is loaded: lib/courier reads its token lazily, but
    // its own imports may not.
    const { sendCampaignEmail, sendCampaignPush } = await import('../lib/courier');
    if (email) {
        const ok = await sendCampaignEmail({ userId: seller, email }, { type: 'listing_removed', subject, html });
        console.log(`email: ${ok ? 'sent' : 'FAILED'}`);
    } else {
        console.log('email: no address on the account');
    }
    if (fcmToken) {
        const ok = await sendCampaignPush({ userId: seller, fcmToken }, push);
        console.log(`push: ${ok ? 'sent' : 'FAILED'}`);
    } else {
        console.log('push: no device token');
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
