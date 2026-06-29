import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getPremiumUntil } from '@/lib/premiumAuth';
import { isPremium, hasFeature, PREMIUM_FEATURES, type PremiumFeature } from '@/lib/entitlements';

// GET /api/premium/status -- per-user entitlement snapshot for the client
// (lib/hooks/usePremium.ts). no-store so a user who just upgraded (or expired)
// never reads a stale gate. UX only; the server gate (requirePremium) is final.
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

  const premiumUntil = await getPremiumUntil(user.id);
  const features = Object.fromEntries(
    PREMIUM_FEATURES.map((f) => [f, hasFeature(f, premiumUntil)]),
  ) as Record<PremiumFeature, boolean>;

  return NextResponse.json(
    { premium: isPremium(premiumUntil), premiumUntil, features },
    noStore,
  );
}
