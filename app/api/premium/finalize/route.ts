import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getStripeForRegion, isRegionConfigured } from '@/lib/stripe';
import { syncPremiumFromSubscription } from '@/lib/premiumEntitlement';

// POST /api/premium/finalize — client-side fallback for the Pro webhook.
//
// The same belt-and-braces pattern app/api/orders/finalize/route.ts gives the
// marketplace, which Pro never had. checkout.session.completed +
// customer.subscription.* are PLATFORM events; if the TH endpoint that carries
// them is missing or Connect-scoped, they are never delivered and a paying
// subscriber sits on "activating your Pro..." forever having been charged.
//
// On return from Checkout the client posts the session id here and we claim the
// entitlement directly from Stripe instead of waiting on a delivery we cannot
// verify. Safe to run alongside the webhook: syncPremiumFromSubscription does a
// select-then-write on the ledger and never shrinks premium_until, so whichever
// path lands second is a no-op.
//
// This covers ACTIVATION only. Renewals and cancellations still arrive solely
// as customer.subscription.updated/deleted, so the webhook destination must
// still be configured correctly -- without it an entitlement is granted once
// and then quietly lapses at period end.

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!isRegionConfigured('th')) {
      return NextResponse.json({ error: 'Billing is not configured on this deploy' }, { status: 503 });
    }

    const { sessionId } = await req.json().catch(() => ({}));
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const stripe = getStripeForRegion('th');
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Only ever act on a session this route itself created.
    if (session.mode !== 'subscription' || session.metadata?.purpose !== 'cardstreet_premium') {
      return NextResponse.json({ error: 'Not a CardStreet Pro checkout session' }, { status: 400 });
    }

    // Authorization: the session must belong to the caller. Without this any
    // signed-in user could hand us someone else's session id and mint them an
    // entitlement (or read back their subscription state).
    const ownerId = session.metadata?.user_id ?? session.client_reference_id;
    if (ownerId !== user.id) {
      return NextResponse.json({ error: 'This checkout session is not yours' }, { status: 403 });
    }

    // PromptPay can't do recurring so this is card-only and settles inline, but
    // an unpaid session must never grant Pro.
    if (session.payment_status !== 'paid') {
      return NextResponse.json(
        { pending: true, paymentStatus: session.payment_status },
        { status: 202 },
      );
    }

    if (!session.subscription) {
      return NextResponse.json({ error: 'Session has no subscription' }, { status: 400 });
    }
    const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;

    // Retrieved fresh rather than trusting the session's embedded copy: the
    // entitlement window comes off current_period_end, which the subscription
    // object is authoritative for.
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncPremiumFromSubscription(sub);

    console.log(`[Premium/Finalize] Claimed entitlement for ${user.id} from session ${sessionId} (sub ${subId})`);
    return NextResponse.json({ success: true, subscriptionId: subId, status: sub.status });
  } catch (err: any) {
    console.error('[Premium/Finalize] error:', err);
    return NextResponse.json({ error: err.message || 'Could not finalize' }, { status: 500 });
  }
}
