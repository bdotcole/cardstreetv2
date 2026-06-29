import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// =====================================================================
// batch-price-games Edge Function (JustTCG)
//
// Weekly price refresh for the non-English-Pokemon catalogs:
//   Magic, One Piece, Yu-Gi-Oh, and Japanese Pokemon.
// (English Pokemon is handled by batch-price-english / daily-market-update.)
//
// Responds 202 immediately and runs in the background via EdgeRuntime.waitUntil
// to bypass the 60s gateway timeout. Resolves JustTCG set slugs at runtime
// (by set name, or by id-prefix for JP) so newly ingested sets are picked up
// automatically — no config table to maintain.
//
// Writes one canonical Near-Mint row per card (condition 'Raw_NM', currency USD;
// cardMapper converts to THB). Stays well under the 1K/day JustTCG quota.
// =====================================================================

const JUSTTCG_API_KEY = (Deno.env.get('JUSTTCG_API_KEY') ?? '').trim();
const JUSTTCG_BASE = 'https://api.justtcg.com/v1';
const DELAY_MS = 1300;        // safe under 50 req/min
const MAX_API_CALLS = 700;    // safety cap; leaves headroom under 1K/day shared quota
const PAGE = 100;

// Our game -> JustTCG game slug + which language rows to price/store.
// `key` selects the group via the POST body { "group": "<key>" }. One group per
// invocation keeps each run under the Edge Function wall-clock limit; cron fires
// the four groups on staggered weekly schedules.
const GROUPS = [
  { key: 'mtg', game: 'mtg', justtcgGame: 'magic-the-gathering', cardLang: 'en', storeLang: 'en', matchById: false },
  { key: 'onepiece', game: 'onepiece', justtcgGame: 'one-piece-card-game', cardLang: 'en', storeLang: 'en', matchById: false },
  { key: 'yugioh', game: 'yugioh', justtcgGame: 'yugioh', cardLang: 'en', storeLang: 'en', matchById: false },
  { key: 'riftbound', game: 'riftbound', justtcgGame: 'riftbound-league-of-legends-trading-card-game', cardLang: 'en', storeLang: 'en', matchById: false },
  { key: 'lorcana', game: 'lorcana', justtcgGame: 'disney-lorcana', cardLang: 'en', storeLang: 'en', matchById: false },
  // JP Pokemon: our set name is English ("White Flare") but JustTCG is "SV11W: White Flare",
  // so resolve by set-id prefix (sv11w-...) instead of name.
  { key: 'pokemon-jp', game: 'pokemon', justtcgGame: 'pokemon-japan', cardLang: 'ja', storeLang: 'jp', matchById: true },
];

// Vintage + deck JP sets whose JustTCG slug is an English name, not "<id>-...",
// so the id-prefix resolver below can't find them. Numbered sets (web/VS/E/PCG,
// deck boxes) then match cards by collector number; the pre-e-Card sets
// (neo*, PMCG*) carry no upstream number and match by english_name instead
// (filled during the 2026-06-20 vintage backfill).
const JP_SLUG_OVERRIDES: Record<string, string> = {
  web1: 'pokemon-web-pokemon-japan', VS1: 'pokemon-vs-pokemon-japan',
  E1: 'base-expansion-pack-pokemon-japan', E2: 'the-town-on-no-map-pokemon-japan', E3: 'wind-from-the-sea-pokemon-japan', E4: 'split-earth-pokemon-japan', E5: 'mysterious-mountains-pokemon-japan',
  PCG1: 'flight-of-legends-pokemon-japan', PCG2: 'clash-of-the-blue-sky-pokemon-japan', PCG3: 'rocket-gang-strikes-back-pokemon-japan', PCG4: 'golden-sky-silvery-ocean-pokemon-japan', PCG5: 'mirage-forest-pokemon-japan', PCG6: 'holon-research-tower-pokemon-japan', PCG7: 'holon-phantom-pokemon-japan', PCG8: 'miracle-crystal-pokemon-japan', PCG9: 'offense-and-defense-of-the-furthest-ends-pokemon-japan',
  SVK: 'sv-stellar-miracle-deck-build-box-pokemon-japan', SVLN: 'sv-sylveon-ex-stellar-tera-type-starter-set-pokemon-japan', SVLS: 'sv-ceruledge-ex-stellar-tera-type-starter-set-pokemon-japan',
  neo1: 'gold-silver-to-a-new-world-pokemon-japan', neo2: 'crossing-the-ruins-pokemon-japan', neo3: 'awakening-legends-pokemon-japan', neo4: 'darkness-and-to-light-pokemon-japan',
  PMCG1: 'expansion-pack-pokemon-japan', PMCG2: 'pokemon-jungle-pokemon-japan', PMCG3: 'mystery-of-the-fossils-pokemon-japan', PMCG4: 'rocket-gang-pokemon-japan', PMCG5: 'leaders-stadium-pokemon-japan', PMCG6: 'challenge-from-the-darkness-pokemon-japan',
};

// Name-resolved sets whose JustTCG name differs from ours (keyed by our set id).
const NAME_SLUG_OVERRIDES: Record<string, string> = {
  'lorcana-8': 'reign-of-jafar-disney-lorcana',
};

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Card number from various formats: "OP01-003" -> 3 (strip set-code prefix),
// "175/159" -> 175, "174/086" -> 174, "001" -> 1.
const numOf = (s: unknown) => {
  const t = String(s ?? '').replace(/^[A-Za-z]+\d*-/, '').split('/')[0];
  const m = t.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
};

async function jtcgFetch(path: string) {
  const r = await fetch(`${JUSTTCG_BASE}${path}`, {
    headers: { 'x-api-key': JUSTTCG_API_KEY, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error(`JustTCG ${r.status}: ${await r.text()}`);
  return r.json();
}

function bestNmPrice(jCard: any): number {
  const variants: any[] = jCard.variants ?? [];
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
  const best = sorted[0] ?? variants[0];
  return best?.avgPrice || best?.price || 0;
}

Deno.serve(async (req) => {
  const jobId = crypto.randomUUID();
  // One group per invocation (default mtg) so each run fits the wall-clock limit.
  let groupKey = 'mtg';
  try { const b = await req.json(); if (b?.group) groupKey = String(b.group); } catch (_) { /* no body */ }
  const groups = groupKey === 'all' ? GROUPS : GROUPS.filter((g) => g.key === groupKey);

  async function run() {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    let apiCalls = 0;
    let totalPriced = 0;

    for (const grp of groups) {
      if (apiCalls >= MAX_API_CALLS) break;

      // Our sets for this game
      const { data: ourSets, error: setErr } = await supabase
        .from('pokemon_sets')
        .select('id, name')
        .eq('game', grp.game)
        .eq('language', grp.cardLang === 'ja' ? 'ja' : 'en');
      if (setErr) { console.error(`[${grp.game}] set query: ${setErr.message}`); continue; }

      // JustTCG sets for this game (one call), build resolver
      let jtcgSets: any[] = [];
      try { jtcgSets = ((await jtcgFetch(`/sets?game=${grp.justtcgGame}`)).data) ?? []; apiCalls++; }
      catch (e) { console.error(`[${grp.game}] /sets: ${(e as Error).message}`); continue; }
      const byName = new Map(jtcgSets.map((s: any) => [norm(s.name), s.id]));

      for (const set of ourSets ?? []) {
        if (apiCalls >= MAX_API_CALLS) break;

        let slug: string | undefined;
        if (grp.matchById) {
          slug = JP_SLUG_OVERRIDES[set.id]
            ?? jtcgSets.find((s: any) => s.id.toLowerCase().startsWith(set.id.toLowerCase() + '-'))?.id;
        } else {
          // LorcanaJSON names set 8 "The Reign of Jafar"; JustTCG drops the "The".
          slug = NAME_SLUG_OVERRIDES[set.id] ?? byName.get(norm(set.name));
        }
        if (!slug) continue;

        // our cards for this set
        const { data: ourCards } = await supabase
          .from('pokemon_cards')
          .select('id, name, number, english_name')
          .eq('set_id', set.id)
          .eq('language', grp.cardLang);
        if (!ourCards?.length) continue;
        const byNumber = new Map<string, any>();
        const byCardName = new Map<string, any>();
        for (const c of ourCards) {
          const n = numOf(c.number);
          if (n != null) byNumber.set(String(n), c);
          byCardName.set(norm(c.name), c);
          // JustTCG names JP cards in English; our vintage `name` is Japanese,
          // so index english_name too (the bridge for no-number neo*/PMCG* sets).
          if (c.english_name) byCardName.set(norm(c.english_name), c);
        }

        // page JustTCG cards for the set
        const rowsByCard = new Map<string, any>();
        let offset = 0;
        while (apiCalls < MAX_API_CALLS) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
          let page: any[] = [];
          try {
            const resp = await jtcgFetch(`/cards?game=${grp.justtcgGame}&set=${encodeURIComponent(slug)}&limit=${PAGE}&offset=${offset}`);
            apiCalls++;
            page = resp.data ?? [];
          } catch (e) { console.error(`[${set.id}] /cards: ${(e as Error).message}`); break; }
          if (!page.length) break;
          for (const jc of page) {
            const n = numOf(jc.number);
            const our = (n != null && byNumber.get(String(n))) || byCardName.get(norm(jc.name));
            if (!our) continue;
            const price = bestNmPrice(jc);
            if (price <= 0) continue;
            rowsByCard.set(our.id, {
              card_id: our.id,
              language: grp.storeLang,
              condition: 'Raw_NM',
              market_avg: price,
              source_prices: { market_price: price, source: 'justtcg' },
              source_links: [`https://justtcg.com/card/${jc.id}`],
              currency: 'USD',
              game: grp.game,
              last_updated: new Date().toISOString(),
              last_priced_at: new Date().toISOString(),
            });
          }
          if (page.length < PAGE) break;
          offset += page.length;
        }

        const rows = [...rowsByCard.values()];
        if (rows.length) {
          const { error: upErr } = await supabase
            .from('market_values')
            .upsert(rows, { onConflict: 'card_id,language,condition' });
          if (upErr) { console.error(`[${set.id}] upsert: ${upErr.message}`); continue; }
          totalPriced += rows.length;
        }
        console.log(`[${grp.game}] ${set.id} <- ${slug}: ${rows.length} priced (api=${apiCalls})`);
      }
    }
    console.log(`[${jobId}] DONE api_calls=${apiCalls} priced=${totalPriced}`);
  }

  // @ts-ignore EdgeRuntime is available in Supabase
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(run());
  else run();

  return new Response(JSON.stringify({ accepted: true, job_id: jobId, group: groupKey, message: 'batch-price-games started' }),
    { status: 202, headers: { 'Content-Type': 'application/json' } });
});
