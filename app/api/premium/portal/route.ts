import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeForRegion, isRegionConfigured, getAppBaseUrl } from '@/lib/stripe';

// POST /api/premium/portal — Stripe Billing Portal session so a web subscriber
// can manage/cancel CardStreet Pro. Only meaningful for Stripe-rail subs;
// store-IAP subs (later) are managed in the store's own subscription settings.
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isRegionConfigured('th')) {
    return NextResponse.json({ error: 'Billing is not configured on this deploy' }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: sub, error } = await admin
    .from('subscriptions')
    .select('provider_customer_id')
    .eq('user_id', user.id)
    .eq('provider', 'stripe')
    .not('provider_customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!sub?.provider_customer_id) {
    return NextResponse.json({ error: 'No Stripe subscription found for this account' }, { status: 404 });
  }

  try {
    const stripe = getStripeForRegion('th');
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.provider_customer_id,
      return_url: `${getAppBaseUrl()}/premium`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[API /api/premium/portal] error:', err);
    return NextResponse.json({ error: err.message || 'Could not open billing portal' }, { status: 500 });
  }
}
