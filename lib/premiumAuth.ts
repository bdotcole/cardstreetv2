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
 * Entitlement = an active subscription (premium_until in the future, written
 * by the billing webhooks) OR role='admin' -- staff get every Pro feature by
 * role, evergreen, with no synthetic subscription rows.
 *
 * The client paywall (lib/hooks/usePremium.ts) is UX only -- this is the lock.
 */

import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FEATURE_TIERS, isPremium, type PremiumFeature } from '@/lib/entitlements';

export interface PremiumContext {
  user: User;
  premiumUntil: string | null;
}

export interface Entitlement {
  premiumUntil: string | null;
  isAdmin: boolean;
  /** The effective answer: active subscription OR admin role. */
  premium: boolean;
}

/** Effective entitlement for a user (service-role read; never throws). */
export async function getEntitlement(userId: string): Promise<Entitlement> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('premium_until, role')
    .eq('id', userId)
    .single();
  const premiumUntil = (data?.premium_until as string | null) ?? null;
  const isAdmin = data?.role === 'admin';
  return { premiumUntil, isAdmin, premium: isAdmin || isPremium(premiumUntil) };
}

export async function requirePremium(): Promise<PremiumContext | NextResponse> {
  const cookieSupabase = await createServerClient();
  const { data: { user }, error } = await cookieSupabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Read the cached entitlement with service-role so an RLS policy can't hide
  // the caller's own row from this check.
  const ent = await getEntitlement(user.id);
  if (!ent.premium) {
    return NextResponse.json(
      { error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' },
      { status: 403 },
    );
  }

  return { user, premiumUntil: ent.premiumUntil };
}

/**
 * Gate ONE feature rather than the whole tier.
 *
 * Use this wherever a route backs a capability listed in FEATURE_TIERS: a
 * feature flipped to 'free' there then needs only a signed-in user, and the
 * flip takes effect on the server and in the client hook at the same instant.
 * requirePremium() is still correct for routes that back the plan itself
 * (billing, entitlement management) rather than a named feature -- when
 * trade_finder went free the three /api/trade routes kept a hard 403 for a
 * feature the UI had already unlocked, which is exactly the drift this closes.
 */
export async function requireFeature(feature: PremiumFeature): Promise<PremiumContext | NextResponse> {
  const cookieSupabase = await createServerClient();
  const { data: { user }, error } = await cookieSupabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ent = await getEntitlement(user.id);
  if (FEATURE_TIERS[feature] !== 'free' && !ent.premium) {
    return NextResponse.json(
      { error: 'Premium subscription required', code: 'PREMIUM_REQUIRED' },
      { status: 403 },
    );
  }

  return { user, premiumUntil: ent.premiumUntil };
}

/** Cached entitlement for a user, for status routes that don't need to gate. */
export async function getPremiumUntil(userId: string): Promise<string | null> {
  return (await getEntitlement(userId)).premiumUntil;
}
