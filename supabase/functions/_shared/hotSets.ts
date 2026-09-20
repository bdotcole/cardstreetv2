// "Hot" sets: the ones whose prices move fastest and therefore must be priced
// EVERY night, ahead of the stalest-first rotation.
//
// Shared by batch-price-english and batch-price-games so the two crons agree on
// what "new" means.
//
// WHY THIS EXISTS
// ---------------
// Both crons rotate stalest-first and reach only a slice of the catalog per night
// (~60 of ~150 EN Pokemon sets; one bounded group per game). Pricing a set stamps
// it fresh, which sends it to the BACK of the queue — so a set priced on release
// day is not revisited for weeks. That is precisely the window in which launch
// prices collapse. Measured 2026-09-20 on 30th Celebration (me05.5, released
// 2026-09-16, priced once on 09-17): Mew ex #158 stored at $1,711.93 against a
// ~$150 market, Mewtwo ex #157 at $744 against ~$100-250. Founder's rule: a new
// set gets a daily market check until the next set is released.
//
// batch-price-games already had a "recently ingested" head keyed on
// pokemon_sets.created_at, which is the wrong signal for this: a set ingested
// the day it launches drops out of that head after NEW_SET_WINDOW_MS while it is
// still the current set, and a back-catalog set ingested yesterday lands in it
// although its prices are settled. release_date is what the market reacts to.
//
// A set is hot when its release_date is
//   (a) within HOT_SET_WINDOW_DAYS of today, or
//   (b) the latest release_date in its game/language pool — so the newest set stays
//       hot until the NEXT set ships, however long that takes (Lorcana and Riftbound
//       go 3-4 months between sets).
// Future-dated rows (MTG pre-loads its next two or three sets) are neither: nothing
// upstream prices them yet, and they must not displace the real newest set. Rows
// with no release_date (a few legacy Yu-Gi-Oh promo sets) are never hot.

export const HOT_SET_WINDOW_DAYS = 60;

export interface HotSetRow {
  id: string;
  release_date?: string | null;
}

// Returns the ids of the hot sets in `sets`, newest release first. `today` is
// injectable for tests; production passes nothing.
export function hotSetIds(sets: readonly HotSetRow[], today: Date = new Date()): string[] {
  const todayIso = today.toISOString().slice(0, 10);
  const cutoffIso = new Date(today.getTime() - HOT_SET_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  // release_date is a DATE column; PostgREST serialises it as 'YYYY-MM-DD', so
  // lexical comparison is chronological. Guard against a timestamp anyway.
  const dateOf = (s: HotSetRow) => (s.release_date ?? '').slice(0, 10);
  const released = sets.filter((s) => { const d = dateOf(s); return d.length === 10 && d <= todayIso; });
  let newest = '';
  for (const s of released) if (dateOf(s) > newest) newest = dateOf(s);
  return released
    .filter((s) => dateOf(s) >= cutoffIso || dateOf(s) === newest)
    .sort((a, b) => (dateOf(a) < dateOf(b) ? 1 : dateOf(a) > dateOf(b) ? -1 : a.id < b.id ? -1 : 1))
    .map((s) => s.id);
}
