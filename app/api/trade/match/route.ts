import { NextResponse } from 'next/server';
import { requirePremium } from '@/lib/premiumAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildProposals, type TradeItem } from '@/lib/tradeMatcher';

// Trade Finder: match my tradables + wishlist against another user's, keyed by
// their trade code. Runs entirely with the service-role client — RLS never
// exposes another user's collection to the browser; the API returns only the
// overlap (cards each side has that the other explicitly wishlisted), which is
// exactly what sharing a trade code consents to.

function slimItems(rows: any[]): TradeItem[] {
  return (rows || []).map((row) => {
    const cd = row.card_data || {};
    return {
      itemId: row.id,
      cardId: row.card_id,
      name: cd.name || 'Unknown card',
      image: cd.images?.small || cd.imageUrl || null,
      value: typeof cd.marketPrice === 'number' ? cd.marketPrice : 0,
      quantity: row.quantity ?? 1,
    };
  });
}

async function loadSide(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const [tradables, wishlist] = await Promise.all([
    admin
      .from('collection_items')
      .select('id, card_id, card_data, quantity, collections!inner(user_id)')
      .eq('collections.user_id', userId)
      .eq('for_trade', true)
      .limit(500),
    admin.from('wishlists').select('card_id').eq('user_id', userId).limit(1000),
  ]);
  if (tradables.error) throw new Error(tradables.error.message);
  if (wishlist.error) throw new Error(wishlist.error.message);
  return {
    tradables: slimItems(tradables.data || []),
    wants: new Set((wishlist.data || []).map((w: any) => w.card_id as string)),
  };
}

export async function GET(request: Request) {
  const gate = await requirePremium();
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const code = new URL(request.url).searchParams.get('code')?.trim().toUpperCase();
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
    const [mine, theirs] = await Promise.all([loadSide(admin, user.id), loadSide(admin, partner.id)]);

    // The tradable overlap, both directions.
    const iGive = mine.tradables.filter((i) => theirs.wants.has(i.cardId));
    const iGet = theirs.tradables.filter((i) => mine.wants.has(i.cardId));

    return NextResponse.json({
      partner: { displayName: partner.display_name || 'Trader', avatar: partner.avatar_url || null },
      counts: {
        myTradables: mine.tradables.length,
        theirTradables: theirs.tradables.length,
        theyWant: iGive.length,
        youWant: iGet.length,
      },
      proposals: buildProposals(iGive, iGet),
    });
  } catch (e: any) {
    console.error('[API /api/trade/match] error:', e);
    return NextResponse.json({ error: e.message || 'Match failed' }, { status: 500 });
  }
}
