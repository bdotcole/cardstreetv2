/**
 * ONE-OFF: payment reminder for accepted offers older than the daily cron's
 * window.
 *
 * app/api/cron/nudge-accepted-offers caps at MAX_AGE_DAYS=14 so a month-old
 * acceptance isn't resurrected at a price both sides have moved on from. That
 * leaves a backlog from before the cron existed — offers accepted in July that
 * were never paid and never followed up, on listings that are all still active.
 * This clears that backlog once, on the founder's explicit call.
 *
 * It is the deliberate complement of the cron: same guards (still `accepted`,
 * never ordered, listing still `active`, never nudged), same CAS claim on
 * payment_nudge_count, same courier sender — only the age window is inverted.
 * Once run, those rows carry payment_nudge_count=1 and the daily cron will
 * never pick them up (they're outside its window anyway), so this is
 * self-limiting even if re-run.
 *
 * Dry run:  npx tsx scripts/sweep-stale-accepted-offer-reminders.ts
 * Send:     npx tsx scripts/sweep-stale-accepted-offer-reminders.ts --commit
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { sendOfferPaymentReminderNotification } from '@/lib/courier';
import { cardNameFromListingEmbed } from '@/lib/offerPolicy';

// .env.local loader — strips surrounding quotes (see CLAUDE.md: unstripped
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

// Mirrors MAX_AGE_DAYS in the cron — this script takes everything OLDER.
const CRON_MAX_AGE_DAYS = 14;
const COMMIT = process.argv.includes('--commit');

async function main() {
    const ageFloor = new Date(Date.now() - CRON_MAX_AGE_DAYS * 86_400_000).toISOString();

    const { data: stale, error } = await supabase
        .from('offers')
        .select('id, buyer_id, listing_id, amount, created_at, updated_at, payment_nudge_count')
        .eq('status', 'accepted')
        .is('accepted_order_id', null)
        .lt('created_at', ageFloor)          // inverse of the cron's .gte
        .eq('payment_nudge_count', 0)        // never reminded by any path
        .order('created_at', { ascending: true });

    if (error) throw new Error(`query failed: ${error.message}`);

    console.log(`${COMMIT ? 'SENDING' : 'DRY RUN'} — accepted, unpaid, never reminded, older than ${CRON_MAX_AGE_DAYS}d: ${stale?.length ?? 0}\n`);

    let sent = 0, skippedInactive = 0, failed = 0, lostRace = 0;
    let baht = 0;

    for (const offer of stale ?? []) {
        // Never point a buyer at a card that has since sold — there is no
        // reserve, so Buy-Now can have taken it at any point.
        const { data: listing } = await supabase
            .from('listings')
            .select('id, status, card_data')
            .eq('id', offer.listing_id)
            .maybeSingle();

        const cardName = cardNameFromListingEmbed({ card_data: listing?.card_data });
        const ageDays = Math.round((Date.now() - new Date(offer.created_at).getTime()) / 86_400_000);

        if (!listing || listing.status !== 'active') {
            console.log(`  skip  ${offer.id.slice(0, 8)}  ฿${offer.amount}  ${cardName ?? '?'} — listing ${listing?.status ?? 'missing'}`);
            skippedInactive++;
            continue;
        }

        if (!COMMIT) {
            console.log(`  send  ${offer.id.slice(0, 8)}  ฿${offer.amount}  ${ageDays}d  ${cardName ?? '?'}`);
            sent++;
            baht += Number(offer.amount);
            continue;
        }

        // CAS the claim before sending, exactly as the cron does: a crash after
        // this point costs a missed reminder rather than a duplicate.
        const { data: claimed, error: claimErr } = await supabase
            .from('offers')
            .update({ payment_nudge_count: 1, payment_nudge_sent_at: new Date().toISOString() })
            .eq('id', offer.id)
            .eq('status', 'accepted')
            .is('accepted_order_id', null)
            .eq('payment_nudge_count', 0)
            .select('id');

        if (claimErr) { console.log(`  ERROR ${offer.id.slice(0, 8)} claim: ${claimErr.message}`); failed++; continue; }
        if (!claimed || claimed.length !== 1) { console.log(`  race  ${offer.id.slice(0, 8)} — already claimed`); lostRace++; continue; }

        try {
            await sendOfferPaymentReminderNotification(offer.buyer_id, {
                offerId: offer.id,
                listingId: offer.listing_id,
                amount: offer.amount,
                cardName,
            });
            console.log(`  sent  ${offer.id.slice(0, 8)}  ฿${offer.amount}  ${ageDays}d  ${cardName ?? '?'}`);
            sent++;
            baht += Number(offer.amount);
        } catch (e) {
            // The claim stands — better a missed reminder than a double-send.
            console.log(`  ERROR ${offer.id.slice(0, 8)} send: ${e}`);
            failed++;
        }
    }

    console.log(`\n${COMMIT ? 'sent' : 'would send'}: ${sent} (฿${baht.toLocaleString()} of agreed prices) | skipped inactive: ${skippedInactive} | lost race: ${lostRace} | failed: ${failed}`);
    if (!COMMIT) console.log('\nRe-run with --commit to actually send.');
}

main().catch((e) => { console.error(e); process.exit(1); });
