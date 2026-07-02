import { NextResponse } from 'next/server';
import { requirePremium } from '@/lib/premiumAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildEvenTrades, buildTargetOffers, type TradeItem } from '@/lib/tradeMatcher';

// Trade Finder matcher, keyed by the partner's trade code. Two modes:
//
//   ?code=TR-XXXXXX             even trades across both FULL trade lists
//   ?code=TR-XXXXXX&itemId=...  target mode: the partner wants one of my
//                               cards; offers are combos from THEIR trade
//                               list totalling ~that card's value
//
// Wishlists never gate a match -- they only decorate items with wanted:true
// (badge + small ranking boost). Runs entirely with the service-role client;
// the response exposes only trade-marked cards, which is exactly what sharing
// a trade code consents to.

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
  };
}

async function loadTradables(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data, error } = await admin
    .from('collection_items')
    .select('id, card_id, card_data, quantity, collections!inner(user_id)')
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

export async function GET(request: Request) {
  const gate = await requirePremium();
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const params = new URL(request.url).searchParams;
  const code = params.get('code')?.trim().toUpperCase();
  const itemId = params.get('itemId')?.trim() || null;
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: partner, error: partnerErr } = await admin
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('trade_code', code)
    .maybeSingle();

  if (partnerErr) return NextResponse.json({ error: partnerErr.message }, { status: 500 });
  if (!partner) return NextResponse.json({ error: 'No trader found for that code' }, { status: 404 });
  if (partner.id === user.id) {
    return NextResponse.json({ error: "That's your own trade code" }, { status: 400 });
  }

  try {
    const [theirRows, myWants, theirWants] = await Promise.all([
      loadTradables(admin, partner.id),
      loadWishlistIds(admin, user.id),
      loadWishlistIds(admin, partner.id),
    ]);
    // Their cards are "wanted" when on MY wishlist; mine when on THEIRS.
    const theirs = theirRows.map((r) => slim(r, myWants));

    const partnerInfo = {
      displayName: partner.display_name || 'Trader',
      avatar: partner.avatar_url || null,
    };

    if (itemId) {
      // Target mode: the partner wants this specific card of mine. Any
      // collection item qualifies -- the chase card usually isn't one I had
      // marked for trade until someone asked.
      const { data: anchorRow, error: anchorErr } = await admin
        .from('collection_items')
        .select('id, card_id, card_data, quantity, collections!inner(user_id)')
        .eq('id', itemId)
        .single();
      const owner = (anchorRow as any)?.collections?.user_id;
      if (anchorErr || owner !== user.id) {
        return NextResponse.json({ error: 'Card not found in your collection' }, { status: 404 });
      }
      const anchor = slim(anchorRow, theirWants);
      if (anchor.value <= 0) {
        return NextResponse.json(
          { error: 'That card has no market value on record, so value matching cannot run' },
          { status: 400 },
        );
      }

      return NextResponse.json({
        mode: 'target',
        partner: partnerInfo,
        anchor,
        counts: { theirTradables: theirs.length },
        offers: buildTargetOffers(anchor, theirs),
      });
    }

    // Even-trades mode across both full trade lists.
    const myRows = await loadTradables(admin, user.id);
    const mine = myRows.map((r) => slim(r, theirWants));

    return NextResponse.json({
      mode: 'even',
      partner: partnerInfo,
      counts: { myTradables: mine.length, theirTradables: theirs.length },
      offers: buildEvenTrades(mine, theirs),
    });
  } catch (e: any) {
    console.error('[API /api/trade/match] error:', e);
    return NextResponse.json({ error: e.message || 'Match failed' }, { status: 500 });
  }
}
