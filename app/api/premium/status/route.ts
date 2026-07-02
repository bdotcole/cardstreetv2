import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEntitlement } from '@/lib/premiumAuth';
import { FEATURE_TIERS, PREMIUM_FEATURES, type PremiumFeature } from '@/lib/entitlements';

// GET /api/premium/status -- per-user entitlement snapshot for the client
// (lib/hooks/usePremium.ts). no-store so a user who just upgraded (or expired)
// never reads a stale gate. UX only; the server gate (requirePremium) is final.
//
// premium reflects the EFFECTIVE entitlement (subscription OR admin role);
// premiumUntil stays null for role-granted access so the hub knows there's
// no Stripe subscription to manage.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const noStore = { headers: { 'Cache-Control': 'no-store' } };

  if (!user) {
    return NextResponse.json(
      { premium: false, premiumUntil: null, features: {} },
      noStore,
    );
  }

  const ent = await getEntitlement(user.id);
  const features = Object.fromEntries(
    PREMIUM_FEATURES.map((f) => [f, ent.premium || FEATURE_TIERS[f] === 'free']),
  ) as Record<PremiumFeature, boolean>;

  return NextResponse.json(
    { premium: ent.premium, premiumUntil: ent.premiumUntil, features },
    noStore,
  );
}
