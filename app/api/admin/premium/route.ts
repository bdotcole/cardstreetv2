import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/adminAuth';

// POST /api/admin/premium -- grant, extend, or revoke premium for a user.
//
// Body: { userId: string, days?: number, revoke?: boolean }
//   days > 0            -> premium_until = now() + days   (grant / extend)
//   revoke:true | days:0 -> premium_until = null          (revoke)
//
// This is the MANUAL rail (provider='manual'): how we comp premium and dogfood
// pro features before the Stripe / IAP rails exist. Real purchases set
// premium_until through their own webhooks, never here. premium_until is
// service-role-only (a trigger blocks user self-grants), so this admin route is
// the only app path that can write it.
export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (gate) return gate;

  const body = await request.json().catch(() => ({}));
  const userId = typeof body.userId === 'string' ? body.userId : null;
  const days = Number.isFinite(body.days) ? Number(body.days) : null;
  const revoke = body.revoke === true || days === 0;

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  if (!revoke && (days === null || days <= 0)) {
    return NextResponse.json(
      { error: 'days must be a positive number, or pass revoke:true' },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const premiumUntil = revoke
    ? null
    : new Date(Date.now() + days! * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('profiles')
    .update({ premium_until: premiumUntil })
    .eq('id', userId)
    .select('id, premium_until')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit the change in the ledger so manual grants sit alongside real
  // subscriptions. Non-fatal: the cached entitlement above is what gates.
  const { error: ledgerErr } = await supabase.from('subscriptions').insert({
    user_id: userId,
    provider: 'manual',
    platform: 'web',
    status: revoke ? 'canceled' : 'active',
    current_period_end: premiumUntil,
  });
  if (ledgerErr) console.error('[Admin/Premium] ledger insert failed:', ledgerErr.message);

  return NextResponse.json({ user: data });
}
