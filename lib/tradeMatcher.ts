/**
 * Trade Finder matching algorithm (pure -- no I/O, unit-testable).
 *
 * Inputs are the two overlap lists the API route computes with service-role
 * reads: `gives` = my tradables the partner wants, `gets` = their tradables I
 * want. Values are Card.marketPrice snapshots (THB) from card_data -- both
 * sides use the same unit, which is all balancing needs.
 *
 * Produces up to three deterministic proposals, NBA-2K-trade-machine style:
 *   single   -- the one-for-one pair with the smallest value gap
 *   balanced -- greedy bundles built to minimize the value gap
 *   max      -- everything both sides want, gap shown as a cash top-up hint
 */

export interface TradeItem {
  itemId: string;
  cardId: string;
  name: string;
  image: string | null;
  value: number;
  quantity: number;
}

export interface TradeProposal {
  kind: 'single' | 'balanced' | 'max';
  give: TradeItem[];
  get: TradeItem[];
  giveValue: number;
  getValue: number;
  /** 0 = perfectly even; 0.25 = one side is 25% richer. */
  deltaPct: number;
}

const sum = (items: TradeItem[]) => items.reduce((s, i) => s + i.value, 0);

function deltaPct(a: number, b: number): number {
  const max = Math.max(a, b);
  return max <= 0 ? 0 : Math.abs(a - b) / max;
}

function proposal(kind: TradeProposal['kind'], give: TradeItem[], get: TradeItem[]): TradeProposal {
  const giveValue = sum(give);
  const getValue = sum(get);
  return { kind, give, get, giveValue, getValue, deltaPct: deltaPct(giveValue, getValue) };
}

/** Best one-for-one swap: the pair with the smallest relative value gap. */
function bestSingle(gives: TradeItem[], gets: TradeItem[]): TradeProposal | null {
  let best: TradeProposal | null = null;
  for (const g of gives) {
    for (const r of gets) {
      const p = proposal('single', [g], [r]);
      if (!best || p.deltaPct < best.deltaPct) best = p;
    }
  }
  return best;
}

/**
 * Greedy bundle builder: repeatedly add the highest-value remaining card to
 * whichever side is currently poorer, keeping the best-balanced snapshot seen.
 * Deterministic (value-desc order, itemId tiebreak) and bounded per side.
 */
function bestBundle(gives: TradeItem[], gets: TradeItem[], maxPerSide = 4): TradeProposal | null {
  const byValue = (a: TradeItem, b: TradeItem) => b.value - a.value || a.itemId.localeCompare(b.itemId);
  const giveQ = [...gives].sort(byValue);
  const getQ = [...gets].sort(byValue);

  const give: TradeItem[] = [];
  const get: TradeItem[] = [];
  let best: TradeProposal | null = null;

  // Seed with the single most valuable card in the whole pool so the bundle
  // grows around the trade's anchor piece.
  if (giveQ.length === 0 || getQ.length === 0) return null;
  if (giveQ[0].value >= getQ[0].value) give.push(giveQ.shift()!);
  else get.push(getQ.shift()!);

  for (let step = 0; step < maxPerSide * 2; step++) {
    const giveTotal = sum(give);
    const getTotal = sum(get);
    // Add to the poorer side; if it has no cards left (or is full), the other.
    const wantGive = giveTotal <= getTotal;
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

    if (give.length > 0 && get.length > 0) {
      const p = proposal('balanced', [...give], [...get]);
      if (!best || p.deltaPct < best.deltaPct) best = p;
    }
  }
  return best;
}

/** The kitchen sink: every overlapping card both directions (top N by value). */
function maxSwap(gives: TradeItem[], gets: TradeItem[], cap = 8): TradeProposal | null {
  if (gives.length === 0 || gets.length === 0) return null;
  const top = (items: TradeItem[]) =>
    [...items].sort((a, b) => b.value - a.value || a.itemId.localeCompare(b.itemId)).slice(0, cap);
  return proposal('max', top(gives), top(gets));
}

function signature(p: TradeProposal): string {
  const ids = (items: TradeItem[]) => items.map((i) => i.itemId).sort().join(',');
  return `${ids(p.give)}|${ids(p.get)}`;
}

export function buildProposals(gives: TradeItem[], gets: TradeItem[]): TradeProposal[] {
  if (gives.length === 0 || gets.length === 0) return [];

  const candidates = [bestSingle(gives, gets), bestBundle(gives, gets), maxSwap(gives, gets)]
    .filter((p): p is TradeProposal => p !== null);

  // Drop duplicates (tiny pools collapse all three into the same swap), keep
  // the most balanced first.
  const seen = new Set<string>();
  const unique: TradeProposal[] = [];
  for (const p of candidates) {
    const sig = signature(p);
    if (!seen.has(sig)) {
      seen.add(sig);
      unique.push(p);
    }
  }
  return unique.sort((a, b) => a.deltaPct - b.deltaPct);
}
