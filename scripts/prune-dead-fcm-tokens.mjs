/**
 * Prune dead FCM tokens using Courier's message log.
 *
 * A push blast to a dead token (uninstalled app) comes back UNDELIVERABLE
 * with FCM's `NotRegistered` / `InvalidRegistration` error. Since 2026-08-18
 * the blast senders attach our `user_id` to every send, so those failures are
 * attributable: this script lists recent UNDELIVERABLE firebase-fcm messages,
 * maps recipientId -> notification_preferences.user_id, and nulls the token.
 *
 * Guard: a row is only cleared when its updated_at predates the failed send —
 * a user who reinstalled since (fresh, valid token) is left alone.
 *
 * Blasts sent BEFORE the user_id change show an anon_* recipient and are
 * skipped (their tokens are unrecoverable from Courier; they will fail —
 * attributably — on the next blast and get pruned then).
 *
 * Usage:
 *   node scripts/prune-dead-fcm-tokens.mjs            # dry run, last 7 days
 *   node scripts/prune-dead-fcm-tokens.mjs --days 30  # wider window
 *   node scripts/prune-dead-fcm-tokens.mjs --commit   # actually null tokens
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// .env.local loader — strips CRLF and surrounding quotes (both have bitten
// naive parsers in this repo; see CLAUDE.md).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(path.join(root, '.env.local'), 'utf8');
for (const rawLine of envText.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
}

const COMMIT = process.argv.includes('--commit');
const daysIdx = process.argv.indexOf('--days');
const DAYS = daysIdx >= 0 ? Number(process.argv[daysIdx + 1]) || 7 : 7;
const SINCE = Date.now() - DAYS * 24 * 60 * 60 * 1000;

const courierToken = process.env.COURIER_AUTH_TOKEN;
if (!courierToken) throw new Error('COURIER_AUTH_TOKEN missing from .env.local');
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEAD_TOKEN_RE = /NotRegistered|InvalidRegistration|UNREGISTERED/i;

// ─── Collect failed-push user ids from Courier (paged, newest first) ───
/** user_id -> enqueued ms of the newest dead send seen for them */
const dead = new Map();
let skippedAnon = 0;
let cursor = null;
for (let page = 0; page < 400; page++) {
    const url = new URL('https://api.courier.com/messages');
    url.searchParams.set('enqueued_after', String(SINCE));
    url.searchParams.set('status', 'UNDELIVERABLE');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${courierToken}` } });
    if (!res.ok) throw new Error(`Courier list failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    let sawOlder = false;
    for (const m of body.results ?? []) {
        if ((m.enqueued ?? 0) < SINCE) { sawOlder = true; continue; }
        const providers = (m.providers ?? []).map((p) => p.provider);
        if (!providers.includes('firebase-fcm')) continue;
        const rid = m.recipientId ?? m.recipient ?? '';
        if (!UUID_RE.test(rid)) { skippedAnon++; continue; }
        // The list row has no error text; confirm the failure class on detail.
        const det = await fetch(`https://api.courier.com/messages/${m.id}`, {
            headers: { Authorization: `Bearer ${courierToken}` },
        });
        if (!det.ok) continue;
        const detail = await det.json();
        const fcmLeg = (detail.providers ?? []).find((p) => p.provider === 'firebase-fcm');
        const errText = fcmLeg?.error || detail.error || '';
        if (!DEAD_TOKEN_RE.test(errText)) continue;
        const prev = dead.get(rid) ?? 0;
        if ((m.enqueued ?? 0) > prev) dead.set(rid, m.enqueued ?? 0);
    }
    if (sawOlder || !body.paging?.more || !body.paging?.cursor) break;
    cursor = body.paging.cursor;
}

console.log(
    `Found ${dead.size} users with dead-token pushes in the last ${DAYS}d` +
    (skippedAnon ? ` (${skippedAnon} pre-user_id anon sends skipped)` : ''),
);

// ─── Null tokens, but only when the row hasn't refreshed since the failure ───
let pruned = 0;
let kept = 0;
for (const [userId, failedAt] of dead) {
    const { data: row } = await supabase
        .from('notification_preferences')
        .select('user_id, fcm_token, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
    if (!row?.fcm_token) { kept++; continue; }
    const refreshed = row.updated_at && Date.parse(row.updated_at) > failedAt;
    if (refreshed) {
        kept++;
        console.log(`  keep  ${userId} — token refreshed after the failed send`);
        continue;
    }
    if (COMMIT) {
        const { error } = await supabase
            .from('notification_preferences')
            .update({ fcm_token: null, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('fcm_token', row.fcm_token); // CAS: don't clobber a refresh racing us
        if (error) { console.error(`  FAIL  ${userId}: ${error.message}`); continue; }
    }
    pruned++;
    console.log(`  ${COMMIT ? 'prune' : 'would prune'} ${userId}`);
}

console.log(`${COMMIT ? 'Pruned' : 'Would prune'} ${pruned}, kept ${kept}.`);
if (!COMMIT && pruned > 0) console.log('Re-run with --commit to apply.');
