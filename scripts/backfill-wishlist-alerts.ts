/**
 * ONE-OFF: send the wishlist alerts the Pro gate suppressed.
 *
 * lib/wishlistAlerts.ts only ever alerted Pro wishlisters, so every free
 * account's wishlist was inert -- a card they asked to be told about could go
 * up for sale, sell, and be relisted without a single notification. That gate
 * came off on 2026-09-05 (lib/entitlements.ts FEATURE_TIERS.wishlist_alerts),
 * but a gate only affects listings created AFTER it changes. The matches
 * already sitting in the table were never going to fire on their own -- this
 * clears that backlog once.
 *
 * It replays production's own notifyWishlistersOfListing rather than
 * reimplementing the send, so every guard still applies: the seller must be
 * chargeable, sellers are never alerted about their own listing, the 24h
 * per-user-per-card dedupe holds, and the 25-per-listing fan-out cap holds.
 * That also makes it idempotent -- a second run finds every target already in
 * wishlist_alert_log and sends nothing.
 *
 * Dry run:  npx tsx scripts/backfill-wishlist-alerts.ts
 * Send:     npx tsx scripts/backfill-wishlist-alerts.ts --commit
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
// Safe as a hoisted import despite the .env.local load below: every Supabase
// and Courier client inside is lazily constructed at call time, not at module
// load (the same reason scripts/sweep-stale-accepted-offer-reminders.ts can
// import lib/courier statically).
import { notifyWishlistersOfListing } from '@/lib/wishlistAlerts';

// .env.local loader -- strips surrounding quotes (see CLAUDE.md: unstripped
// quotes have burned scripts before). Walks up from cwd so this still works
// when run from a git worktree, which has no .env.local of its own.
function findEnvFile(): string | null {
    let dir = process.cwd();
    for (;;) {
        const candidate = path.join(dir, '.env.local');
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

const envPath = findEnvFile();
if (envPath) {
    // Split on /\r?\n/, not '\n'. The file is CRLF, a JS dot never matches \r,
    // so a trailing \r makes the value group fail to match and every var is
    // silently skipped -- the loader appears to run and sets nothing.
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)/);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = v;
    }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run from a tree with .env.local)');

const COMMIT = process.argv.includes('--commit');

interface WishRow { card_id: string; user_id: string }
interface ListingRow { id: string; card_id: string; seller_id: string; card_data: { name?: string } | null }

async function main() {
    const admin = createClient(url!, key!);

    // Paged: .limit() alone silently caps at PostgREST's 1000-row ceiling, and
    // a partial wishlist read would look like a clean "nothing to do".
    const wishlisted = new Map<string, Set<string>>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('wishlists')
            .select('card_id, user_id')
            .order('card_id', { ascending: true })
            .range(from, from + PAGE - 1)
            .returns<WishRow[]>();
        if (error) throw new Error(`wishlists read failed: ${error.message}`);
        for (const row of data ?? []) {
            if (!wishlisted.has(row.card_id)) wishlisted.set(row.card_id, new Set());
            wishlisted.get(row.card_id)!.add(row.user_id);
        }
        if (!data || data.length < PAGE) break;
    }
    console.log(`Wishlist rows cover ${wishlisted.size} distinct card(s).`);
    if (wishlisted.size === 0) return;

    const cardIds = [...wishlisted.keys()];
    const listings: ListingRow[] = [];
    // Chunked .in() -- a several-thousand-id filter would blow the URL length.
    const CHUNK = 200;
    for (let i = 0; i < cardIds.length; i += CHUNK) {
        const { data, error } = await admin
            .from('listings')
            .select('id, card_id, seller_id, card_data')
            .eq('status', 'active')
            .in('card_id', cardIds.slice(i, i + CHUNK))
            .returns<ListingRow[]>();
        if (error) throw new Error(`listings read failed: ${error.message}`);
        listings.push(...(data ?? []));
    }

    // A listing whose only wishlister is its own seller is not a match --
    // notifyWishlistersOfListing skips those, so counting them here would
    // overstate the backlog.
    const matches = listings.filter((l) =>
        [...(wishlisted.get(l.card_id) ?? [])].some((u) => u !== l.seller_id),
    );
    const matchedCards = new Set(matches.map((l) => l.card_id));

    console.log(
        `${matches.length} active listing(s) across ${matchedCards.size} card(s) match a wishlist.`,
    );
    for (const l of matches) {
        console.log(`  ${l.card_id.padEnd(24)} ${(l.card_data?.name ?? '').slice(0, 40).padEnd(40)} listing ${l.id}`);
    }

    if (!COMMIT) {
        console.log('\nDry run -- nothing sent. Re-run with --commit to send.');
        return;
    }

    let sent = 0;
    for (const l of matches) {
        try {
            const r = await notifyWishlistersOfListing(l.id);
            sent += r.sent;
        } catch (e) {
            console.error(`  listing ${l.id} failed:`, (e as Error)?.message);
        }
    }
    console.log(`\nDispatched ${sent} alert(s).`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
