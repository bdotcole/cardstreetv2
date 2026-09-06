import { NextResponse } from 'next/server';
import { requireFeature } from '@/lib/premiumAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildEvenTrades,
  buildTargetOffers,
  completeOffer,
  MIN_OFFERS,
  type TradeItem,
  type TradeOffer,
} from '@/lib/tradeMatcher';

// Trade Finder matcher, keyed by the partner's trade code.
//
//   GET  ?code=TR-XXXXXX[&itemId=...]   first match (even / target mode) --
//                                       also the QR deep-link entry point
//   POST { code, itemId?, excludeMine, excludeTheirs, keeps }
//        refinement round: declined cards are excluded everywhere; `keeps`
//        are the surviving sides of offers the user edited -- the engine
//        tops them back up with replacements when a close-value completion
//        exists, and fills the rest of the slate with fresh offers.
//
// Wishlists never gate a match -- they only decorate items with wanted:true.
// Runs entirely with the service-role client; the response exposes only
// trade-marked cards, which is what sharing a trade code consents to.

function slim(row: any, wantedBy: Set<string>): TradeItem {
  const cd = row.card_data || {};
  return {
    itemId: row.id,
    cardId: row.card_id,
    name: cd.name || 'Unknown card',
    image: cd.images?.small || cd.imageUrl || null,
    value: typeof cd.marketPrice === 'number' ? cd.marketPrice : 0,
    quantity: row.quantity ?? 1,
    wanted: wantedBy.has(row.card_id),
    // Market snapshot for the offer rows -- same data the collection screen
    // shows, so both traders can judge (or dispute) the number.
    condition: row.condition ?? null,
    set: typeof cd.set === 'string' ? cd.set : null,
    rarity: typeof cd.rarity === 'string' ? cd.rarity : null,
    change7d: typeof cd.change7d === 'number' ? cd.change7d : null,
  };
}

async function loadTradables(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin
    .from('collection_items')
    .select('id, card_id, card_data, quantity, condition, collections!inner(user_id)')
    .eq('collections.user_id', userId)
    .eq('for_trade', true)
    .limit(500);
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadWishlistIds(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin.from('wishlists').select('card_id').eq('user_id', userId).limit(1000);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((w: any) => w.card_id as string));
}

interface Refinement {
  excludeMine: Set<string>;
  excludeTheirs: Set<string>;
  keeps: { give: string[]; get: string[] }[];
}

const NO_REFINEMENT: Refinement = { excludeMine: new Set(), excludeTheirs: new Set(), keeps: [] };

async function runMatch(
  userId: string,
  code: string,
  itemId: string | null,
  refine: Refinement,
): Promise<NextResponse> {
  const admin = createAdminClient();
  const { data: partner, error: partnerErr } = await admin
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('trade_code', code)
    .maybeSingle();

  if (partnerErr) return NextResponse.json({ error: partnerErr.message }, { status: 500 });
  if (!partner) return NextResponse.json({ error: 'No trader found for that code' }, { status: 404 });
  if (partner.id === userId) {
    return NextResponse.json({ error: "That's your own trade code" }, { status: 400 });
  }

  const [theirRows, myWants, theirWants] = await Promise.all([
    loadTradables(admin, partner.id),
    loadWishlistIds(admin, userId),
    loadWishlistIds(admin, partner.id),
  ]);
  // Their cards are "wanted" when on MY wishlist; mine when on THEIRS.
  const theirsAll = theirRows.map((r) => slim(r, myWants));
  const theirs = theirsAll.filter((i) => !refine.excludeTheirs.has(i.itemId));

  const partnerInfo = {
    displayName: partner.display_name || 'Trader',
    avatar: partner.avatar_url || null,
  };

  let mineAll: TradeItem[] = [];
  let anchor: TradeItem | null = null;
  let fresh: TradeOffer[];
  let counts: Record<string, number>;

  if (itemId) {
    // Target mode: the partner wants this specific card of mine. Any
    // collection item qualifies -- the chase card usually isn't one I had
    // marked for trade until someone asked.
    const { data: anchorRow, error: anchorErr } = await admin
      .from('collection_items')
      .select('id, card_id, card_data, quantity, condition, collections!inner(user_id)')
      .eq('id', itemId)
      .single();
    const owner = (anchorRow as any)?.collections?.user_id;
    if (anchorErr || owner !== userId) {
      return NextResponse.json({ error: 'Card not found in your collection' }, { status: 404 });
    }
    anchor = slim(anchorRow, theirWants);
    if (anchor.value <= 0) {
      return NextResponse.json(
        { error: 'That card has no market value on record, so value matching cannot run' },
        { status: 400 },
      );
    }
    mineAll = [anchor];
    fresh = buildTargetOffers(anchor, theirs);
    counts = { theirTradables: theirs.length };
  } else {
    const myRows = await loadTradables(admin, userId);
    mineAll = myRows.map((r) => slim(r, theirWants));
    const mine = mineAll.filter((i) => !refine.excludeMine.has(i.itemId));
    fresh = buildEvenTrades(mine, theirs);
    counts = { myTradables: mine.length, theirTradables: theirs.length };
  }

  // Complete the user's edited offers first -- they curated those. Fresh
  // offers fill the remaining slots; dedupe by composition.
  const byId = new Map(
    [...mineAll, ...theirsAll].map((i) => [i.itemId, i] as const),
  );
  const minePool = mineAll.filter((i) => !refine.excludeMine.has(i.itemId));
  const theirsPool = theirs;
  const completed: TradeOffer[] = [];
  for (const keep of refine.keeps.slice(0, 8)) {
    const give = keep.give.map((id) => byId.get(id)).filter((i): i is TradeItem => !!i && !refine.excludeMine.has(i.itemId));
    const get = keep.get.map((id) => byId.get(id)).filter((i): i is TradeItem => !!i && !refine.excludeTheirs.has(i.itemId));
    const done = completeOffer(give, get, minePool, theirsPool);
    if (done) completed.push(done);
  }

  const sig = (o: TradeOffer) =>
    `${o.give.map((i) => i.itemId).sort().join(',')}|${o.get.map((i) => i.itemId).sort().join(',')}`;
  const seen = new Set<string>();
  const offers: TradeOffer[] = [];
  for (const o of [...completed, ...fresh]) {
    const s = sig(o);
    if (seen.has(s)) continue;
    seen.add(s);
    offers.push(o);
    if (offers.length >= Math.max(8, MIN_OFFERS)) break;
  }

  return NextResponse.json({
    mode: itemId ? 'target' : 'even',
    partner: partnerInfo,
    ...(anchor ? { anchor } : {}),
    counts,
    excluded: refine.excludeMine.size + refine.excludeTheirs.size,
    offers,
  });
}

export async function GET(request: Request) {
  const gate = await requireFeature('trade_finder');
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const params = new URL(request.url).searchParams;
  const code = params.get('code')?.trim().toUpperCase();
  const itemId = params.get('itemId')?.trim() || null;
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 });

  try {
    return await runMatch(user.id, code, itemId, NO_REFINEMENT);
  } catch (e: any) {
    console.error('[API /api/trade/match] error:', e);
    return NextResponse.json({ error: e.message || 'Match failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireFeature('trade_finder');
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const itemId = typeof body.itemId === 'string' ? body.itemId : null;
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 });

  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
  const refine: Refinement = {
    excludeMine: new Set(ids(body.excludeMine)),
    excludeTheirs: new Set(ids(body.excludeTheirs)),
    keeps: Array.isArray(body.keeps)
      ? body.keeps
          .filter((k: any) => k && Array.isArray(k.give) && Array.isArray(k.get))
          .map((k: any) => ({ give: ids(k.give), get: ids(k.get) }))
          .slice(0, 8)
      : [],
  };

  try {
    return await runMatch(user.id, code, itemId, refine);
  } catch (e: any) {
    console.error('[API /api/trade/match] error:', e);
    return NextResponse.json({ error: e.message || 'Match failed' }, { status: 500 });
  }
}
