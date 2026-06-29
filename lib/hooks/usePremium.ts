'use client';

import { useCallback, useEffect, useState } from 'react';
import { hasFeature as hasFeaturePure, type PremiumFeature } from '@/lib/entitlements';

/**
 * Client-side premium status (the UX half of the gate; see lib/premiumAuth.ts
 * for the authoritative server lock). Drives paywalls and show/hide of pro UI.
 *
 * Resolves /api/premium/status at most once per session, shared across surfaces
 * and deduped -- the same pattern as usePurchaseRegion. Unlike the geo gate it
 * fails CLOSED: a lookup error hides premium UI rather than flashing it to a
 * non-subscriber (who the server would block anyway). Call refresh() after a
 * purchase completes to pick up the new entitlement immediately.
 */
export interface PremiumStatus {
  premium: boolean;
  premiumUntil: string | null;
  features: Partial<Record<PremiumFeature, boolean>>;
}

const EMPTY: PremiumStatus = { premium: false, premiumUntil: null, features: {} };

let cached: PremiumStatus | null = null;
let inflight: Promise<PremiumStatus> | null = null;

async function fetchStatus(): Promise<PremiumStatus> {
  try {
    const res = await fetch('/api/premium/status');
    if (!res.ok) throw new Error('premium status lookup failed');
    const data = await res.json();
    return {
      premium: data?.premium === true,
      premiumUntil: typeof data?.premiumUntil === 'string' ? data.premiumUntil : null,
      features: data?.features && typeof data.features === 'object' ? data.features : {},
    };
  } catch {
    return EMPTY;
  }
}

export function ensurePremium(): Promise<PremiumStatus> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetchStatus().then((s) => {
      cached = s;
      inflight = null;
      return s;
    });
  }
  return inflight;
}

/** Drop the cached snapshot so the next read re-fetches (e.g. after upgrade). */
export function invalidatePremium() {
  cached = null;
  inflight = null;
}

export function usePremium() {
  const [status, setStatus] = useState<PremiumStatus | null>(cached);

  useEffect(() => {
    let active = true;
    ensurePremium().then((s) => { if (active) setStatus(s); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    invalidatePremium();
    const s = await ensurePremium();
    setStatus(s);
    return s;
  }, []);

  const resolved = status ?? EMPTY;
  const hasFeature = useCallback(
    (feature: PremiumFeature) =>
      // Prefer the server-computed map; fall back to the pure rule.
      resolved.features[feature] ?? hasFeaturePure(feature, resolved.premiumUntil),
    [resolved],
  );

  return {
    status: resolved,
    loading: status === null,
    premium: resolved.premium,
    hasFeature,
    refresh,
  };
}
