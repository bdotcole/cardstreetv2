import { NextResponse } from 'next/server';
import { requirePremium } from '@/lib/premiumAuth';
import { createAdminClient } from '@/lib/supabase/admin';

// Pro Insights (premium): portfolio analytics computed from the user's own
// data — collection snapshots (portfolio_snapshots, hourly cron), holdings
// value vs cost basis, top holdings, allocation by game, and 7d movers from
// the card_data snapshots. All THB (Card.marketPrice unit).

export const dynamic = 'force-dynamic';

interface Holding {
  cardId: string;
  name: string;
  image: string | null;
  game: string;
  value: number;    // per-copy market value
  quantity: number;
  total: number;    // value * quantity
  change7d: number | null;
  costBasis: number | null; // purchase_price * quantity, when recorded
}

export async function GET() {
  const gate = await requirePremium();
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = createAdminClient();

  const [itemsRes, snapshotsRes] = await Promise.all([
    admin
      .from('collection_items')
      .select('card_id, card_data, quantity, purchase_price, collections!inner(user_id, include_in_portfolio)')
      .eq('collections.user_id', user.id)
      .limit(2000),
    admin
      .from('portfolio_snapshots')
      .select('total_market_value, item_count, timestamp')
      .eq('user_id', user.id)
      .gte('timestamp', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('timestamp', { ascending: true })
      .limit(2200),
  ]);

  if (itemsRes.error) return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  if (snapshotsRes.error) return NextResponse.json({ error: snapshotsRes.error.message }, { status: 500 });

  const holdings: Holding[] = (itemsRes.data || [])
    .filter((row: any) => row.collections?.include_in_portfolio !== false)
    .map((row: any) => {
      const cd = row.card_data || {};
      const value = typeof cd.marketPrice === 'number' ? cd.marketPrice : 0;
      const quantity = row.quantity ?? 1;
      const purchase = typeof row.purchase_price === 'string' ? parseFloat(row.purchase_price) : row.purchase_price;
      return {
        cardId: row.card_id,
        name: cd.name || 'Unknown card',
        image: cd.images?.small || cd.imageUrl || null,
        // Legacy snapshots predate the multi-game expansion; they're Pokemon.
        game: typeof cd.game === 'string' && cd.game ? cd.game : 'pokemon',
        value,
        quantity,
        total: value * quantity,
        change7d: typeof cd.change7d === 'number' ? cd.change7d : null,
        costBasis: typeof purchase === 'number' && Number.isFinite(purchase) ? purchase * quantity : null,
      };
    });

  const totalValue = holdings.reduce((s, h) => s + h.total, 0);
  const withCost = holdings.filter((h) => h.costBasis !== null);
  const totalCost = withCost.reduce((s, h) => s + (h.costBasis as number), 0);
  const costCoveredValue = withCost.reduce((s, h) => s + h.total, 0);

  // Allocation by game (card_data.game; legacy Pokemon snapshots predate the field).
  const allocation = new Map<string, number>();
  for (const h of holdings) {
    allocation.set(h.game, (allocation.get(h.game) || 0) + h.total);
  }

  const movers = holdings
    .filter((h) => h.change7d !== null && h.total > 0)
    .sort((a, b) => Math.abs(b.change7d as number) - Math.abs(a.change7d as number))
    .slice(0, 6);

  return NextResponse.json(
    {
      summary: {
        totalValue,
        itemCount: holdings.reduce((s, h) => s + h.quantity, 0),
        uniqueCards: holdings.length,
        // P/L only over items that have a recorded purchase price, so the
        // number is honest rather than assuming zero cost for the rest.
        costBasis: totalCost,
        costCoveredValue,
        unrealizedPl: costCoveredValue - totalCost,
      },
      history: (snapshotsRes.data || []).map((s: any) => ({
        t: s.timestamp,
        v: typeof s.total_market_value === 'string' ? parseFloat(s.total_market_value) : s.total_market_value,
      })),
      topHoldings: [...holdings].sort((a, b) => b.total - a.total).slice(0, 8),
      allocation: [...allocation.entries()]
        .map(([game, value]) => ({ game, value, pct: totalValue > 0 ? value / totalValue : 0 }))
        .sort((a, b) => b.value - a.value),
      movers,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
