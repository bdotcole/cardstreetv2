/**
 * Takes one seller's photo-less listings off the market and tells them why.
 *
 * Real photos are required from ฿100 up (lib/listingPhotoPolicy.ts), but only
 * the single-card ListingForm enforces it: the Vault bulk lister and the
 * spreadsheet importer create listings with no image_front_url at any price.
 * This is the cleanup for a seller who listed that way.
 *
 * Dry run by default: prints the listings and how they were inserted, writes
 * nothing, sends nothing. --commit sets every active/draft/paused listing of
 * the seller that has no front photo to status='removed' (the admin takedown
 * status, lib/adminModeration.ts; sold rows are order history and are never
 * touched) and sends the seller ONE email + push naming what was removed.
 * Idempotent: a second run finds nothing left and sends nothing.
 *
 * Run (from the repo root or a worktree):
 *   npx tsx scripts/remove-photoless-listings.ts --seller <uuid | display name | username> [path/to/.env.local] [--commit]
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const envPath = args.find((a) => a.endsWith('.env.local') || a.endsWith('.env')) || '.env.local';
const commit = args.includes('--commit');
const sellerArg = args[args.indexOf('--seller') + 1];
if (!args.includes('--seller') || !sellerArg || sellerArg.startsWith('--')) {
    console.log('Usage: npx tsx scripts/remove-photoless-listings.ts --seller <uuid | display name | username> [.env.local] [--commit]');
    process.exit(1);
}

// Same dotenv convention as the other scripts: strip the quotes Next.js
// strips, or the service key reaches Supabase with literal quotes around it.
// No env file is fine when the variables are already in the environment
// (a cloud session's environment settings).
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v.trim();
}
// --commit needs Courier up front: removing listings and then failing to tell
// the seller is the outcome this script exists to avoid.
const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', ...(commit ? ['COURIER_AUTH_TOKEN'] : [])]
    .filter((k) => !process.env[k]);
if (missing.length) {
    console.log(`Missing ${missing.join(', ')} (not in ${envPath} or the environment).`);
    process.exit(1);
}

const VISIBLE_STATUSES = ['active', 'draft', 'paused'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function main() {
    // Imported after the env is loaded: lib/courier reads the Courier token
    // and the Supabase service key when first called.
    const { createClient } = await import('@supabase/supabase-js');
    const { sendListingsRemovedNoPhotosNotification } = await import('@/lib/courier');
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // A display name is not unique; refuse to guess between two people.
    let query = admin.from('profiles').select('id, display_name, username, role');
    query = UUID_RE.test(sellerArg)
        ? query.eq('id', sellerArg)
        : query.or(`display_name.eq."${sellerArg.replace(/"/g, '')}",username.eq."${sellerArg.replace(/"/g, '')}"`);
    const { data: matches, error: profileErr } = await query;
    if (profileErr) throw profileErr;
    if (!matches?.length) {
        console.log(`No profile matches "${sellerArg}".`);
        process.exit(1);
    }
    if (matches.length > 1) {
        console.log(`"${sellerArg}" matches ${matches.length} profiles; re-run with the uuid:`);
        for (const p of matches) console.log(`  ${p.id}  ${p.display_name ?? ''}  @${p.username ?? ''}`);
        process.exit(1);
    }
    const seller = matches[0];
    if (seller.role === 'admin') {
        console.log(`Refusing: ${seller.id} is an admin account (house listings).`);
        process.exit(1);
    }
    console.log(`Seller: ${seller.display_name ?? ''} @${seller.username ?? ''} (${seller.id})`);

    const listings: any[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await admin
            .from('listings')
            .select('id, card_id, card_data, price, condition, status, image_front_url, created_at')
            .eq('seller_id', seller.id)
            .in('status', VISIBLE_STATUSES)
            .order('created_at', { ascending: true })
            .range(from, from + 999);
        if (error) throw error;
        listings.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    const photoless = listings.filter((l) => !String(l.image_front_url ?? '').trim());
    console.log(`${listings.length} visible listing(s); ${photoless.length} without a photo.\n`);
    if (photoless.length === 0) return;

    for (const l of photoless) {
        const c = l.card_data || {};
        console.log(
            [l.created_at, l.status.padEnd(6), `฿${Number(l.price).toLocaleString('en-US')}`.padStart(9), l.condition, `${c.name ?? l.card_id} (${c.set ?? ''})`, l.id].join('  '),
        );
    }

    // How they were inserted. created_at is now() at transaction start, so one
    // INSERT statement shares one timestamp: the spreadsheet importer writes
    // 100 different cards per statement, a multi-copy listing writes N copies
    // of ONE card, and the Vault bulk lister writes one statement per card.
    const byStatement = new Map<string, any[]>();
    for (const l of photoless) byStatement.set(l.created_at, [...(byStatement.get(l.created_at) || []), l]);
    const multiCard = [...byStatement.values()].filter((rows) => new Set(rows.map((r) => r.card_id)).size > 1);
    console.log(`\n${byStatement.size} insert statement(s).`);
    if (multiCard.length) {
        console.log(`${multiCard.length} statement(s) inserted several different cards at once: the spreadsheet importer (/api/collection/bulk-import).`);
    } else {
        console.log('No statement inserted more than one card: listed through the app (Vault bulk lister or the listing form), not the spreadsheet importer.');
    }

    if (!commit) {
        console.log('\nDry run: nothing changed, nothing sent. Re-run with --commit to remove these and notify the seller.');
        return;
    }

    // The status filter is re-checked in the UPDATE itself, so a listing that
    // sold (checkout flips it to 'sold') since the read above is left alone.
    const removed: any[] = [];
    for (const ids of chunk(photoless.map((l) => l.id), 100)) {
        const { data, error } = await admin
            .from('listings')
            .update({ status: 'removed', updated_at: new Date().toISOString() })
            .in('id', ids)
            .in('status', VISIBLE_STATUSES)
            .select('id');
        if (error) throw error;
        const done = new Set((data || []).map((r) => r.id));
        removed.push(...photoless.filter((l) => done.has(l.id)));
    }
    console.log(`\nRemoved ${removed.length} of ${photoless.length} listing(s).`);
    if (removed.length === 0) return;

    const sent = await sendListingsRemovedNoPhotosNotification(
        seller.id,
        removed.map((l) => ({ cardName: l.card_data?.name ?? l.card_id, setName: l.card_data?.set ?? null, price: Number(l.price) })),
    );
    console.log(
        sent
            ? `Seller notified (email: ${sent.email}, push: ${sent.push}).`
            : 'Seller NOT notified: no Courier token, no email on file, or the send failed (see the log above).',
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
