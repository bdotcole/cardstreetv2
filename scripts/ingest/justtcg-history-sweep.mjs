// One-time JustTCG REAL price-history sweep -> price_snapshots, by exact card id.
//
// Every market_values row the JustTCG crons have priced stores the card's exact
// JustTCG id in source_links ("https://justtcg.com/card/<id>") — ~57k singles across
// pokemon EN/JP, mtg, one piece, yugioh, riftbound and lorcana as of 2026-08-10.
// This sweep batch-fetches each card's 180d daily priceHistory BY THAT ID (no
// name/number matching risk) and writes per-day change points to price_snapshots
// (source='justtcg'), giving every JustTCG-covered card a real 180-day series at
// once instead of waiting for the nightly 90d merge to accrue.
//
//   node scripts/ingest/justtcg-history-sweep.mjs             # dry run (default)
//   node scripts/ingest/justtcg-history-sweep.mjs --commit    # write
//   node scripts/ingest/justtcg-history-sweep.mjs --commit --game=mtg   # one game
//
// Request budget: batch POST /v1/cards carries the history params PER ITEM in the
// body ({cardId, include_price_history, priceHistoryDuration} — query-string params
// are IGNORED on POST, probed 2026-08-10). At --batch=100 the full sweep is ~600
// calls; if the plan rejects a batch size (400/413) the script halves it and
// retries. Throttled to stay under 50 req/min.
//
// Write semantics — existing REAL rows are never clobbered:
//   1. estimated rows (20260710 backfill) inside the 180d window are DELETED for
//      the swept cards, then
//   2. the real points are inserted with ignoreDuplicates, so days already holding
//      a cron row (source='catalog'/'justtcg') keep it.
// Idempotent: a re-run deletes nothing new and inserts only gap days.
//
// Resumable: progress (last card_id cursor) persists to
// scripts/out/justtcg-history-sweep.cursor.json; delete that file to restart.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i < 0 || line.trim().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[k] = v;
}

const API_KEY = env.JUSTTCG_API_KEY;
const BASE = 'https://api.justtcg.com/v1';
const RATE_MS = 1300; // stay under 50 req/min
const DURATION = '180d';
const WINDOW_DAYS = 181; // estimated-row delete window, one day of slack over DURATION
const MIN_POINTS = 2;
// Mirrors constants.tsx EXCHANGE_RATES (THB base, USD: 0.028) — change both together.
const THB_PER_USD = 1 / 0.028;

const COMMIT = process.argv.includes('--commit');
const argOf = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
let BATCH = Math.max(10, parseInt(argOf('batch', '100'), 10) || 100);
const GAME_FILTER = argOf('game', null); // market_values.game value, e.g. mtg | pokemon
const MAX_CARDS = parseInt(argOf('limit', '0'), 10) || Infinity; // for smoke tests

const CURSOR_FILE = path.join('scripts', 'out', 'justtcg-history-sweep.cursor.json');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same variant choice as the nightly crons, so the series matches the headline
// price the site shows (batch-price-games bestNmVariant — change both together).
function bestNmVariant(jCard) {
  const variants = jCard.variants ?? [];
  const sorted = [...variants].sort((a, b) => {
    let sa = 0, sb = 0;
    if (a.avgPrice > 0) sa += 1000;
    if (b.avgPrice > 0) sb += 1000;
    if (a.condition === 'Near Mint' || a.condition === 'NM') sa += 500;
    if (b.condition === 'Near Mint' || b.condition === 'NM') sb += 500;
    if (a.printing === 'Normal') sa += 50;
    if (b.printing === 'Normal') sb += 50;
    if (sa === sb && a.avgPrice === 0 && b.avgPrice === 0) return (a.price || 99999) - (b.price || 99999);
    return sb - sa;
  });
  return sorted[0] ?? variants[0] ?? null;
}

// Per-UTC-day CHANGE points (parity with the edge functions' historyChangePoints).
function historyChangePoints(history) {
  const byDay = new Map();
  for (const p of history ?? []) {
    if (typeof p?.p !== 'number' || p.p <= 0 || typeof p?.t !== 'number') continue;
    byDay.set(new Date(p.t * 1000).toISOString().slice(0, 10), p.p);
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const out = [];
  for (let i = 0; i < days.length; i++) {
    const [day, usd] = days[i];
    const thb = Math.max(1, Math.round(usd * THB_PER_USD));
    if (i > 0 && i < days.length - 1 && thb === out[out.length - 1]?.thb) continue;
    out.push({ day, usd, thb });
  }
  return out;
}

// Returns the cards array, null (batch size dropped — caller re-chunks), or
// 'skip' (chunk given up after persistent server errors — caller moves on).
async function batchFetch(jtcgIds) {
  let serverFails = 0;
  while (true) {
    await sleep(RATE_MS);
    let res;
    try {
      res = await fetch(`${BASE}/cards`, {
        method: 'POST',
        headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(jtcgIds.map((id) => ({ cardId: id, include_price_history: true, priceHistoryDuration: DURATION }))),
      });
    } catch (e) {
      // Network blip — same treatment as a server 5xx.
      res = { status: 500, ok: false, text: async () => e.message };
    }
    if (res.status === 429) { await sleep(5000); continue; }
    if ((res.status === 400 || res.status === 413) && jtcgIds.length > 10) {
      // Plan rejects this batch size — halve permanently and let the caller re-chunk.
      BATCH = Math.max(10, Math.floor(jtcgIds.length / 2));
      console.log(`  [batch] ${res.status} at size ${jtcgIds.length}, dropping to ${BATCH}`);
      return null;
    }
    // Transient-failure ladder: back off and retry; if it persists, halve the
    // batch (isolates a poison id AND shrinks the response body); at the floor,
    // skip the chunk — the run is resumable and idempotent, so a rerun picks
    // the stragglers up. Returns 'retry' | null (halved) | 'skip'.
    const transient = async (why) => {
      if (++serverFails <= 3) { await sleep(3000 * serverFails); return 'retry'; }
      if (jtcgIds.length > 10) {
        BATCH = Math.max(10, Math.floor(jtcgIds.length / 2));
        console.log(`  [batch] persistent ${why} at size ${jtcgIds.length}, dropping to ${BATCH}`);
        return null;
      }
      console.log(`  [skip] persistent ${why} on ${jtcgIds.length} ids (${jtcgIds[0]} ..)`);
      return 'skip';
    };
    if (res.status >= 500) {
      // JustTCG throws occasional transient 500s on batch reads (observed
      // 2026-08-11, ~1 in 55 calls).
      const r = await transient('5xx');
      if (r === 'retry') continue;
      return r;
    }
    if (!res.ok) throw new Error(`JustTCG ${res.status}: ${await res.text()}`);
    try {
      return (await res.json()).data ?? [];
    } catch (_e) {
      // Truncated/corrupt body on a 200 — seen on a 3.3MB YGO batch response
      // (2026-08-11). Same ladder; halving shrinks the body below the flaky zone.
      const r = await transient('truncated body');
      if (r === 'retry') continue;
      return r;
    }
  }
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing from .env.local');
  console.log(COMMIT ? '== COMMIT run ==' : '== DRY RUN (pass --commit to write) ==');

  let cursor = '';
  if (fs.existsSync(CURSOR_FILE)) {
    cursor = JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')).cursor || '';
    console.log(`resuming after card_id ${cursor}`);
  }
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const summary = { cards: 0, swept: 0, points: 0, skippedNoHistory: 0, skippedChunks: 0, missing: 0, apiCalls: 0 };

  while (summary.cards < MAX_CARDS) {
    // Bridge rows: one Raw_NM row per JustTCG-priced card, id in source_links.
    let q = supabase
      .from('market_values')
      .select('card_id, language, game, source_links')
      .eq('condition', 'Raw_NM')
      .like('source_links->>0', '%justtcg.com/card/%')
      .gt('card_id', cursor)
      .order('card_id', { ascending: true })
      .limit(1000);
    if (GAME_FILTER) q = q.eq('game', GAME_FILTER);
    const { data: bridge, error } = await q;
    if (error) throw new Error(`bridge query: ${error.message}`);
    if (!bridge?.length) break;

    for (let i = 0; i < bridge.length; i += BATCH) {
      const chunk = bridge.slice(i, Math.min(i + BATCH, bridge.length));
      const byJtcgId = new Map();
      for (const r of chunk) {
        const jid = String(r.source_links?.[0] ?? '').split('/card/')[1];
        if (jid) byJtcgId.set(jid, r);
      }
      if (!byJtcgId.size) continue;

      let cards = await batchFetch([...byJtcgId.keys()]);
      summary.apiCalls++;
      if (cards === null) { i -= BATCH; continue; } // batch size dropped, redo chunk at new size
      if (cards === 'skip') {
        // Persistent server errors on this chunk — advance past it so the run
        // finishes; a rerun (after deleting the cursor file) sweeps stragglers.
        summary.skippedChunks++;
        summary.cards += chunk.length;
        cursor = chunk[chunk.length - 1].card_id;
        if (COMMIT) {
          fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
          fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, updated: new Date().toISOString() }));
        }
        continue;
      }

      const rows = [];
      const sweptIds = [];
      const returned = new Set();
      for (const jc of cards) {
        const r = byJtcgId.get(jc.id);
        if (!r) continue;
        returned.add(jc.id);
        const variant = bestNmVariant(jc);
        const pts = historyChangePoints(variant?.priceHistory);
        if (pts.length < MIN_POINTS) { summary.skippedNoHistory++; continue; }
        sweptIds.push(r.card_id);
        // price_snapshots is keyed by the CARD's language ('ja'), not the
        // market_values store code ('jp') — mirror the chart's read key.
        const lang = r.language === 'jp' ? 'ja' : r.language;
        for (const pt of pts) {
          rows.push({
            subject_id: r.card_id,
            language: lang,
            condition: 'Market',
            is_sealed: false,
            market_thb: pt.thb,
            market_native: pt.usd,
            currency: 'USD',
            source: 'justtcg',
            captured_on: pt.day,
          });
        }
      }
      summary.missing += byJtcgId.size - returned.size;
      summary.cards += chunk.length;
      summary.swept += sweptIds.length;
      summary.points += rows.length;

      if (COMMIT && rows.length) {
        const { error: delErr } = await supabase
          .from('price_snapshots')
          .delete()
          .eq('source', 'estimated')
          .in('subject_id', sweptIds)
          .gte('captured_on', windowStart);
        if (delErr) throw new Error(`estimate delete: ${delErr.message}`);
        for (let j = 0; j < rows.length; j += 500) {
          const { error: insErr } = await supabase
            .from('price_snapshots')
            .upsert(rows.slice(j, j + 500), { onConflict: 'subject_id,language,condition,captured_on', ignoreDuplicates: true });
          if (insErr) throw new Error(`insert: ${insErr.message}`);
        }
      }

      cursor = chunk[chunk.length - 1].card_id;
      if (COMMIT) {
        fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
        fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, updated: new Date().toISOString() }));
      }
      console.log(`${COMMIT ? 'WRITE' : 'PLAN '} ${summary.cards} cards, ${summary.swept} swept, ${summary.points} pts, ${summary.missing} gone upstream, api=${summary.apiCalls} (cursor ${cursor})`);
      if (summary.cards >= MAX_CARDS) break;
    }
    if (bridge.length < 1000) break;
  }

  console.log('done:', JSON.stringify(summary));
  if (COMMIT) console.log(`cursor saved to ${CURSOR_FILE} — delete it to re-run from the start`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
