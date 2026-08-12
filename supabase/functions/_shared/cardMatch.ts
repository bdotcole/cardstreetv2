// Variant-aware matching of JustTCG cards to our catalog rows.
//
// Shared by batch-price-english and batch-price-games so the two crons cannot drift.
//
// WHY THIS EXISTS
// ---------------
// Both crons used to resolve a JustTCG card to ours by bare collector number, via a
// numOf() that threw away everything except the first digit run:
//   "319z" -> 319 | "R05b" -> 5 | "OP01-078" -> 78 | "025/165" -> 25
// The discarded characters are exactly what separates a parallel from its base
// printing, so cheap base quotes landed on chase rows. Measured on the live DB
// 2026-08-12: 800 cards held a Raw_NM price >=5x below their own Near Mint row, 472
// of them >=20x, and 750 were being rewritten nightly. Worked examples, each proven
// by the JustTCG id stored in market_values.source_links:
//   * op-op-11-st18-005 "Luffy-Tarou (SP)" ($311 card) priced from ".../smoker-common" -> $0.08
//   * rb-unleashed-r05b "Chaos Rune (R05b)" priced from a card named "Revna"
//   * mtg #319z "Niv-Mizzet, Guildpact" (serialized) priced from the base printing -> $0.36
//
// THE RULES (in order; first hit wins, no hit means NO price is written)
// ----------------------------------------------------------------------
//   1. Base name AND variant identity agree. Ties broken by collector number.
//   2. The collector number identifies exactly ONE card on each side. The number is
//      then the identity on its own — Magic and Lorcana name the printing upstream
//      ("(Showcase)", "(Iconic)") while our catalog distinguishes it by number.
//   3. The number is contested on some side, so variant identity must break the tie.
//
// Anything ambiguous is REFUSED rather than guessed: a missing price shows the card
// as unpriced, while a wrong one invites a seller to list a $300 card for $0.08.
//
// Collector numbers keep their full shape (letters, suffixes) — only a set-code
// prefix ("OP11-005" -> "005", which our catalog stores bare), a language code
// ("CORI-EN027" -> "027") and a "/total" tail ("025/165" -> "025") are dropped,
// because those are formatting, not identity.
//
// Variant identity is the set of parenthesised qualifiers in the name: "(SP)",
// "(Manga)", "(Master Ball Pattern)", "(Serial Numbered)", "(Showcase)". A base
// printing has none. Where it is consulted, both sides must carry the SAME set, so a
// base quote cannot reach a parallel row nor a parallel quote a base row.
//
// Validated by simulating old vs new against live JustTCG + catalog data over 17
// sets in 6 games before shipping (2026-08-12): matches rose 2,396 -> 2,537, 98
// cards changed to a correctly-named source, and all 30 newly-refused cards were
// verified to have been mismatched before. Re-run that simulation before touching
// these rules — every tightening here cost coverage somewhere non-obvious.
//
// KNOWN GAP: Yu-Gi-Oh expresses rarity as a parenthetical ("(Secret Rare)") while we
// keep one row per card with a `rarity` column. When a set lists a number under
// several rarities and none of them is bare, rule 3 finds no agreement and the card
// goes unpriced (3 of 100 cards in ygo-cori). Deliberate: picking one rarity's price
// for a row that does not model rarity is how the original bug looked.

export interface CatalogCard {
  id: string;
  name?: string | null;
  english_name?: string | null;
  number?: string | null;
}

export interface JustTcgCard {
  name?: string | null;
  number?: string | null;
}

/**
 * Loose text key: lowercase, punctuation collapsed to single spaces.
 *
 * Unicode-aware on purpose. An `[^a-z0-9]` version destroyed Japanese names —
 * "メガダークライex" collapsed to "ex", a key shared by every ex card in the set,
 * which then looked like a mass name collision and blocked otherwise-safe matches.
 * Keeping the kana/kanji makes JP rows distinct even though they never match
 * JustTCG's English labels directly (those resolve via english_name or number).
 */
export function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Collector-number key that preserves identity.
 *
 * Drops only formatting: the "/total" tail and a leading set-code prefix (letters+
 * digits followed by a dash). Leading zeros on a purely numeric core are dropped so
 * our "005" meets JustTCG's "OP11-005"; a number that STARTS with letters ("R05b",
 * "SV001", "TG12") is left intact, since there the letters carry the variant.
 */
// Yu-Gi-Oh prints a language code between the set code and the number
// ("CORI-EN027"). Stripped only when it is one of these AND digits follow, so a
// Riftbound "R05b" or a Pokemon "SV001" keeps its leading letters.
const LANG_PREFIXES = ['en', 'eu', 'fr', 'de', 'it', 'pt', 'sp', 'jp', 'kr', 'ae'];

export function numberKey(raw: unknown): string {
  let t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return '';
  t = t.split('/')[0];                 // "025/165" -> "025", "188/159" -> "188"
  t = t.replace(/^[a-z]+\d*-/, '');    // "op11-005" -> "005"; leaves "319z", "r05b"
  for (const p of LANG_PREFIXES) {     // "cori-en027" -> "en027" -> "027"
    if (t.startsWith(p) && /^\d/.test(t.slice(p.length))) { t = t.slice(p.length); break; }
  }
  if (/^\d/.test(t)) t = t.replace(/^0+(?=\d)/, ''); // "005" -> "5"; keeps "319z"
  return t;
}

// Qualifiers that are formatting/printing noise rather than a distinct card. A
// JustTCG entry carrying only these still matches a bare catalog row.
const IGNORABLE_QUALIFIERS = new Set(['holo', 'holofoil', 'reverse holo', 'reverse holofoil', 'foil', 'normal', 'unlimited', '1st edition', 'first edition']);

/**
 * Parenthesised qualifiers that define the printing, e.g.
 *   "Sabo (Alternate Art) (Manga)" -> ["alternate art", "manga"]
 *   "Pikachu - 025/165 (Master Ball Pattern)" -> ["master ball pattern"]
 *
 * A parenthesised token equal to the card's OWN collector number is a disambiguator
 * TCGplayer appends when one name spans several printings, not a variant: JustTCG
 * lists plain "Yamato (079)" for the same card our catalog stores as bare "Yamato".
 * Simulation against live data showed this rejecting 42 correct base-card matches in
 * four One Piece sets alone, so `ownNumber` is passed in and such tokens are dropped.
 * Everything else survives: "Niv-Mizzet, Guildpact (Showcase) (319)" at number 319
 * still yields ["showcase"].
 */
export function variantMarkers(name: unknown, ownNumber?: unknown): string[] {
  const own = ownNumber === undefined ? '' : numberKey(ownNumber);
  const out: string[] = [];
  for (const m of String(name ?? '').matchAll(/\(([^)]+)\)/g)) {
    const raw = m[1];
    const q = norm(raw);
    if (!q || IGNORABLE_QUALIFIERS.has(q)) continue;
    if (own && numberKey(raw) === own) continue; // self-referential number tag
    out.push(q);
  }
  return out.sort();
}

/** Name with its qualifiers and any " - 025/165" number tail removed. */
export function baseName(name: unknown): string {
  return norm(
    String(name ?? '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s-\s*[\w]+\/[\w]+\s*$/, ' '),
  );
}

/** Variant identity is equal only when both sides carry the same qualifier set. */
function markersAgree(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export interface MatchResult {
  card: CatalogCard;
  /** How it resolved — logged so a bad rule shows up in cron output. */
  via: 'name+variant' | 'name+number' | 'number-unique' | 'number+variant';
}

/**
 * Build a matcher over one set's catalog rows.
 *
 * `allJustTcgCards` is the WHOLE set as returned by JustTCG — the matcher needs it
 * to know which collector numbers are shared by several printings upstream, which is
 * precisely the case the number-only fallback must refuse.
 *
 * Returns null for "no confident match"; the caller must then write NO price.
 *
 * NAME AGREEMENT IS MANDATORY. An earlier draft accepted a match on number+variant
 * alone and, in simulation against live data, happily priced "Stussy (SP)" from
 * "Magellan (SP)" — a different card that merely shared collector number 085 and the
 * (SP) marker, because One Piece SP reprints carry their ORIGINAL set's number while
 * our catalog stores it bare. Number can only ever break a tie between same-named
 * rows, never establish a match on its own.
 */
export function buildMatcher(ourCards: CatalogCard[], allJustTcgCards: JustTcgCard[] = []) {
  const byNumber = new Map<string, CatalogCard[]>();
  const byName = new Map<string, CatalogCard[]>();
  const push = (m: Map<string, CatalogCard[]>, k: string, c: CatalogCard) => {
    if (!k) return;
    const a = m.get(k);
    if (a) a.push(c); else m.set(k, [c]);
  };

  for (const c of ourCards) {
    push(byNumber, numberKey(c.number), c);
    // Index both names: JustTCG labels Japanese cards in English while our `name`
    // is Japanese, so english_name is the only bridge for those rows.
    push(byName, baseName(c.name), c);
    if (c.english_name) push(byName, baseName(c.english_name), c);
  }

  // Collector numbers carrying more than one printing upstream. The plain-number
  // fallback stays away from these — they are where base and parallel collide.
  const jNumCounts = new Map<string, number>();
  for (const jc of allJustTcgCards) {
    const k = numberKey(jc.number);
    if (k) jNumCounts.set(k, (jNumCounts.get(k) ?? 0) + 1);
  }

  const jMarkersOf = (jc: JustTcgCard) => variantMarkers(jc.name, jc.number);

  const markersOf = (c: CatalogCard) => {
    const fromName = variantMarkers(c.name, c.number);
    return fromName.length ? fromName : variantMarkers(c.english_name, c.number);
  };


  return function match(jc: JustTcgCard): MatchResult | null {
    const jMarkers = jMarkersOf(jc);
    const jNum = numberKey(jc.number);
    const jName = baseName(jc.name);

    // 1. Same base name AND same variant identity — the strongest signal.
    const named = (byName.get(jName) ?? []).filter((c) => markersAgree(markersOf(c), jMarkers));
    if (named.length === 1) return { card: named[0], via: 'name+variant' };
    if (named.length > 1) {
      // Several rows share name and variant (reprints within one set) — number decides.
      const sameNum = named.filter((c) => numberKey(c.number) === jNum);
      if (sameNum.length === 1) return { card: sameNum[0], via: 'name+number' };
      return null;
    }

    // 2. The collector number identifies exactly one card on EACH side. Then the
    //    number IS the identity and variant markers are redundant — which is how
    //    Magic and Lorcana work: our catalog stores plain "Smaug the Magnificent"
    //    #229 and "Belle & Beast - Certain as the Sun" #245 while upstream spells
    //    the printing out as "(Showcase)" / "(Iconic)". Demanding marker agreement
    //    here rejected ~250 correct matches across three MTG and three Lorcana
    //    sets, plus every Yu-Gi-Oh row whose name is merely translated differently
    //    ("The Three Brave Swordsouls" vs "The Three Champions of Swordsoul").
    //
    //    Base/parallel leakage cannot ride in this way: that only happens when one
    //    number carries several printings, which collapses uniqueness on one side
    //    or the other and sends the card to rule 3 instead.
    const ourAtNum = byNumber.get(jNum) ?? [];
    if (ourAtNum.length === 1 && (jNumCounts.get(jNum) ?? 0) === 1) {
      return { card: ourAtNum[0], via: 'number-unique' };
    }

    // 3. The number is contested on at least one side — base and parallel are both
    //    in play, so variant identity must break the tie or nothing is written.
    const sameMarkers = ourAtNum.filter((c) => markersAgree(markersOf(c), jMarkers));
    if (sameMarkers.length === 1) return { card: sameMarkers[0], via: 'number+variant' };
    return null;
  };
}
