/**
 * GET /api/beta/status
 *
 * The client's one view into beta access: which beta features the signed-in
 * user can see, with the global kill switch already applied. Unauthenticated
 * callers get an empty map (not a 401) so the hook can run unconditionally.
 *
 * UX only -- every beta route re-checks requireBeta() server-side.
 */

import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { BETA_FEATURES, hasBeta, type BetaFeature } from '@/lib/betaFeatures';

export const dynamic = 'force-dynamic';

export async function GET() {
  const empty: Record<string, boolean> = {};
  for (const f of BETA_FEATURES) empty[f] = false;

  try {
    const cookieSupabase = await createServerClient();
    const { data: { user } } = await cookieSupabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ features: empty }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const admin = createAdminClient();
    const [{ data: profile }, { data: flags }] = await Promise.all([
      admin.from('profiles').select('beta_features, role').eq('id', user.id).single(),
      admin.from('beta_feature_flags').select('feature, enabled'),
    ]);

    const enabled = new Map<string, boolean>(
      (flags ?? []).map((f: { feature: string; enabled: boolean }) => [f.feature, f.enabled]),
    );

    const features: Record<string, boolean> = {};
    for (const f of BETA_FEATURES as readonly BetaFeature[]) {
      features[f] =
        enabled.get(f) === true &&
        hasBeta(f, profile?.beta_features ?? null, profile?.role === 'admin');
    }

    return NextResponse.json({ features }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[Beta/Status] lookup failed:', err);
    // Fail closed: no beta UI on error; the server gates are the lock anyway.
    return NextResponse.json({ features: empty }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
