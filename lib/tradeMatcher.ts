/**
 * Trade Finder matching engine (pure -- no I/O, unit-testable).
 *
 * Built for IN-PERSON trading (card shows, shops): two Pro users mark cards
 * for trade, one scans the other's QR, and the engine proposes swaps of equal
 * value from the full trade lists. Wishlists never gate a match -- if a card
 * happens to be on the other side's wishlist it gets a "wanted" badge and a
 * small ranking boost, nothing more.
 *
 * Two modes:
 *   even trades  -- browse offers across both trade lists, anchored on the
 *                   most valuable cards each side brings to the table
 *   target card  -- "I like your Card 1 (~B900)": the owner picks that card,
 *                   scans the wanter's QR, and gets combos from the wanter's
 *                   trade list totalling ~B900 (singles + 2-3-card combos)
 *
 * Every run aims for at least MIN_OFFERS distinct offers (when the pools
 * mathematically allow it). Values are Card.marketPrice snapshots in THB --
 * the same numbers both users see on their own collection screens.
 */

export interface TradeItem {
  itemId: string;
  cardId: string;
  name: string;
  image: string | null;
  value: number;
  quantity: number;
  /** On the receiving side's wishlist -- badge + ranking boost, never a filter. */
  wanted?: boolean;
}

export interface TradeOffer {
  kind: 'single' | 'combo' | 'bundle';
  /** Always the requesting user's side. */
  give: TradeItem[];
  /** Always the partner's side. */
  get: TradeItem[];
  giveValue: number;
  getValue: number;
  /** 0 = perfectly even; 0.25 = one side is 25% richer. */
  deltaPct: number;
}

export const MIN_OFFERS = 5;
const MAX_OFFERS = 8;

// Combinatorics caps: pools are value-sorted first, so the caps keep the most
// tradable-relevant cards while bounding pair/triple enumeration (~80C2 +
// 50C3 = ~23k combos worst case -- fine for a request handler).
const PAIR_POOL = 80;
const TRIPLE_POOL = 50;

const byValueDesc = (a: TradeItem, b: TradeItem) =>
  b.value - a.value || a.itemId.localeCompare(b.itemId);

const sum = (items: TradeItem[]) => items.reduce((s, i) => s + i.value, 0);

function deltaPct(a: number, b: number): number {
  const max = Math.max(a, b);
  return max <= 0 ? 0 : Math.abs(a - b) / max;
}

function signature(items: TradeItem[]): string {
  return items.map((i) => i.itemId).sort().join(',');
}

function makeOffer(give: TradeItem[], get: TradeItem[], kind?: TradeOffer['kind']): TradeOffer {
  const giveValue = sum(give);
  const getValue = sum(get);
  const inferred: TradeOffer['kind'] =
    kind ?? (give.length === 1 && get.length === 1 ? 'single' : 'combo');
  return { kind: inferred, give, get, giveValue, getValue, deltaPct: deltaPct(giveValue, getValue) };
}

interface Combo {
  items: TradeItem[];
  total: number;
  score: number;
}

/**
 * Combos of 1..3 cards from `pool` totalling as close to `target` as
 * possible. Wanted cards score better (5% of target per wanted card) so a
 * wishlisted card wins ties, but an unwishlisted exact-value match still
 * beats a wishlisted bad one.
 */
export function combosNear(pool: TradeItem[], target: number, keep = 24): Combo[] {
  if (target <= 0 || pool.length === 0) return [];
  const sorted = [...pool].sort(byValueDesc);

  const combos: Combo[] = [];
  const seen = new Set<string>();
  const push = (items: TradeItem[]) => {
    const total = sum(items);
    // Prune junk: an "equal value" offer at >2x or <1/4 of the target insults
    // the person across the table.
    if (total > target * 2 || total < target * 0.25) return;
    const sig = signature(items);
    if (seen.has(sig)) return;
    seen.add(sig);
    const wantedBoost = items.filter((i) => i.wanted).length * target * 0.05;
    // Simplicity preference: at comparable value, one card beats a pile of
    // three -- fewer cards to inspect and haggle over at the table.
    const pilePenalty = (items.length - 1) * target * 0.015;
    combos.push({ items, total, score: Math.abs(total - target) - wantedBoost + pilePenalty });
  };

  for (const a of sorted) push([a]);

  const pairPool = sorted.slice(0, PAIR_POOL);
  for (let i = 0; i < pairPool.length; i++) {
    for (let j = i + 1; j < pairPool.length; j++) {
      push([pairPool[i], pairPool[j]]);
    }
  }

  const triplePool = sorted.slice(0, TRIPLE_POOL);
  for (let i = 0; i < triplePool.length; i++) {
    for (let j = i + 1; j < triplePool.length; j++) {
      // Early prune: if the two largest already bust 2x target, adding a
      // third only makes it worse.
      if (triplePool[i].value + triplePool[j].value > target * 2) continue;
      for (let k = j + 1; k < triplePool.length; k++) {
        push([triplePool[i], triplePool[j], triplePool[k]]);
      }
    }
  }

  return combos
    .sort((a, b) => a.score - b.score || signature(a.items).localeCompare(signature(b.items)))
    .slice(0, keep);
}

/**
 * Final selection: rank by evenness, cap repetition so five offers aren't
 * five rearrangements of the same chase card, and cut to MAX_OFFERS. Falls
 * below MIN_OFFERS only when the pools genuinely can't produce more.
 */
function selectOffers(candidates: TradeOffer[]): TradeOffer[] {
  const ranked = [...candidates].sort(
    (a, b) => a.deltaPct - b.deltaPct || signature([...a.give, ...a.get]).localeCompare(signature([...b.give, ...b.get])),
  );

  const seen = new Set<string>();
  const sideUse = new Map<string, number>();
  const picked: TradeOffer[] = [];
  const overflow: TradeOffer[] = [];

  for (const offer of ranked) {
    const sig = `${signature(offer.give)}|${signature(offer.get)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    // Variety guard: each exact give-set or get-set may headline at most twice.
    const g = signature(offer.give);
    const r = signature(offer.get);
    if ((sideUse.get(g) ?? 0) >= 2 || (sideUse.get(r) ?? 0) >= 2) {
      overflow.push(offer);
      continue;
    }
    sideUse.set(g, (sideUse.get(g) ?? 0) + 1);
    sideUse.set(r, (sideUse.get(r) ?? 0) + 1);
    picked.push(offer);
    if (picked.length >= MAX_OFFERS) break;
  }

  // Backfill from the variety-overflow if we're short of the minimum.
  for (const offer of overflow) {
    if (picked.length >= MIN_OFFERS) break;
    picked.push(offer);
  }

  return picked.sort((a, b) => a.deltaPct - b.deltaPct);
}

/**
 * Target-card mode: partner wants `anchor`; return >=MIN_OFFERS offers of
 * their tradables (singles and 2-3-card combos) totalling ~anchor.value.
 */
export function buildTargetOffers(anchor: TradeItem, theirs: TradeItem[]): TradeOffer[] {
  const combos = combosNear(theirs, anchor.value, 40);
  return selectOffers(combos.map((c) => makeOffer([anchor], c.items)));
}

/**
 * Even-trades mode: offers across both FULL trade lists. Anchored on the top
 * cards each side brings (the cards people actually came to trade), plus a
 * greedy balanced bundle for the "trade whole stacks" crowd.
 */
export function buildEvenTrades(mine: TradeItem[], theirs: TradeItem[]): TradeOffer[] {
  if (mine.length === 0 || theirs.length === 0) return [];

  const myTop = [...mine].sort(byValueDesc).slice(0, 4);
  const theirTop = [...theirs].sort(byValueDesc).slice(0, 4);

  const candidates: TradeOffer[] = [];

  // My headline cards vs combos from their list...
  for (const m of myTop) {
    for (const c of combosNear(theirs, m.value, 6)) {
      candidates.push(makeOffer([m], c.items));
    }
  }
  // ...and their headline cards vs combos from mine.
  for (const t of theirTop) {
    for (const c of combosNear(mine, t.value, 6)) {
      candidates.push(makeOffer(c.items, [t]));
    }
  }

  const bundle = greedyBundle(mine, theirs);
  if (bundle) candidates.push(bundle);

  return selectOffers(candidates);
}

/**
 * Greedy multi-card bundle: repeatedly add the highest-value remaining card
 * to the poorer side, keeping the best-balanced snapshot. Deterministic.
 */
function greedyBundle(mine: TradeItem[], theirs: TradeItem[], maxPerSide = 4): TradeOffer | null {
  const giveQ = [...mine].sort(byValueDesc);
  const getQ = [...theirs].sort(byValueDesc);

  const give: TradeItem[] = [];
  const get: TradeItem[] = [];
  let best: TradeOffer | null = null;

  if (giveQ[0].value >= getQ[0].value) give.push(giveQ.shift()!);
  else get.push(getQ.shift()!);

  for (let step = 0; step < maxPerSide * 2; step++) {
    const wantGive = sum(give) <= sum(get);
    const primary = wantGive ? giveQ : getQ;
    const primaryList = wantGive ? give : get;
    const fallback = wantGive ? getQ : giveQ;
    const fallbackList = wantGive ? get : give;

    if (primary.length > 0 && primaryList.length < maxPerSide) {
      primaryList.push(primary.shift()!);
    } else if (fallback.length > 0 && fallbackList.length < maxPerSide) {
      fallbackList.push(fallback.shift()!);
    } else {
      break;
    }

    if (give.length > 1 && get.length > 1) {
      const offer = makeOffer([...give], [...get], 'bundle');
      if (!best || offer.deltaPct < best.deltaPct) best = offer;
    }
  }
  return best;
}
