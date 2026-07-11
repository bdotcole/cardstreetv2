// JustTCG REAL price history -> price_snapshots, replacing estimated rows.
//
// The 20260710 backfill seeded every charted series with flagged estimates
// (source='estimated'). Where JustTCG actually tracks a card (EN + JP singles),
// this swaps the estimate window for the card's REAL history (source='justtcg')
// and keeps estimates only where no real data exists — Thai cards, unmatched
// cards, stale JustTCG series, and the 180-365d tail JustTCG can't reach.
//
//   node scripts/ingest/justtcg-history-backfill.mjs            # dry run (default)
//   node scripts/ingest/justtcg-history-backfill.mjs --commit   # write
//
// Per charted series (subject in price_snapshots, is_sealed=false, lang en/ja):
//   1. Match our card to a JustTCG card: set resolved by normalized name (same
//      approach as justtcg-prices.mjs), card by collector number then name;
//      per-card q= search as fallback.
//   2. Pick the variant with usable history (prefer Near Mint), fetch its 180d
//      priceHistory. Require FRESH data: newest point within 21 days of the
//      series' anchor (earliest real cron snapshot) — stale series stay estimated.
//   3. Calibrate to our price basis: scale the whole series so its point nearest
//      the anchor equals the anchor value. The chart plots our derived THB
//      headline, which never exactly equals JustTCG's USD feed — scaling keeps
//      the REAL shape and a seamless join with the real cron data. The raw USD
//      value is preserved in market_native. A factor far from 1 (outside
//      0.4-2.5x after FX) means a wrong match/printing -> skip.
//   4. Replace: delete estimated rows inside the real window [D0, anchor), insert
//      the justtcg rows, then rescale the estimates OLDER than D0 to land exactly
//      on the oldest real value (keeps the 1y view continuous). Idempotent: on
//      re-run the D0 row already holds the real value, so the rescale factor is 1.
//      EXCEPTION: a rescale factor outside 0.4-2.5x means the estimate tail and
//      the real data disagree wildly — in practice a 2026-release set whose price
//      crashed since launch, where the "year of history" would be pre-release
//      fiction at several times today's value. Those tails are DELETED instead:
//      the 180d/1y chart then honestly starts where real trading started.
//
// Never touches rows on/after the anchor (the daily cron owns those), sealed
// products (PriceCharting has no history), or Thai cards (no JustTCG coverage).
// Starter plan budget: ~30 requests for the current ~27 EN/JP charted singles.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

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
const RATE_MS = 1300; // Starter plan: 50 req/min
const COMMIT = process.argv.includes('--commit');
const USD_TO_THB = 1 / 0.028; // constants.ts EXCHANGE_RATES['USD']; only used to sanity-check matches
const FRESH_DAYS = 21; // newest history point must be within this of the anchor
const MIN_POINTS = 8;
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const SLUG_BY_LANG = { en: 'pokemon', ja: 'pokemon-japan' };
// Same normalization + override idea as justtcg-prices.mjs.
const SET_ID_OVERRIDES = {
  svp: 'sv-black-star-promos-pokemon',
  swshp: 'swsh-black-star-promos-pokemon',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normNum = (s) => String(s || '').toLowerCase().split('/')[0].replace(/(\D)0+(?=\d)/, '$1').replace(/^0+(?=\d)/, '');
const isoDay = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);

async function jtcg(path) {
  await sleep(RATE_MS);
  const res = await fetch(`${BASE}${path}`, { headers: { 'x-api-key': API_KEY } });
  if (res.status === 429) {
    await sleep(5000);
    return jtcg(path);
  }
  if (!res.ok) throw new Error(`JustTCG ${res.status} for ${path}: ${await res.text()}`);
  return res.json();
}

// Variant choice: usable history first, Near Mint preferred, then most points.
function pickVariant(card) {
  const usable = (card.variants || []).filter((v) => Array.isArray(v.priceHistory) && v.priceHistory.length >= MIN_POINTS);
  usable.sort((a, b) => {
    const nmA = /near mint/i.test(a.condition || '') ? 1 : 0;
    const nmB = /near mint/i.test(b.condition || '') ? 1 : 0;
    if (nmA !== nmB) return nmB - nmA;
    return (b.priceHistory?.length || 0) - (a.priceHistory?.length || 0);
  });
  return usable[0] || null;
}

function matchCard(cards, ourCard) {
  const nameKey = norm(ourCard.english_name || ourCard.name);
  const numKey = normNum(ourCard.number);
  return (
    cards.find((c) => normNum(c.number) === numKey && numKey) ||
    cards.find((c) => norm(c.name) === nameKey) ||
    null
  );
}

async function main() {
  if (!API_KEY) throw new Error('JUSTTCG_API_KEY missing from .env.local');
  console.log(COMMIT ? '== COMMIT run ==' : '== DRY RUN (pass --commit to write) ==');

  // Charted EN/JP single series + each one's anchor (earliest real cron row).
  const { data: realRows, error: rErr } = await supabase
    .from('price_snapshots')
    .select('subject_id, language, condition, market_thb, captured_on')
    .eq('is_sealed', false)
    .eq('source', 'catalog')
    .in('language', ['en', 'ja'])
    .order('captured_on', { ascending: true })
    .limit(10000);
  if (rErr) throw rErr;
  const anchors = new Map(); // subject|lang|cond -> {thb, date}
  for (const r of realRows || []) {
    const key = `${r.subject_id}|${r.language}|${r.condition}`;
    if (!anchors.has(key)) anchors.set(key, { thb: Number(r.market_thb), date: r.captured_on, ...r });
  }
  console.log(`charted EN/JP single series: ${anchors.size}`);

  const ids = [...new Set([...anchors.values()].map((a) => a.subject_id))];
  const { data: cards, error: cErr } = await supabase
    .from('pokemon_cards')
    .select('id, name, english_name, number, set_id, language, pokemon_sets(name)')
    .in('id', ids);
  if (cErr) throw cErr;
  const cardById = new Map((cards || []).map((c) => [c.id, c]));

  // Resolve JustTCG set ids once per language.
  const setMaps = {};
  for (const lang of ['en', 'ja']) {
    const slug = SLUG_BY_LANG[lang];
    const sets = (await jtcg(`/sets?game=${encodeURIComponent(slug)}`)).data || [];
    setMaps[lang] = new Map(sets.map((s) => [norm(s.name), s.id]));
  }

  const summary = { replaced: 0, keptEstimates: 0, errors: 0 };
  for (const [key, anchor] of anchors) {
    const ourCard = cardById.get(anchor.subject_id);
    const label = `${anchor.subject_id} (${ourCard?.english_name || ourCard?.name || '?'})`;
    try {
      if (!ourCard) throw new Error('card row missing');
      const slug = SLUG_BY_LANG[ourCard.language];
      const setName = ourCard.pokemon_sets?.name;
      const jtcgSetId = SET_ID_OVERRIDES[ourCard.set_id] || setMaps[ourCard.language].get(norm(setName));

      // Set-scoped lookup by collector number; q= name search as fallback.
      let match = null;
      if (jtcgSetId) {
        const page = await jtcg(
          `/cards?game=${encodeURIComponent(slug)}&set=${encodeURIComponent(jtcgSetId)}&number=${encodeURIComponent(normNum(ourCard.number))}&include_price_history=true&priceHistoryDuration=180d&limit=20`,
        );
        match = matchCard(page.data || [], ourCard);
      }
      if (!match) {
        const q = ourCard.english_name || ourCard.name;
        const page = await jtcg(
          `/cards?game=${encodeURIComponent(slug)}&q=${encodeURIComponent(q)}&include_price_history=true&priceHistoryDuration=180d&limit=20`,
        );
        const inSet = (page.data || []).filter((c) => !setName || norm(c.set_name || c.set || '') === norm(setName));
        match = matchCard(inSet.length ? inSet : page.data || [], ourCard);
      }
      if (!match) {
        console.log(`SKIP  ${label}: no JustTCG match — estimates kept`);
        summary.keptEstimates++;
        continue;
      }

      const variant = pickVariant(match);
      if (!variant) {
        console.log(`SKIP  ${label}: matched "${match.name}" but no variant has >=${MIN_POINTS} history points — estimates kept`);
        summary.keptEstimates++;
        continue;
      }

      // Dedupe to one point per UTC day (keep the latest), oldest -> newest.
      const byDay = new Map();
      for (const p of variant.priceHistory) {
        if (typeof p.p !== 'number' || p.p <= 0) continue;
        byDay.set(isoDay(p.t), p.p);
      }
      const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const anchorMs = Date.parse(`${anchor.date}T00:00:00Z`);
      const newestMs = Date.parse(`${days[days.length - 1][0]}T00:00:00Z`);
      if (anchorMs - newestMs > FRESH_DAYS * 86_400_000) {
        console.log(`SKIP  ${label}: history is stale (newest ${days[days.length - 1][0]} vs anchor ${anchor.date}) — estimates kept`);
        summary.keptEstimates++;
        continue;
      }

      // Calibrate: the point nearest the anchor defines the scale.
      const nearest = days.reduce((best, d) =>
        Math.abs(Date.parse(`${d[0]}T00:00:00Z`) - anchorMs) < Math.abs(Date.parse(`${best[0]}T00:00:00Z`) - anchorMs) ? d : best,
      );
      const factor = anchor.thb / (nearest[1] * USD_TO_THB);
      if (factor < 0.4 || factor > 2.5) {
        console.log(`SKIP  ${label}: scale factor ${factor.toFixed(2)} outside sanity band (likely wrong match/printing) — estimates kept`);
        summary.keptEstimates++;
        continue;
      }
      const scale = anchor.thb / nearest[1]; // THB per USD point, calibrated (FX folded in)

      const preAnchor = days.filter(([d]) => d < anchor.date);
      if (!preAnchor.length) {
        console.log(`SKIP  ${label}: no history before the anchor — estimates kept`);
        summary.keptEstimates++;
        continue;
      }
      const d0 = preAnchor[0][0];
      const v0 = Math.max(1, Math.round(preAnchor[0][1] * scale));
      const rows = preAnchor.map(([d, usd]) => ({
        subject_id: anchor.subject_id,
        language: anchor.language,
        condition: anchor.condition,
        is_sealed: false,
        market_thb: Math.max(1, Math.round(usd * scale)),
        market_native: usd,
        currency: 'USD',
        source: 'justtcg',
        captured_on: d,
      }));

      // Continuity for the 1y view: estimates older than D0 rescale to land on V0.
      const { data: d0Row } = await supabase
        .from('price_snapshots')
        .select('market_thb')
        .eq('subject_id', anchor.subject_id).eq('language', anchor.language)
        .eq('condition', anchor.condition).eq('captured_on', d0)
        .maybeSingle();
      const g = d0Row?.market_thb ? v0 / Number(d0Row.market_thb) : 1;
      const dropTail = g < 0.4 || g > 2.5;
      const { data: olderEst } = await supabase
        .from('price_snapshots')
        .select('captured_on, market_thb')
        .eq('subject_id', anchor.subject_id).eq('language', anchor.language)
        .eq('condition', anchor.condition).eq('source', 'estimated')
        .lt('captured_on', d0)
        .limit(400);
      const rescaled = dropTail ? [] : (olderEst || []).map((r) => ({
        subject_id: anchor.subject_id,
        language: anchor.language,
        condition: anchor.condition,
        is_sealed: false,
        market_thb: Math.max(1, Math.round(Number(r.market_thb) * g)),
        market_native: null,
        currency: 'THB',
        source: 'estimated',
        captured_on: r.captured_on,
      }));

      console.log(
        `${COMMIT ? 'WRITE' : 'PLAN '} ${label}: ${rows.length} real pts (${d0} -> ${preAnchor[preAnchor.length - 1][0]}), ` +
        `variant "${variant.condition}/${variant.printing}", factor ${factor.toFixed(2)}, ` +
        (dropTail
          ? `DROP ${olderEst?.length || 0} pre-real estimates (tail factor ${g.toFixed(2)} implausible — chart starts ${d0})`
          : `rescale ${rescaled.length} older estimates x${g.toFixed(3)}`),
      );

      if (COMMIT) {
        // Estimated rows inside the real window go away (a category X axis skips
        // missing days, so gaps between real points don't distort the chart).
        // With an implausible tail factor the pre-real estimates go too.
        let del = supabase
          .from('price_snapshots')
          .delete()
          .eq('subject_id', anchor.subject_id).eq('language', anchor.language)
          .eq('condition', anchor.condition).eq('source', 'estimated')
          .lt('captured_on', anchor.date);
        if (!dropTail) del = del.gte('captured_on', d0);
        const { error: delErr } = await del;
        if (delErr) throw delErr;
        for (const batch of [rows, rescaled]) {
          for (let i = 0; i < batch.length; i += 500) {
            const { error } = await supabase
              .from('price_snapshots')
              .upsert(batch.slice(i, i + 500), { onConflict: 'subject_id,language,condition,captured_on' });
            if (error) throw error;
          }
        }
      }
      summary.replaced++;
    } catch (e) {
      console.error(`ERROR ${label}: ${e.message}`);
      summary.errors++;
    }
  }
  console.log(`done: ${summary.replaced} series ${COMMIT ? 'replaced with' : 'plannable from'} real history, ${summary.keptEstimates} kept estimates, ${summary.errors} errors`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
