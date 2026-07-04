'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BetaFeature } from '@/lib/betaFeatures';

/**
 * Client-side beta access (the UX half of the gate; see lib/betaAuth.ts for
 * the authoritative server lock). Drives show/hide of beta entry points --
 * a non-beta user gets NO UI hint the feature exists.
 *
 * Resolves /api/beta/status at most once per session, shared across surfaces
 * and deduped -- the same pattern as usePremium. Fails CLOSED: a lookup error
 * hides beta UI rather than flashing it to a non-granted user (who the server
 * would block anyway).
 */

type BetaStatus = Partial<Record<BetaFeature, boolean>>;

const EMPTY: BetaStatus = {};

let cached: BetaStatus | null = null;
let inflight: Promise<BetaStatus> | null = null;

async function fetchStatus(): Promise<BetaStatus> {
  try {
    const res = await fetch('/api/beta/status');
    if (!res.ok) throw new Error('beta status lookup failed');
    const data = await res.json();
    return data?.features && typeof data.features === 'object' ? data.features : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function ensureBetaStatus(): Promise<BetaStatus> {
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

/** Drop the cached snapshot so the next read re-fetches (e.g. after sign-in). */
export function invalidateBetaStatus() {
  cached = null;
  inflight = null;
}

export function useBetaFeatures() {
  const [status, setStatus] = useState<BetaStatus | null>(cached);

  useEffect(() => {
    let active = true;
    ensureBetaStatus().then((s) => { if (active) setStatus(s); });
    return () => { active = false; };
  }, []);

  const refresh = useCallback(async () => {
    invalidateBetaStatus();
    const s = await ensureBetaStatus();
    setStatus(s);
    return s;
  }, []);

  const resolved = status ?? EMPTY;
  const hasBeta = useCallback(
    (feature: BetaFeature) => resolved[feature] === true,
    [resolved],
  );

  return {
    loading: status === null,
    hasBeta,
    refresh,
  };
}
