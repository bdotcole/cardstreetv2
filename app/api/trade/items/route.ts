import { NextResponse } from 'next/server';
import { requirePremium } from '@/lib/premiumAuth';
import { createAdminClient } from '@/lib/supabase/admin';

// Trade Finder: list my collection items with their for_trade flag (GET) and
// toggle a card's tradable state (PATCH). Premium-gated — tagging is the entry
// point of the feature. Reads/writes use the service-role client with explicit
// ownership checks (collection_items has no direct user_id; ownership hangs
// off collections.user_id).

interface SlimItem {
  itemId: string;
  cardId: string;
  name: string;
  image: string | null;
  value: number;
  quantity: number;
  forTrade: boolean;
  condition: string | null;
  set: string | null;
}

function slim(row: any): SlimItem {
  const cd = row.card_data || {};
  return {
    itemId: row.id,
    cardId: row.card_id,
    name: cd.name || 'Unknown card',
    image: cd.images?.small || cd.imageUrl || null,
    value: typeof cd.marketPrice === 'number' ? cd.marketPrice : 0,
    quantity: row.quantity ?? 1,
    forTrade: row.for_trade === true,
    condition: row.condition ?? null,
    set: typeof cd.set === 'string' ? cd.set : null,
  };
}

export async function GET() {
  const gate = await requirePremium();
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('collection_items')
    .select('id, card_id, card_data, quantity, condition, for_trade, collections!inner(user_id)')
    .eq('collections.user_id', user.id)
    .order('added_at', { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data || []).map(slim) });
}

export async function PATCH(request: Request) {
  const gate = await requirePremium();
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const body = await request.json().catch(() => ({}));
  const itemId = typeof body.itemId === 'string' ? body.itemId : null;
  const forTrade = body.forTrade === true;
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 });

  const admin = createAdminClient();

  // Ownership check before the service-role write.
  const { data: item, error: itemErr } = await admin
    .from('collection_items')
    .select('id, collections!inner(user_id)')
    .eq('id', itemId)
    .single();
  const owner = (item as any)?.collections?.user_id;
  if (itemErr || owner !== user.id) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  const { error: updErr } = await admin
    .from('collection_items')
    .update({ for_trade: forTrade })
    .eq('id', itemId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ itemId, forTrade });
}
