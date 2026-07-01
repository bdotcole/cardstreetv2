/**
 * Premium entitlement capability map -- the single source of truth for what
 * the paid "Pro" tier unlocks.
 *
 * Add a future pro feature HERE, not as a scattered `if (premium)` check.
 * Both the server gate (lib/premiumAuth.ts) and the client (lib/hooks/usePremium.ts)
 * read this module, so the rules can't drift between the two. Keep it pure --
 * no Supabase / Next imports -- so it runs identically on both sides.
 */

export type PlanTier = 'free' | 'premium';

export type PremiumFeature =
  | 'ai_grader'
  | 'trade_finder'
  | 'advanced_market';

/** Each feature -> minimum tier required. Anything not listed is free. */
export const FEATURE_TIERS: Record<PremiumFeature, PlanTier> = {
  ai_grader: 'premium',
  trade_finder: 'premium',
  advanced_market: 'premium',
};

export const PREMIUM_FEATURES = Object.keys(FEATURE_TIERS) as PremiumFeature[];

/**
 * Is the cached entitlement currently active? `premiumUntil` is the ISO
 * timestamp from profiles.premium_until; null/undefined/past = free.
 */
export function isPremium(premiumUntil: string | null | undefined): boolean {
  if (!premiumUntil) return false;
  const ts = Date.parse(premiumUntil);
  return Number.isFinite(ts) && ts > Date.now();
}

export function planTier(premiumUntil: string | null | undefined): PlanTier {
  return isPremium(premiumUntil) ? 'premium' : 'free';
}

/** Does this entitlement unlock the given feature? */
export function hasFeature(
  feature: PremiumFeature,
  premiumUntil: string | null | undefined,
): boolean {
  return FEATURE_TIERS[feature] === 'free' || isPremium(premiumUntil);
}
