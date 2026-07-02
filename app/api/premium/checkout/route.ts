import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEntitlement } from '@/lib/premiumAuth';
import { getStripeForRegion, isRegionConfigured, getAppBaseUrl } from '@/lib/stripe';

// POST /api/premium/checkout — start a CardStreet Pro subscription (web rail).
//
// Runs on the TH PLATFORM account (plain platform revenue), completely apart
// from the marketplace's Connect direct-charge flow — premium never touches a
// seller's connected account. Card-only: PromptPay can't do recurring.
//
// The webhook (checkout.session.completed → customer.subscription.*) writes
// the entitlement via lib/premiumEntitlement.ts; this route only creates the
// Checkout Session. In-app purchases will use store IAP later — the client
// hides this path inside the native shells.

// ฿149/month unless overridden (satang). Keep in step with the ฿149 display
// on app/premium/page.tsx and the store IAP price tiers.
const PRICE_SATANG = Number(process.env.PREMIUM_PRICE_SATANG) || 14900;

export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isRegionConfigured('th')) {
    return NextResponse.json({ error: 'Billing is not configured on this deploy' }, { status: 503 });
  }

  // Double-subscribing through a second Checkout would double-charge -- and
  // admins (Pro by role) have nothing to buy.
  if ((await getEntitlement(user.id)).premium) {
    return NextResponse.json({ error: 'You already have CardStreet Pro', code: 'ALREADY_PREMIUM' }, { status: 400 });
  }

  try {
    const stripe = getStripeForRegion('th');
    const base = getAppBaseUrl();
    const metadata = { user_id: user.id, purpose: 'cardstreet_premium' };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'thb',
            unit_amount: PRICE_SATANG,
            recurring: { interval: 'month' },
            product_data: {
              name: 'CardStreet Pro',
              description: 'AI card grading, Trade Finder, and Pro portfolio insights',
            },
          },
        },
      ],
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      metadata,
      // Rides on the subscription object, which is what every lifecycle
      // webhook event carries — the entitlement writer keys off this.
      subscription_data: { metadata },
      success_url: `${base}/premium?upgraded=1`,
      cancel_url: `${base}/premium`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[API /api/premium/checkout] error:', err);
    return NextResponse.json({ error: err.message || 'Could not start checkout' }, { status: 500 });
  }
}
