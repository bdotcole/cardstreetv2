// Resolving OUR set row to a JustTCG set slug.
//
// WHY THIS EXISTS
// ---------------
// batch-price-games resolved a set by exact normalised-name equality against the
// JustTCG /sets listing, with a hand-maintained override table for the gaps. That
// works until the two catalogues simply spell a product line differently, and then
// the set is not "stale" — it is UNREACHABLE. It resolves to no slug, the loop
// `continue`s, and the set can never be priced again. It costs no API call, raises
// no error, and the cron still reports success, so nothing anywhere says so.
//
// Measured 2026-09-22 against live JustTCG:
//   Yu-Gi-Oh   341 of 644 sets unresolved
//   MTG          2 of  73 (48 had already been hand-mapped into the override table)
//   Lorcana / One Piece / Riftbound   0
//
// The Yu-Gi-Oh misses are not missing products. Spot-checked upstream, they are the
// same sets under a different spelling:
//   ours "Legend of Blue Eyes White Dragon"        theirs "The Legend of Blue Eyes White Dragon"
//   ours "OTS Tournament Pack 9 (POR)"             theirs "OTS Tournament Pack 9"
//   ours "Dinosmasher's Fury Structure Deck"       theirs "Structure Deck: Dinosmasher's Fury"
//   ours "Legendary Collection 4: Joey's World Mega Pack"  theirs "Legendary Collection 4: Joey's World"
//   ours "2014 Mega-Tin Mega Pack"                 theirs "2014 Mega-Tins Mega Pack"
//
// Hand-mapping 341 sets the way MTG's 48 were mapped is not maintainable, and it only
// ever fixes the sets someone already noticed. These are three mechanical spelling
// differences, so resolve them mechanically and keep the override table for the
// genuinely arbitrary ones.
//
// SAFETY: a wrong slug is far worse than no slug — it prices a whole set from another
// product. So every rule here is exact-after-rewrite, never fuzzy, and an alias that
// lands on more than one upstream set is DISCARDED rather than guessed. Overrides
// always win, so any binding a human pinned by hand is untouchable.

/** Normalised comparison key. Same shape the callers have always used. */
export const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Product-line words that one catalogue writes as a prefix and the other as a suffix:
// "Structure Deck: Dinosmasher's Fury" vs "Dinosmasher's Fury Structure Deck".
const LINE_PREFIXES = [
  'structure deck',
  'commander',
  'art series',
  'duelist pack',
  'promo pack',
  'starter deck',
  'battle pack',
  'turbo pack',
  'champion pack',
  'astral pack',
  'premium pack',
  'legendary collection',
  'collectible tins',
  'duel terminal',
];

// Trailing qualifiers one catalogue appends and the other omits. Deliberately NOT
// including anything that distinguishes a real product: "Mega Pack", "Art Series",
// "Commander" and "Eternal-Legal" all name a DIFFERENT set from their base and must
// never be stripped, or a Mega Pack would bind to the tin it came in.
const DROPPABLE_SUFFIXES = [
  'por',        // "(POR)" — Portuguese printing marker on OTS packs
  'tcg',
  'worldwide english',
  'special set',
];

function stripLeadingThe(k: string): string {
  return k.startsWith('the ') ? k.slice(4) : k;
}

function stripParentheticals(name: string): string {
  return name.replace(/\([^)]*\)/g, ' ');
}

/**
 * Every key a set name may legitimately be looked up under. The first entry is always
 * the plain normalised name, so exact matching keeps priority over any rewrite.
 */
export function aliasKeys(rawName: string): string[] {
  const out: string[] = [];
  const push = (k: string) => { const n = norm(k); if (n && !out.includes(n)) out.push(n); };

  push(rawName);
  push(stripParentheticals(rawName));

  const base = norm(stripParentheticals(rawName));
  push(stripLeadingThe(base));

  for (const suf of DROPPABLE_SUFFIXES) {
    if (base.endsWith(' ' + suf)) push(base.slice(0, -(suf.length + 1)));
  }

  // prefix <-> suffix inversion, both directions
  for (const line of LINE_PREFIXES) {
    if (base.startsWith(line + ' ')) push(base.slice(line.length + 1) + ' ' + line);
    if (base.endsWith(' ' + line)) push(line + ' ' + base.slice(0, -(line.length + 1)));
  }

  return out;
}

export interface UpstreamSet { id: string; name: string }

/**
 * Index the upstream listing under every alias each upstream name can take. An alias
 * claimed by two or more upstream sets is poisoned and resolves to nothing — that is
 * the whole ambiguity guard.
 */
export function buildSlugIndex(upstream: readonly UpstreamSet[]): Map<string, string | null> {
  const index = new Map<string, string | null>();

  // Exact upstream names first, and they are then FROZEN. An exact name outranks
  // every rewritten alias: upstream carries both "Metal Raiders" and reprint rows
  // whose stripped alias also normalises to "metal raiders", and letting the alias
  // collide would poison the exact key and un-resolve eleven core Yu-Gi-Oh sets
  // that resolve correctly today. Measured: without this guard the simulation lost
  // Metal Raiders, Spell Ruler, Pharaoh's Servant, Labyrinth of Nightmare, Legacy
  // of Darkness, Dark Crisis, both Retro Packs and three Legendary Collections.
  const exact = new Set<string>();
  for (const s of upstream) { const k = norm(s.name); index.set(k, s.id); exact.add(k); }

  for (const s of upstream) {
    for (const key of aliasKeys(s.name).slice(1)) {
      if (exact.has(key)) continue;                       // never shadow an exact name
      if (index.has(key)) { if (index.get(key) !== s.id) index.set(key, null); }
      else index.set(key, s.id);
    }
  }
  return index;
}

/**
 * Our set -> upstream slug, or undefined when nothing resolves unambiguously.
 * `overrides` is the hand-maintained table and always wins.
 */
export function resolveSetSlug(
  ourSet: { id: string; name: string },
  index: Map<string, string | null>,
  overrides: Record<string, string>,
): string | undefined {
  const pinned = overrides[ourSet.id];
  if (pinned) return pinned;
  for (const key of aliasKeys(ourSet.name)) {
    const hit = index.get(key);
    if (hit) return hit;
  }
  return undefined;
}
