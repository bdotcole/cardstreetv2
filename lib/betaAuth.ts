/**
 * Beta-feature authorization helper -- the authoritative server gate for
 * dark-shipped features. Mirror of requirePremium() in lib/premiumAuth.ts.
 *
 * Every beta API route calls requireBeta('<feature>') first: on success it
 * returns the caller; on failure it returns a NextResponse the route returns
 * directly.
 *
 *   const gate = await requireBeta('auctions');
 *   if (gate instanceof NextResponse) return gate;
 *   const { user } = gate;  // inside the beta from here on
 *
 * Two layers, both server-side:
 *   1. Global kill switch: beta_feature_flags.enabled -- flipping it off
 *      disables the feature for EVERYONE (admins included) without a deploy.
 *      Money-touching routes must never skip this.
 *   2. Per-user grant: profiles.beta_features contains the feature, OR the
 *      caller is an admin (by role, evergreen).
 *
 * The client hook (lib/hooks/useBetaFeatures.ts) is UX only -- this is the lock.
 */

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasBeta, type BetaFeature } from '@/lib/betaFeatures';

export interface BetaContext {
  user: User;
}

/** Is the feature globally enabled? Fails CLOSED on lookup errors. */
export async function isFeatureEnabled(feature: BetaFeature): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('beta_feature_flags')
    .select('enabled')
    .eq('feature', feature)
    .maybeSingle();
  if (error) {
    console.error(`[BetaAuth] kill-switch lookup failed for ${feature}:`, error.message);
    return false;
  }
  return data?.enabled === true;
}

/** Per-user beta access (grant or admin role). Does NOT include the kill switch. */
export async function userHasBeta(userId: string, feature: BetaFeature): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('beta_features, role')
    .eq('id', userId)
    .single();
  return hasBeta(feature, data?.beta_features ?? null, data?.role === 'admin');
}

export async function requireBeta(feature: BetaFeature): Promise<BetaContext | NextResponse> {
  const cookieSupabase = await createServerClient();
  const { data: { user }, error } = await cookieSupabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Kill switch first: when a feature is globally off, grants are irrelevant.
  if (!(await isFeatureEnabled(feature))) {
    return NextResponse.json(
      { error: 'This feature is temporarily unavailable', code: 'FEATURE_DISABLED' },
      { status: 503 },
    );
  }

  if (!(await userHasBeta(user.id, feature))) {
    // Same shape a non-existent route would give a prober: no hint that the
    // caller is one flag away from a hidden feature.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return { user };
}
