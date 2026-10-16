/**
 * READ-ONLY diagnostic for cancelled Flash courier pickups.
 *
 * Lists every parcel whose courier pickup is still 'scheduled' and unscanned,
 * fetches Flash's pickup tickets for the Bangkok days involved (plus any
 * extra days given), and prints what app/api/cron/reconcile-pickups would
 * decide for each, using the same lib/pickupTickets code. Writes nothing to
 * the database, sends no notification, books nothing.
 *
 * Run (from the repo root or a worktree):
 *   npx tsx scripts/diag-pickup-tickets.ts [path/to/.env.local] [--production] [YYYY-MM-DD ...]
 *
 * --production signs the ticket requests with the production Flash account
 * even when the env file says training (the endpoint is read-only). Pass a
 * worktree's env as ../../../.env.local. Git Bash: set MSYS_NO_PATHCONV=1
 * so nothing in the arguments is rewritten as a Windows path.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const envPath = args.find((a) => a.endsWith('.env.local') || a.endsWith('.env')) || '.env.local';
const forceProduction = args.includes('--production');
const extraDates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

// Same dotenv convention as the other scripts: strip the quotes Next.js
// strips, or the API key reaches Flash with literal quotes around it.
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v.trim();
}
if (forceProduction) process.env.FLASH_EXPRESS_ENV = 'production';

const mask = (p: string | null | undefined) => (p ? String(p).replace(/^(\+?\d{3})\d+(\d{2})$/, '$1***$2') : p);

async function main() {
    // Imported after the env is loaded: lib/flashExpress reads it at call time,
    // and the Supabase client needs the URL + service key.
    const { createClient } = await import('@supabase/supabase-js');
    const { listPickupTickets } = await import('@/lib/flashExpress');
    const { loadScheduledParcels, decidePickup, ticketDatesFor, ticketsForParcel, bangkokYmd } = await import('@/lib/pickupTickets');

    console.log(`Flash env: ${process.env.FLASH_EXPRESS_ENV || 'training'}${forceProduction ? ' (forced)' : ''}; read-only`);
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { parcels, error } = await loadScheduledParcels(admin);
    if (error) {
        console.log(`loadScheduledParcels failed: ${error.code ?? ''} ${error.message}`);
        if (error.code === '42703') console.log('-> 20261016_pickup_cancelled.sql is not applied; the cron exits clean until it is.');
        return;
    }
    console.log(`\n=== ${parcels.length} parcel(s) with a 'scheduled' pickup and no Flash scan ===`);
    for (const p of parcels) {
        console.log(JSON.stringify({
            pno: p.trackingNumber, orders: p.orderIds.map((id) => id.slice(0, 8)), seller: p.sellerName,
            pickupId: p.pickupId, bookedAt: new Date(p.bookedAt).toISOString(), bookedDayBkk: bangkokYmd(p.bookedAt),
            phone: mask(p.phone), postcode: p.postcode,
            notifiedAt: p.cancelledNotifiedAt ? new Date(p.cancelledNotifiedAt).toISOString() : null,
        }));
    }

    const dates = [...new Set([...ticketDatesFor(parcels.map((p) => p.bookedAt)), ...extraDates])].sort();
    console.log(`\n=== Flash pickup tickets for ${dates.length} day(s): ${dates.join(', ') || '(none)'} ===`);
    const tickets: Awaited<ReturnType<typeof listPickupTickets>> = [];
    for (const date of dates) {
        try {
            const day = await listPickupTickets(date);
            tickets.push(...day);
            console.log(`${date}: ${day.length} ticket(s)`);
            for (const t of day) {
                console.log('  ' + JSON.stringify({
                    id: t.ticketPickupId, createdAt: new Date(t.createdAt * 1000).toISOString(), state: t.state, stateText: t.stateText,
                    srcName: t.srcName, phone: mask(t.phone), postalCode: t.postalCode, parcels: t.parcelNumber, courier: t.staffInfoName || null,
                }));
            }
        } catch (err) {
            console.log(`${date}: FAILED ${err instanceof Error ? err.message : String(err)} (the cron would stop here without judging any parcel)`);
        }
    }

    console.log('\n=== Decisions (what the cron would do; nothing is written here) ===');
    for (const p of parcels) {
        const mine = ticketsForParcel(p, tickets);
        const d = decidePickup(p, tickets);
        const alreadyTold = p.cancelledNotifiedAt !== null && p.cancelledNotifiedAt >= p.bookedAt;
        const action =
            d.kind === 'cancelled'
                ? `set pickup_status='cancelled' (ticket ${d.ticket.ticketPickupId}); ${alreadyTold ? 'seller already told for this booking' : 'notify seller once'}`
                : d.kind === 'live'
                  ? d.redispatched
                      ? `still live under re-dispatched ticket ${d.ticket.ticketPickupId} (${d.ticket.stateText}); store that id`
                      : `still live (ticket ${d.ticket.ticketPickupId}, ${d.ticket.stateText}); no change`
                  : 'no matching ticket; leave as is';
        console.log(`${p.trackingNumber} [${p.sellerName}] matched ${mine.length} ticket(s) ${mine.map((t) => t.ticketPickupId).join(',') || '-'} -> ${d.kind}: ${action}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
