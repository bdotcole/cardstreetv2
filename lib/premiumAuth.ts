/**
 * Premium authorization helper -- the authoritative server gate for the Pro tier.
 *
 * Mirror of requireAdmin() in lib/adminAuth.ts. Every premium API route calls
 * requirePremium() first: on success it returns the caller plus their cached
 * entitlement; on failure it returns a NextResponse the route returns directly.
 *
 *   const gate = await requirePremium();
 *   if (gate instanceof NextResponse) return gate;
 *   const { user } = gate;  // entitled from here on
 *
 * The client paywall (lib/hooks/usePremium.ts) is UX only -- this is the lock.
 */

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPremium } from '@/lib/entitlements';

export interface PremiumContext {
  user: User;
  premiumUntil: string | null;
}

export async function requirePremium(): Promise<PremiumContext | NextResponse> {
  const cookieSupabase = await createServerClient();
  const { data: { user }, error } = await cookieSupabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Read the cached entitlement with service-role so an RLS policy can't hide
  // the caller's own row from this check.
  const admin = createAdminClient();
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('premium_until')
    .eq('id', user.id)
    .single();

  if (profileErr) {
    return NextResponse.json({ error: 'Failed to verify subscription' }, { status: 500 });
  }

  const premiumUntil = (profile?.premium_until as string | null) ?? null;
  if (!isPremium(premiumUntil)) {
    return NextResponse.json(
      { error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' },
      { status: 403 },
    );
  }

  return { user, premiumUntil };
}

/** Cached entitlement for a user, for status routes that don't need to gate. */
export async function getPremiumUntil(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('premium_until')
    .eq('id', userId)
    .single();
  return (data?.premium_until as string | null) ?? null;
}
